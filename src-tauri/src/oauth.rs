//! Browser sign-in for providers that support it.
//!
//! - OpenRouter: official PKCE flow that mints a regular API key, stored like
//!   a pasted key (keychain account `openrouter`).
//! - xAI (SuperGrok / X Premium+): PKCE against auth.x.ai with xAI's shared
//!   CLI client. Tokens refresh; requests go to api.x.ai with the access token.
//! - ChatGPT (Codex): PKCE against auth.openai.com with the Codex CLI's public
//!   client. Requests go to chatgpt.com/backend-api/codex (Responses API).
//!   Unofficial for third-party apps; can break when OpenAI changes it.
//!
//! Flow: `oauth_begin` binds the loopback callback, returns the authorize URL
//! for the frontend to open, and `oauth_wait` resolves once the browser comes
//! back (or times out). Tokens live in the keychain as `oauth:<provider>`.

use crate::secrets;
use crate::state::AiConfig;
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// Provider ids (frontend registry) that authenticate with stored OAuth tokens.
pub const CODEX: &str = "codex";
pub const XAI_GROK: &str = "xai_grok";
pub const OPENROUTER: &str = "openrouter";

const CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_AUTHORIZE: &str = "https://auth.openai.com/oauth/authorize";
const CODEX_TOKEN: &str = "https://auth.openai.com/oauth/token";
const CODEX_PORT: u16 = 1455;
const CODEX_PATH: &str = "/auth/callback";

const XAI_CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_DISCOVERY: &str = "https://auth.x.ai/.well-known/openid-configuration";
const XAI_SCOPE: &str = "openid profile email offline_access grok-cli:access api:access";
const XAI_PORT: u16 = 56121;
const XAI_PATH: &str = "/callback";

const OPENROUTER_AUTHORIZE: &str = "https://openrouter.ai/auth";
const OPENROUTER_KEYS: &str = "https://openrouter.ai/api/v1/auth/keys";
const OPENROUTER_PORT: u16 = 3000;
const OPENROUTER_PATH: &str = "/openrouter-oauth/callback";

const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
/// Refresh this long before expiry so a turn never starts on a dying token.
const REFRESH_MARGIN_MS: u64 = 5 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StoredTokens {
    pub access: String,
    #[serde(default)]
    pub refresh: String,
    /// Unix ms; 0 = unknown.
    #[serde(default)]
    pub expires: u64,
    #[serde(default)]
    pub token_endpoint: String,
    #[serde(default)]
    pub email: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OAuthStatus {
    pub signed_in: bool,
    pub email: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OAuthBegin {
    pub url: String,
}

pub fn is_oauth_provider(provider: &str) -> bool {
    provider == CODEX || provider == XAI_GROK
}

fn account(provider: &str) -> String {
    format!("oauth:{provider}")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn random_b64(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

/// RFC 7636 S256 challenge for a verifier.
pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Decode a JWT payload without verifying it (we only read our own claims).
pub fn jwt_claims(token: &str) -> Option<Value> {
    let part = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD
        .decode(part.trim_end_matches('='))
        .or_else(|_| URL_SAFE.decode(part))
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// ChatGPT account id carried in Codex access tokens.
pub fn codex_account_id(access: &str) -> Option<String> {
    jwt_claims(access)?
        .get("https://api.openai.com/auth")?
        .get("chatgpt_account_id")?
        .as_str()
        .map(str::to_string)
}

fn email_from(tokens: &Value) -> String {
    for k in ["id_token", "access_token"] {
        if let Some(c) = tokens.get(k).and_then(|v| v.as_str()).and_then(jwt_claims) {
            if let Some(e) = c.get("email").and_then(|v| v.as_str()) {
                return e.to_string();
            }
            if let Some(e) = c
                .get("https://api.openai.com/profile")
                .and_then(|p| p.get("email"))
                .and_then(|v| v.as_str())
            {
                return e.to_string();
            }
        }
    }
    String::new()
}

fn load(provider: &str) -> Result<Option<StoredTokens>, String> {
    match secrets::get(&account(provider))? {
        Some(raw) => Ok(serde_json::from_str(&raw).ok()),
        None => Ok(None),
    }
}

fn save(provider: &str, t: &StoredTokens) -> Result<(), String> {
    let raw = serde_json::to_string(t).map_err(|e| e.to_string())?;
    secrets::set(&account(provider), &raw)
}

fn tokens_from_response(
    v: &Value,
    prev: Option<&StoredTokens>,
    endpoint: &str,
) -> Result<StoredTokens, String> {
    let access = v
        .get("access_token")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .ok_or("Token response had no access_token")?
        .to_string();
    let refresh = v
        .get("refresh_token")
        .and_then(|x| x.as_str())
        .map(str::to_string)
        .or_else(|| prev.map(|p| p.refresh.clone()))
        .unwrap_or_default();
    let expires = v
        .get("expires_in")
        .and_then(|x| x.as_u64())
        .map(|s| now_ms() + s * 1000)
        .or_else(|| {
            jwt_claims(&access)
                .and_then(|c| c.get("exp").and_then(|e| e.as_u64()))
                .map(|s| s * 1000)
        })
        .unwrap_or(0);
    let email = {
        let e = email_from(v);
        if e.is_empty() {
            prev.map(|p| p.email.clone()).unwrap_or_default()
        } else {
            e
        }
    };
    Ok(StoredTokens {
        access,
        refresh,
        expires,
        token_endpoint: endpoint.to_string(),
        email,
    })
}

async fn post_form(url: &str, form: &[(&str, &str)]) -> Result<Value, String> {
    let res = crate::harness::client::short_http_client()
        .post(url)
        .header("Accept", "application/json")
        .header("User-Agent", "ai-convoir/2.0")
        .form(form)
        .send()
        .await
        .map_err(|e| format!("Sign-in request failed: {e}"))?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let msg = body
            .get("error_description")
            .or_else(|| body.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(format!("Sign-in failed ({status}): {msg}"));
    }
    Ok(body)
}

async fn xai_endpoints() -> Result<(String, String), String> {
    let v: Value = crate::harness::client::short_http_client()
        .get(XAI_DISCOVERY)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("xAI discovery failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("xAI discovery parse failed: {e}"))?;
    let pick = |k: &str| -> Result<String, String> {
        let u = v.get(k).and_then(|x| x.as_str()).unwrap_or("");
        // Only ever send codes/tokens to xAI's own hosts.
        let host = crate::engine::host_of(u);
        if u.starts_with("https://") && (host == "x.ai" || host.ends_with(".x.ai")) {
            Ok(u.to_string())
        } else {
            Err(format!("xAI discovery returned an untrusted {k}"))
        }
    };
    Ok((pick("authorization_endpoint")?, pick("token_endpoint")?))
}

// ── loopback callback ────────────────────────────────────────────────

type Pending = oneshot::Receiver<Result<OAuthStatus, String>>;

fn pending() -> &'static Mutex<HashMap<String, (Pending, tokio::task::AbortHandle)>> {
    static P: OnceLock<Mutex<HashMap<String, (Pending, tokio::task::AbortHandle)>>> =
        OnceLock::new();
    P.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Query params from `GET /path?a=b HTTP/1.1`, only when the path matches.
pub fn parse_callback(request: &str, path: &str) -> Option<HashMap<String, String>> {
    let target = request.lines().next()?.split_whitespace().nth(1)?;
    let (p, q) = target.split_once('?').unwrap_or((target, ""));
    if p != path {
        return None;
    }
    let mut out = HashMap::new();
    for pair in q.split('&').filter(|s| !s.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        out.insert(url_decode(k), url_decode(v));
    }
    Some(out)
}

fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn build_url(base: &str, params: &[(&str, &str)]) -> String {
    let q: Vec<String> = params
        .iter()
        .map(|(k, v)| format!("{}={}", url_encode(k), url_encode(v)))
        .collect();
    format!("{base}?{}", q.join("&"))
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>AI ConvoIR</title>\
<body style=\"font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0\">\
<p>Signed in. You can close this tab and go back to AI ConvoIR.</p>";

async fn bind(port: u16) -> Result<Vec<TcpListener>, String> {
    let mut ls = Vec::new();
    if let Ok(l) = TcpListener::bind(("127.0.0.1", port)).await {
        ls.push(l);
    }
    // "localhost" may resolve to ::1 first.
    if let Ok(l) = TcpListener::bind(("::1", port)).await {
        ls.push(l);
    }
    if ls.is_empty() {
        return Err(format!(
            "Port {port} is busy, so the sign-in callback can't start. Close whatever uses it (another CLI sign-in?) and retry."
        ));
    }
    Ok(ls)
}

/// Wait for the browser to hit `path` with a matching `state`; answer it.
async fn await_code(
    listeners: Vec<TcpListener>,
    path: &str,
    state: &str,
) -> Result<String, String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<tokio::net::TcpStream>(8);
    let mut tasks = Vec::new();
    for l in listeners {
        let tx = tx.clone();
        tasks.push(tokio::spawn(async move {
            while let Ok((s, _)) = l.accept().await {
                if tx.send(s).await.is_err() {
                    break;
                }
            }
        }));
    }
    drop(tx);
    let result = tokio::time::timeout(LOGIN_TIMEOUT, async {
        while let Some(mut stream) = rx.recv().await {
            let mut buf = vec![0u8; 8192];
            let n = stream.read(&mut buf).await.unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let Some(params) = parse_callback(&req, path) else {
                let _ = stream
                    .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .await;
                continue;
            };
            let outcome = if let Some(err) = params.get("error") {
                Err(format!(
                    "Sign-in was cancelled: {}",
                    params.get("error_description").unwrap_or(err)
                ))
            } else if params.get("state").map(String::as_str) != Some(state) {
                Err("Sign-in state didn't match. Try again.".to_string())
            } else if let Some(code) = params.get("code").filter(|c| !c.is_empty()) {
                Ok(code.clone())
            } else {
                Err("The provider didn't return a code.".to_string())
            };
            let body = if outcome.is_ok() {
                DONE_PAGE.to_string()
            } else {
                DONE_PAGE.replace("Signed in.", "Sign-in failed.")
            };
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes()).await;
            let _ = stream.shutdown().await;
            return outcome;
        }
        Err("Sign-in listener stopped.".to_string())
    })
    .await
    .unwrap_or_else(|_| Err("Sign-in timed out. Try again.".to_string()));
    for t in tasks {
        t.abort();
    }
    result
}

// ── flows ────────────────────────────────────────────────────────────

async fn begin_flow(
    provider: &str,
) -> Result<(String, tokio::task::JoinHandle<Result<OAuthStatus, String>>), String> {
    let verifier = random_b64(48);
    let challenge = pkce_challenge(&verifier);
    let state = random_b64(24);
    match provider {
        OPENROUTER => {
            let listeners = bind(OPENROUTER_PORT).await?;
            let callback = build_url(
                &format!("http://localhost:{OPENROUTER_PORT}{OPENROUTER_PATH}"),
                &[("state", &state)],
            );
            let url = build_url(
                OPENROUTER_AUTHORIZE,
                &[
                    ("callback_url", &callback),
                    ("code_challenge", &challenge),
                    ("code_challenge_method", "S256"),
                ],
            );
            let task = tokio::spawn(async move {
                let code = await_code(listeners, OPENROUTER_PATH, &state).await?;
                let res = crate::harness::client::short_http_client()
                    .post(OPENROUTER_KEYS)
                    .json(&serde_json::json!({
                        "code": code,
                        "code_verifier": verifier,
                        "code_challenge_method": "S256",
                    }))
                    .send()
                    .await
                    .map_err(|e| format!("OpenRouter key exchange failed: {e}"))?;
                let status = res.status();
                let v: Value = res.json().await.unwrap_or(Value::Null);
                let key = v.get("key").and_then(|k| k.as_str()).unwrap_or("");
                if !status.is_success() || key.is_empty() {
                    return Err(format!("OpenRouter key exchange failed ({status})"));
                }
                secrets::set(OPENROUTER, key)?;
                Ok(OAuthStatus {
                    signed_in: true,
                    email: String::new(),
                })
            });
            Ok((url, task))
        }
        CODEX => {
            let listeners = bind(CODEX_PORT).await?;
            let redirect = format!("http://localhost:{CODEX_PORT}{CODEX_PATH}");
            let url = build_url(
                CODEX_AUTHORIZE,
                &[
                    ("response_type", "code"),
                    ("client_id", CODEX_CLIENT_ID),
                    ("redirect_uri", &redirect),
                    ("scope", "openid profile email offline_access"),
                    ("code_challenge", &challenge),
                    ("code_challenge_method", "S256"),
                    ("state", &state),
                    ("id_token_add_organizations", "true"),
                    ("codex_cli_simplified_flow", "true"),
                    ("originator", "codex_cli_rs"),
                ],
            );
            let task = tokio::spawn(async move {
                let code = await_code(listeners, CODEX_PATH, &state).await?;
                let v = post_form(
                    CODEX_TOKEN,
                    &[
                        ("grant_type", "authorization_code"),
                        ("client_id", CODEX_CLIENT_ID),
                        ("code", &code),
                        ("code_verifier", &verifier),
                        ("redirect_uri", &redirect),
                    ],
                )
                .await?;
                let t = tokens_from_response(&v, None, CODEX_TOKEN)?;
                if codex_account_id(&t.access).is_none() {
                    return Err("That account has no ChatGPT plan attached.".into());
                }
                save(CODEX, &t)?;
                Ok(OAuthStatus {
                    signed_in: true,
                    email: t.email,
                })
            });
            Ok((url, task))
        }
        XAI_GROK => {
            let (authorize, token) = xai_endpoints().await?;
            let listeners = bind(XAI_PORT).await?;
            let redirect = format!("http://127.0.0.1:{XAI_PORT}{XAI_PATH}");
            let nonce = random_b64(16);
            let url = build_url(
                &authorize,
                &[
                    ("response_type", "code"),
                    ("client_id", XAI_CLIENT_ID),
                    ("redirect_uri", &redirect),
                    ("scope", XAI_SCOPE),
                    ("state", &state),
                    ("nonce", &nonce),
                    ("code_challenge", &challenge),
                    ("code_challenge_method", "S256"),
                    ("plan", "generic"),
                ],
            );
            let task = tokio::spawn(async move {
                let code = await_code(listeners, XAI_PATH, &state).await?;
                let v = post_form(
                    &token,
                    &[
                        ("grant_type", "authorization_code"),
                        ("code", &code),
                        ("redirect_uri", &redirect),
                        ("client_id", XAI_CLIENT_ID),
                        ("code_verifier", &verifier),
                    ],
                )
                .await?;
                let t = tokens_from_response(&v, None, &token)?;
                save(XAI_GROK, &t)?;
                Ok(OAuthStatus {
                    signed_in: true,
                    email: t.email,
                })
            });
            Ok((url, task))
        }
        _ => Err("This provider has no browser sign-in.".into()),
    }
}

async fn refresh(provider: &str, t: &StoredTokens) -> Result<StoredTokens, String> {
    if t.refresh.is_empty() {
        return Err("Sign-in expired. Sign in again in Settings → Providers.".into());
    }
    let (endpoint, client_id) = match provider {
        CODEX => (CODEX_TOKEN.to_string(), CODEX_CLIENT_ID),
        XAI_GROK => {
            let ep = if t.token_endpoint.is_empty() {
                xai_endpoints().await?.1
            } else {
                t.token_endpoint.clone()
            };
            (ep, XAI_CLIENT_ID)
        }
        _ => return Err("not an OAuth provider".into()),
    };
    let v = post_form(
        &endpoint,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", &t.refresh),
            ("client_id", client_id),
        ],
    )
    .await
    .map_err(|e| format!("{e}. Sign in again in Settings → Providers."))?;
    let next = tokens_from_response(&v, Some(t), &endpoint)?;
    save(provider, &next)?;
    Ok(next)
}

/// Serializes refreshes so two voices on one account don't race the refresh token.
fn refresh_lock() -> &'static tokio::sync::Mutex<()> {
    static L: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    L.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// Fresh access token for an OAuth provider, refreshing when close to expiry.
pub async fn access_token(provider: &str) -> Result<String, String> {
    let _guard = refresh_lock().lock().await;
    let t = load(provider)?.ok_or("Not signed in. Sign in under Settings → Providers.")?;
    if t.expires == 0 || t.expires > now_ms() + REFRESH_MARGIN_MS {
        return Ok(t.access);
    }
    Ok(refresh(provider, &t).await?.access)
}

/// Copy of `config` with the OAuth access token as its key (no-op otherwise).
pub async fn hydrate(config: &AiConfig) -> Result<AiConfig, String> {
    let mut c = config.clone();
    if is_oauth_provider(&config.provider) {
        c.api_key = access_token(&config.provider).await?;
    }
    Ok(c)
}

// ── commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn oauth_begin(provider: String) -> Result<OAuthBegin, String> {
    // A second click restarts the flow and frees the port.
    if let Some((_, h)) = pending()
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&provider)
    {
        h.abort();
    }
    let (url, task) = begin_flow(&provider).await?;
    let (tx, rx) = oneshot::channel();
    let abort = task.abort_handle();
    tokio::spawn(async move {
        let r = task
            .await
            .unwrap_or_else(|_| Err("Sign-in was cancelled.".to_string()));
        let _ = tx.send(r);
    });
    pending()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(provider, (rx, abort));
    Ok(OAuthBegin { url })
}

#[tauri::command]
pub async fn oauth_wait(provider: String) -> Result<OAuthStatus, String> {
    let (rx, _) = pending()
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&provider)
        .ok_or("No sign-in in progress.")?;
    rx.await
        .unwrap_or_else(|_| Err("Sign-in was cancelled.".to_string()))
}

#[tauri::command]
pub async fn oauth_cancel(provider: String) -> Result<(), String> {
    if let Some((_, h)) = pending()
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&provider)
    {
        h.abort();
    }
    Ok(())
}

#[tauri::command]
pub async fn oauth_status(provider: String) -> Result<OAuthStatus, String> {
    let t = load(&provider)?;
    Ok(OAuthStatus {
        signed_in: t.as_ref().map(|t| !t.access.is_empty()).unwrap_or(false),
        email: t.map(|t| t.email).unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn oauth_logout(provider: String) -> Result<(), String> {
    if !is_oauth_provider(&provider) {
        return Err("not an OAuth provider".into());
    }
    secrets::delete(&account(&provider))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn hit(port: u16, target: &str) -> String {
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        s.write_all(format!("GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n").as_bytes())
            .await
            .unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).await.unwrap();
        out
    }

    #[tokio::test]
    async fn loopback_ignores_strays_and_returns_code() {
        let l = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = l.local_addr().unwrap().port();
        let wait = tokio::spawn(async move { await_code(vec![l], "/cb", "st8").await });
        assert!(hit(port, "/favicon.ico").await.starts_with("HTTP/1.1 404"));
        assert!(hit(port, "/cb?code=abc&state=st8")
            .await
            .contains("Signed in."));
        assert_eq!(wait.await.unwrap().unwrap(), "abc");
    }

    #[tokio::test]
    async fn loopback_rejects_wrong_state() {
        let l = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = l.local_addr().unwrap().port();
        let wait = tokio::spawn(async move { await_code(vec![l], "/cb", "good").await });
        assert!(hit(port, "/cb?code=abc&state=evil")
            .await
            .contains("Sign-in failed."));
        assert!(wait.await.unwrap().is_err());
    }

    #[test]
    fn pkce_matches_rfc7636_example() {
        // RFC 7636 Appendix B.
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn callback_parsing() {
        let req = "GET /auth/callback?code=ab%2Fc&state=xyz HTTP/1.1\r\nHost: localhost\r\n\r\n";
        let p = parse_callback(req, "/auth/callback").unwrap();
        assert_eq!(p["code"], "ab/c");
        assert_eq!(p["state"], "xyz");
        assert!(parse_callback("GET /favicon.ico HTTP/1.1\r\n", "/auth/callback").is_none());
        assert!(
            parse_callback("GET /auth/callback HTTP/1.1\r\n", "/auth/callback")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn url_encoding_round_trip() {
        let s = "http://localhost:3000/cb?state=a b&x=ü";
        assert_eq!(url_decode(&url_encode(s)), s);
        assert_eq!(url_decode("%zz"), "%zz");
        assert_eq!(url_decode("100%"), "100%");
    }

    #[test]
    fn codex_account_from_jwt() {
        let payload = serde_json::json!({
            "https://api.openai.com/auth": { "chatgpt_account_id": "acc-123" },
            "exp": 2_000_000_000u64
        });
        let tok = format!(
            "h.{}.s",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap())
        );
        assert_eq!(codex_account_id(&tok).as_deref(), Some("acc-123"));
        assert_eq!(codex_account_id("not-a-jwt"), None);
        let t =
            tokens_from_response(&serde_json::json!({ "access_token": tok }), None, "e").unwrap();
        assert_eq!(t.expires, 2_000_000_000_000);
    }

    #[test]
    fn only_codex_and_grok_are_token_providers() {
        assert!(is_oauth_provider("codex"));
        assert!(is_oauth_provider("xai_grok"));
        assert!(!is_oauth_provider("openrouter"));
        assert!(!is_oauth_provider("xai"));
    }
}
