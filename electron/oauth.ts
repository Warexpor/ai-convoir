//! Browser sign-in for providers that support it.
//!
//! - OpenRouter: official PKCE flow that mints a regular API key, stored like
//!   a pasted key (account `openrouter`).
//! - xAI (SuperGrok / X Premium+): PKCE against auth.x.ai with xAI's shared CLI
//!   client. Tokens refresh; requests go to api.x.ai with the access token.
//! - ChatGPT (Codex): PKCE against auth.openai.com with the Codex CLI's public
//!   client. Requests go to chatgpt.com/backend-api/codex (Responses API).
//!   Unofficial for third-party apps; can break when OpenAI changes it.
//!
//! `oauth_begin` binds the loopback callback and returns the authorize URL;
//! `oauth_wait` resolves once the browser comes back (or times out).
//! Tokens live in secrets as `oauth:<provider>`.

import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import * as secrets from "./secrets.js";
import { hostOf } from "./engine.js";
import { codexAccountId, jwtClaims } from "./jwt.js";
import type { AiConfig } from "./state.js";

export const CODEX = "codex";
export const XAI_GROK = "xai_grok";
export const OPENROUTER = "openrouter";

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_AUTHORIZE = "https://auth.openai.com/oauth/authorize";
const CODEX_TOKEN = "https://auth.openai.com/oauth/token";
const CODEX_PORT = 1455;
const CODEX_PATH = "/auth/callback";

const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_DISCOVERY = "https://auth.x.ai/.well-known/openid-configuration";
const XAI_SCOPE = "openid profile email offline_access grok-cli:access api:access";
const XAI_PORT = 56121;
const XAI_PATH = "/callback";

const OPENROUTER_AUTHORIZE = "https://openrouter.ai/auth";
const OPENROUTER_KEYS = "https://openrouter.ai/api/v1/auth/keys";
const OPENROUTER_PORT = 3000;
const OPENROUTER_PATH = "/openrouter-oauth/callback";

const LOGIN_TIMEOUT_MS = 300_000;
/** Refresh this long before expiry so a turn never starts on a dying token. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const HTTP_TIMEOUT_MS = 30_000;

type Json = Record<string, unknown>;

interface StoredTokens {
  access: string;
  refresh: string;
  /** Unix ms; 0 = unknown. */
  expires: number;
  token_endpoint: string;
  email: string;
}

export interface OAuthStatus {
  signed_in: boolean;
  email: string;
}

export function isOauthProvider(provider: string): boolean {
  return provider === CODEX || provider === XAI_GROK;
}

const account = (provider: string) => `oauth:${provider}`;
const randomB64 = (n: number) => randomBytes(n).toString("base64url");

/** RFC 7636 S256 challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function emailFrom(tokens: Json): string {
  for (const k of ["id_token", "access_token"]) {
    const t = tokens[k];
    const c = typeof t === "string" ? jwtClaims(t) : null;
    if (!c) continue;
    if (typeof c.email === "string") return c.email;
    const prof = c["https://api.openai.com/profile"] as Json | undefined;
    if (typeof prof?.email === "string") return prof.email;
  }
  return "";
}

function load(provider: string): StoredTokens | null {
  const raw = secrets.get(account(provider));
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredTokens>;
    if (typeof v.access !== "string") return null;
    return {
      access: v.access,
      refresh: v.refresh ?? "",
      expires: v.expires ?? 0,
      token_endpoint: v.token_endpoint ?? "",
      email: v.email ?? "",
    };
  } catch {
    return null;
  }
}

function save(provider: string, t: StoredTokens) {
  secrets.set(account(provider), JSON.stringify(t));
}

function tokensFromResponse(v: Json, prev: StoredTokens | null, endpoint: string): StoredTokens {
  const access = typeof v.access_token === "string" ? v.access_token : "";
  if (!access) throw new Error("Token response had no access_token");
  const refresh = typeof v.refresh_token === "string" ? v.refresh_token : (prev?.refresh ?? "");
  let expires = 0;
  if (typeof v.expires_in === "number") expires = Date.now() + v.expires_in * 1000;
  else {
    const exp = jwtClaims(access)?.exp;
    if (typeof exp === "number") expires = exp * 1000;
  }
  const email = emailFrom(v) || prev?.email || "";
  return { access, refresh, expires, token_endpoint: endpoint, email };
}

async function postForm(url: string, form: Record<string, string>): Promise<Json> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "User-Agent": "ai-convoir/2.0",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`Sign-in request failed: ${(e as Error).message}`);
  }
  const body = ((await res.json().catch(() => null)) as Json | null) ?? {};
  if (!res.ok) {
    const msg = body.error_description ?? body.error;
    throw new Error(`Sign-in failed (${res.status}): ${typeof msg === "string" ? msg : "unknown error"}`);
  }
  return body;
}

async function xaiEndpoints(): Promise<[string, string]> {
  let v: Json;
  try {
    const res = await fetch(XAI_DISCOVERY, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    v = (await res.json()) as Json;
  } catch (e) {
    throw new Error(`xAI discovery failed: ${(e as Error).message}`);
  }
  const pick = (k: string) => {
    const u = typeof v[k] === "string" ? (v[k] as string) : "";
    // Only ever send codes/tokens to xAI's own hosts.
    const host = hostOf(u);
    if (u.startsWith("https://") && (host === "x.ai" || host.endsWith(".x.ai"))) return u;
    throw new Error(`xAI discovery returned an untrusted ${k}`);
  };
  return [pick("authorization_endpoint"), pick("token_endpoint")];
}

// ── loopback callback ────────────────────────────────────────────────

function buildUrl(base: string, params: Record<string, string>): string {
  const q = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${base}?${q}`;
}

const DONE_PAGE =
  '<!doctype html><meta charset=utf-8><title>AI ConvoIR</title>' +
  '<body style="font:16px system-ui;background:#111;color:#ececec;display:grid;place-items:center;height:100vh;margin:0">' +
  "<p>Signed in. You can close this tab and go back to AI ConvoIR.</p>";

interface Callback {
  servers: http.Server[];
  code: Promise<string>;
  close: () => void;
}

/** Bind 127.0.0.1 (+ ::1, since "localhost" may resolve there first) and wait for the code. */
async function listen(port: number, cbPath: string, state: string): Promise<Callback> {
  let settle!: (r: { ok: string } | { err: string }) => void;
  const result = new Promise<{ ok: string } | { err: string }>((r) => (settle = r));
  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== cbPath) {
      res.writeHead(404, { Connection: "close" }).end();
      return;
    }
    const p = url.searchParams;
    let outcome: { ok: string } | { err: string };
    if (p.get("error")) outcome = { err: `Sign-in was cancelled: ${p.get("error_description") || p.get("error")}` };
    else if (p.get("state") !== state) outcome = { err: "Sign-in state didn't match. Try again." };
    else if (p.get("code")) outcome = { ok: p.get("code")! };
    else outcome = { err: "The provider didn't return a code." };
    const body = "ok" in outcome ? DONE_PAGE : DONE_PAGE.replace("Signed in.", "Sign-in failed.");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", Connection: "close" }).end(body);
    settle(outcome);
  };
  const servers: http.Server[] = [];
  for (const host of ["127.0.0.1", "::1"]) {
    const s = http.createServer(handler);
    const ok = await new Promise<boolean>((resolve) => {
      s.once("error", () => resolve(false));
      s.listen(port, host, () => resolve(true));
    });
    if (ok) servers.push(s);
  }
  if (!servers.length) {
    throw new Error(
      `Port ${port} is busy, so the sign-in callback can't start. Close whatever uses it (another CLI sign-in?) and retry.`,
    );
  }
  let timer: NodeJS.Timeout;
  const close = () => {
    clearTimeout(timer);
    servers.forEach((s) => {
      s.closeAllConnections();
      s.close();
    });
    settle({ err: "Sign-in was cancelled." });
  };
  timer = setTimeout(() => settle({ err: "Sign-in timed out. Try again." }), LOGIN_TIMEOUT_MS);
  const code = result.then((r) => {
    close();
    if ("err" in r) throw new Error(r.err);
    return r.ok;
  });
  code.catch(() => {});
  return { servers, code, close };
}

// ── flows ────────────────────────────────────────────────────────────

interface Pending {
  done: Promise<OAuthStatus>;
  cancel: () => void;
}
const pending = new Map<string, Pending>();

async function beginFlow(provider: string): Promise<{ url: string } & Pending> {
  const verifier = randomB64(48);
  const challenge = pkceChallenge(verifier);
  const state = randomB64(24);

  if (provider === OPENROUTER) {
    const cb = await listen(OPENROUTER_PORT, OPENROUTER_PATH, state);
    const callback = buildUrl(`http://localhost:${OPENROUTER_PORT}${OPENROUTER_PATH}`, { state });
    const url = buildUrl(OPENROUTER_AUTHORIZE, {
      callback_url: callback,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const done = cb.code.then(async (code) => {
      let res: Response;
      try {
        res = await fetch(OPENROUTER_KEYS, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
      } catch (e) {
        throw new Error(`OpenRouter key exchange failed: ${(e as Error).message}`);
      }
      const v = ((await res.json().catch(() => null)) as Json | null) ?? {};
      const key = typeof v.key === "string" ? v.key : "";
      if (!res.ok || !key) throw new Error(`OpenRouter key exchange failed (${res.status})`);
      secrets.set(OPENROUTER, key);
      return { signed_in: true, email: "" };
    });
    return { url, done, cancel: cb.close };
  }

  if (provider === CODEX) {
    const cb = await listen(CODEX_PORT, CODEX_PATH, state);
    const redirect = `http://localhost:${CODEX_PORT}${CODEX_PATH}`;
    const url = buildUrl(CODEX_AUTHORIZE, {
      response_type: "code",
      client_id: CODEX_CLIENT_ID,
      redirect_uri: redirect,
      scope: "openid profile email offline_access",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "codex_cli_rs",
    });
    const done = cb.code.then(async (code) => {
      const v = await postForm(CODEX_TOKEN, {
        grant_type: "authorization_code",
        client_id: CODEX_CLIENT_ID,
        code,
        code_verifier: verifier,
        redirect_uri: redirect,
      });
      const t = tokensFromResponse(v, null, CODEX_TOKEN);
      if (!codexAccountId(t.access)) throw new Error("That account has no ChatGPT plan attached.");
      save(CODEX, t);
      return { signed_in: true, email: t.email };
    });
    return { url, done, cancel: cb.close };
  }

  if (provider === XAI_GROK) {
    const [authorize, token] = await xaiEndpoints();
    const cb = await listen(XAI_PORT, XAI_PATH, state);
    const redirect = `http://127.0.0.1:${XAI_PORT}${XAI_PATH}`;
    const url = buildUrl(authorize, {
      response_type: "code",
      client_id: XAI_CLIENT_ID,
      redirect_uri: redirect,
      scope: XAI_SCOPE,
      state,
      nonce: randomB64(16),
      code_challenge: challenge,
      code_challenge_method: "S256",
      plan: "generic",
    });
    const done = cb.code.then(async (code) => {
      const v = await postForm(token, {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
        client_id: XAI_CLIENT_ID,
        code_verifier: verifier,
      });
      const t = tokensFromResponse(v, null, token);
      save(XAI_GROK, t);
      return { signed_in: true, email: t.email };
    });
    return { url, done, cancel: cb.close };
  }

  throw new Error("This provider has no browser sign-in.");
}

async function refresh(provider: string, t: StoredTokens): Promise<StoredTokens> {
  if (!t.refresh) throw new Error("Sign-in expired. Sign in again in Settings → Providers.");
  let endpoint: string;
  let clientId: string;
  if (provider === CODEX) {
    endpoint = CODEX_TOKEN;
    clientId = CODEX_CLIENT_ID;
  } else if (provider === XAI_GROK) {
    endpoint = t.token_endpoint || (await xaiEndpoints())[1];
    clientId = XAI_CLIENT_ID;
  } else throw new Error("not an OAuth provider");
  let v: Json;
  try {
    v = await postForm(endpoint, { grant_type: "refresh_token", refresh_token: t.refresh, client_id: clientId });
  } catch (e) {
    throw new Error(`${(e as Error).message}. Sign in again in Settings → Providers.`);
  }
  const next = tokensFromResponse(v, t, endpoint);
  save(provider, next);
  return next;
}

/** Serializes refreshes so two voices on one account don't race the refresh token. */
let refreshChain: Promise<unknown> = Promise.resolve();

export function accessToken(provider: string): Promise<string> {
  const run = refreshChain.then(async () => {
    const t = load(provider);
    if (!t) throw new Error("Not signed in. Sign in under Settings → Providers.");
    if (t.expires === 0 || t.expires > Date.now() + REFRESH_MARGIN_MS) return t.access;
    return (await refresh(provider, t)).access;
  });
  refreshChain = run.catch(() => {});
  return run;
}

/** Copy of `config` with the OAuth access token as its key (no-op otherwise). */
export async function hydrate(config: AiConfig): Promise<AiConfig> {
  if (!isOauthProvider(config.provider)) return config;
  return { ...config, api_key: await accessToken(config.provider) };
}

// ── commands ─────────────────────────────────────────────────────────

export async function oauthBegin(provider: string): Promise<{ url: string }> {
  // A second click restarts the flow and frees the port.
  pending.get(provider)?.cancel();
  pending.delete(provider);
  const flow = await beginFlow(provider);
  flow.done.catch(() => {});
  pending.set(provider, { done: flow.done, cancel: flow.cancel });
  return { url: flow.url };
}

export async function oauthWait(provider: string): Promise<OAuthStatus> {
  const p = pending.get(provider);
  if (!p) throw new Error("No sign-in in progress.");
  pending.delete(provider);
  return p.done;
}

export function oauthCancel(provider: string) {
  pending.get(provider)?.cancel();
  pending.delete(provider);
}

export function oauthStatus(provider: string): OAuthStatus {
  const t = load(provider);
  return { signed_in: !!t?.access, email: t?.email ?? "" };
}

export function oauthLogout(provider: string) {
  if (!isOauthProvider(provider)) throw new Error("not an OAuth provider");
  secrets.remove(account(provider));
}

export function cancelAllSignIns() {
  for (const p of pending.values()) p.cancel();
  pending.clear();
}
