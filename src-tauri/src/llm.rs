use crate::engine::{
    build_chat_body, chat_url, extract_sse_deltas, extract_text_content, models_url,
    parse_models_response, responses_url, uses_responses_api, StreamPiece,
};
use crate::harness::cache::{
    apply_prompt_cache_key, extract_usage, TokenUsage,
};
use crate::harness::client::{short_http_client, stream_http_client};
use crate::harness::prepare::PreparedTurn;
use crate::state::{AiConfig, Message};
use futures_util::StreamExt;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Returned when reset/stop cancels an in-flight SSE stream.
pub const STREAM_ABORTED: &str = "aborted";

/// Result of a streamed (or fallback non-stream) turn.
#[derive(Debug, Clone)]
pub struct StreamOutcome {
    pub content: String,
    pub reasoning: Option<String>,
    pub usage: TokenUsage,
    pub ttft_ms: Option<u64>,
    pub stream_duration_ms: u64,
}

impl StreamOutcome {
    fn from_text(
        content: String,
        reasoning: Option<String>,
        usage: TokenUsage,
        started: Instant,
        ttft_ms: Option<u64>,
    ) -> Self {
        Self {
            content,
            reasoning,
            usage,
            ttft_ms,
            stream_duration_ms: started.elapsed().as_millis() as u64,
        }
    }
}

/// Cancel signal for an in-flight stream: reset clears transcript; epoch bumps on stop/switch.
pub struct StreamCancel<'a> {
    pub reset: &'a AtomicBool,
    pub epoch: &'a AtomicU64,
    pub epoch_at_start: u64,
}

impl StreamCancel<'_> {
    pub fn is_cancelled(&self) -> bool {
        self.reset.load(Ordering::Acquire)
            || self.epoch.load(Ordering::Acquire) != self.epoch_at_start
    }
}

/// Poll until cancel so HTTP futures can be dropped promptly (no 900s hang).
async fn until_cancelled(cancel: &StreamCancel<'_>) {
    loop {
        if cancel.is_cancelled() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// Race any future against cancel (biased: cancel wins if already set).
/// Extracted so unit tests can prove cancel-wins without mocking `reqwest::Response`.
async fn race_cancel<T>(
    cancel: &StreamCancel<'_>,
    fut: impl std::future::Future<Output = T>,
) -> Result<T, String> {
    tokio::select! {
        biased;
        _ = until_cancelled(cancel) => Err(STREAM_ABORTED.into()),
        v = fut => Ok(v),
    }
}

/// Race `res.json()` against cancel so stop/FreshStart does not hang on error bodies.
async fn json_with_cancel(
    res: reqwest::Response,
    cancel: &StreamCancel<'_>,
) -> Result<Value, String> {
    let data = race_cancel(cancel, res.json::<Value>()).await?;
    data.map_err(|e| format!("Parse failed: {}", e))
}

/// Like `json_with_cancel`, but empty object on parse failure (API error bodies).
async fn error_json_with_cancel(
    res: reqwest::Response,
    cancel: &StreamCancel<'_>,
) -> Result<Value, String> {
    let data = race_cancel(cancel, res.json::<Value>()).await?;
    Ok(data.unwrap_or_else(|_| serde_json::json!({})))
}

/// Non-streaming call. Returns (content, optional reasoning).
#[allow(dead_code)]
pub async fn call_llm(
    config: &AiConfig,
    speaking_agent: &str,
    messages_context: &[Message],
    narration: Option<&str>,
) -> Result<(String, Option<String>), String> {
    let reset = AtomicBool::new(false);
    let epoch = AtomicU64::new(0);
    let cancel = StreamCancel {
        reset: &reset,
        epoch: &epoch,
        epoch_at_start: 0,
    };
    let (content, reasoning, _usage) =
        call_llm_with_usage(config, speaking_agent, messages_context, narration, &cancel).await?;
    Ok((content, reasoning))
}

async fn call_llm_with_usage(
    config: &AiConfig,
    speaking_agent: &str,
    messages_context: &[Message],
    narration: Option<&str>,
    cancel: &StreamCancel<'_>,
) -> Result<(String, Option<String>, TokenUsage), String> {
    let client = short_http_client();

    let mut body = build_chat_body(config, speaking_agent, messages_context, false, narration);
    let cache_key = crate::harness::compute_prompt_cache_key(config, speaking_agent);
    apply_prompt_cache_key(&mut body, &cache_key);
    let url = chat_url(&config.api_base_url);

    let send_fut = apply_go_headers(
        client.post(&url).header("Content-Type", "application/json"),
        &config.api_key,
        "ai-convoir",
    )
    .json(&body)
    .send();

    let res = tokio::select! {
        biased;
        _ = until_cancelled(cancel) => {
            return Err(STREAM_ABORTED.into());
        }
        res = send_fut => {
            res.map_err(|e| format!("Request failed: {}", e))?
        }
    };

    let status = res.status();
    if !status.is_success() {
        let data = error_json_with_cancel(res, cancel).await?;
        let err_msg = data["error"]["message"]
            .as_str()
            .or_else(|| data["error"].as_str())
            .unwrap_or("unknown API error");
        return Err(format!("API {}: {}", status, err_msg));
    }

    let data = json_with_cancel(res, cancel).await?;

    let usage = extract_usage(&data);
    let msg = &data["choices"][0]["message"];
    let finish_reason = data["choices"][0]["finish_reason"]
        .as_str()
        .unwrap_or("stop");

    let (content, reasoning): (String, Option<String>) = match extract_text_content(&msg["content"])
    {
        Some(text) => {
            let mut reasoning = None;
            for key in [
                "reasoning_content",
                "reasoning",
                "thinking",
                "reasoning_text",
            ] {
                if let Some(t) = extract_text_content(&msg[key]) {
                    reasoning = Some(t);
                    break;
                }
            }
            (text, reasoning)
        }
        None => {
            if let Some(r) = extract_text_content(&msg["reasoning_content"])
                .or_else(|| extract_text_content(&msg["reasoning"]))
                .or_else(|| extract_text_content(&msg["thinking"]))
            {
                (r.clone(), Some(r))
            } else if let Some(t) = extract_text_content(&data["choices"][0]["text"]) {
                (t, None)
            } else {
                return Err(format!(
                    "No content in API response (finish_reason: {})",
                    finish_reason
                ));
            }
        }
    };

    Ok((content, reasoning, usage))
}

fn apply_go_headers(
    req: reqwest::RequestBuilder,
    api_key: &str,
    session_id: &str,
) -> reqwest::RequestBuilder {
    let session = if session_id.trim().is_empty() {
        "ai-convoir"
    } else {
        session_id
    };
    req.header("Authorization", format!("Bearer {}", api_key))
        .header("User-Agent", "ai-convoir/2.0")
        .header("x-opencode-session", session)
}

fn responses_body_from_chat(chat: &Value, config: &AiConfig, stream: bool) -> Value {
    let msgs = chat["messages"].as_array().cloned().unwrap_or_default();
    let mut instructions = String::new();
    let mut input: Vec<Value> = Vec::new();
    for m in msgs {
        let role = m.get("role").and_then(|v| v.as_str()).unwrap_or("");
        let content = m.get("content").and_then(|v| v.as_str()).unwrap_or("");
        if role == "system" && instructions.is_empty() {
            instructions = content.to_string();
        } else {
            input.push(serde_json::json!({ "role": role, "content": content }));
        }
    }
    let model = if config.model.trim().is_empty() {
        "muse-spark-1.3-contributor"
    } else {
        config.model.as_str()
    };
    let mut body = serde_json::json!({
        "model": model,
        "instructions": instructions,
        "input": input,
        "stream": stream,
        "temperature": config.temperature,
    });
    // Responses API uses max_output_tokens (chat/completions used max_tokens).
    if config.max_tokens > 0 {
        body["max_output_tokens"] = serde_json::json!(config.max_tokens);
    }
    if let Some(key) = chat.get("prompt_cache_key").and_then(|v| v.as_str()) {
        apply_prompt_cache_key(&mut body, key);
    }
    body
}

fn parse_responses_event(event: &str, data: &str) -> (Vec<StreamPiece>, TokenUsage) {
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return (vec![], TokenUsage::default());
    }
    let Ok(v) = serde_json::from_str::<Value>(data) else {
        return (vec![], TokenUsage::default());
    };
    let usage = extract_usage(&v);
    // Live OpenAI / proxies often put the type only in JSON (no SSE `event:` line).
    let event_ty = if event.is_empty() {
        v.get("type").and_then(|t| t.as_str()).unwrap_or("")
    } else {
        event
    };
    // Note: `response.completed` is intentionally ignored here — harvesting its
    // full text during a live delta stream would duplicate tokens. Empty-SSE
    // recovery uses `harvest_responses_completed` instead.

    let text = v
        .get("delta")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("text").and_then(|x| x.as_str()))
        .or_else(|| v.get("refusal").and_then(|x| x.as_str()))
        .unwrap_or("");
    if text.is_empty() {
        return (vec![], usage);
    }
    let pieces = match event_ty {
        "response.output_text.delta" => vec![StreamPiece::Content(text.to_string())],
        "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
            vec![StreamPiece::Reasoning(text.to_string())]
        }
        // Surface refusals as visible content so the FE is not left blank.
        "response.refusal.delta" => vec![StreamPiece::Content(text.to_string())],
        _ => vec![],
    };
    (pieces, usage)
}

/// Parse one SSE event block (`event:` / one or more `data:` lines).
pub(crate) fn parse_responses_sse_block(block: &str) -> (Vec<StreamPiece>, TokenUsage) {
    let mut event = "";
    let mut data = String::new();
    for line in block.lines() {
        if let Some(v) = line.strip_prefix("event:") {
            event = v.trim();
        } else if let Some(v) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(v.trim());
        }
    }
    parse_responses_event(event, &data)
}

/// Flush a trailing Responses SSE fragment that lacked a final blank line.
pub(crate) fn flush_responses_trailing(text_buf: &str) -> (Vec<StreamPiece>, TokenUsage) {
    if text_buf.trim().is_empty() {
        return (vec![], TokenUsage::default());
    }
    let trailing = text_buf.replace("\r\n", "\n").replace('\r', "\n");
    parse_responses_sse_block(&trailing)
}

/// Scan an SSE buffer for a `response.completed` payload and extract final text.
/// Used only when the live stream produced no content deltas (empty-SSE recovery).
pub(crate) fn harvest_responses_completed(
    buffer: &str,
) -> Option<(String, Option<String>, TokenUsage)> {
    let normalized = buffer.replace("\r\n", "\n").replace('\r', "\n");
    for block in normalized.split("\n\n") {
        let mut event = "";
        let mut data = String::new();
        for line in block.lines() {
            if let Some(v) = line.strip_prefix("event:") {
                event = v.trim();
            } else if let Some(v) = line.strip_prefix("data:") {
                if !data.is_empty() {
                    data.push('\n');
                }
                data.push_str(v.trim());
            }
        }
        let data = data.trim();
        if data.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        let event_ty = if event.is_empty() {
            v.get("type").and_then(|t| t.as_str()).unwrap_or("")
        } else {
            event
        };
        if event_ty != "response.completed" {
            continue;
        }
        let resp = v.get("response").unwrap_or(&v);
        let usage = extract_usage(resp);
        if let Ok((content, reasoning)) = extract_responses_output(resp) {
            if !content.is_empty() {
                return Some((content, reasoning, usage));
            }
        }
    }
    None
}

/// Pull visible text (+ optional reasoning) from a non-stream Responses JSON body.
/// Handles `output_text`, `output[]` message/reasoning items, and a chat-shaped fallback.
pub(crate) fn extract_responses_output(data: &Value) -> Result<(String, Option<String>), String> {
    // Convenience field some servers expose on completed responses.
    if let Some(t) = data.get("output_text").and_then(|v| extract_text_content(v)) {
        let reasoning = extract_responses_reasoning(data);
        return Ok((t, reasoning));
    }

    let mut content = String::new();
    let mut reasoning = String::new();
    if let Some(items) = data.get("output").and_then(|v| v.as_array()) {
        for item in items {
            let ty = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
            match ty {
                "message" => {
                    if let Some(parts) = item.get("content").and_then(|c| c.as_array()) {
                        for part in parts {
                            let pty = part.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            if pty == "output_text" || pty == "text" {
                                if let Some(t) = part.get("text").and_then(|x| x.as_str()) {
                                    content.push_str(t);
                                }
                            } else if pty == "refusal" {
                                if let Some(t) = part
                                    .get("refusal")
                                    .and_then(|x| x.as_str())
                                    .or_else(|| part.get("text").and_then(|x| x.as_str()))
                                {
                                    content.push_str(t);
                                }
                            }
                        }
                    } else if let Some(t) = extract_text_content(&item["content"]) {
                        content.push_str(&t);
                    }
                }
                "reasoning" => {
                    // summary: [{type: summary_text, text}] or content parts
                    if let Some(parts) = item.get("summary").and_then(|c| c.as_array()) {
                        for part in parts {
                            if let Some(t) = part.get("text").and_then(|x| x.as_str()) {
                                reasoning.push_str(t);
                            }
                        }
                    }
                    if let Some(parts) = item.get("content").and_then(|c| c.as_array()) {
                        for part in parts {
                            if let Some(t) = part.get("text").and_then(|x| x.as_str()) {
                                reasoning.push_str(t);
                            }
                        }
                    }
                }
                _ => {
                    // Some proxies omit `type` and only set role=assistant.
                    if ty.is_empty()
                        && item.get("role").and_then(|r| r.as_str()) == Some("assistant")
                    {
                        if let Some(parts) = item.get("content").and_then(|c| c.as_array()) {
                            for part in parts {
                                let pty =
                                    part.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                if pty == "output_text" || pty == "text" || pty.is_empty() {
                                    if let Some(t) = part.get("text").and_then(|x| x.as_str()) {
                                        content.push_str(t);
                                    }
                                } else if pty == "refusal" {
                                    if let Some(t) = part
                                        .get("refusal")
                                        .and_then(|x| x.as_str())
                                        .or_else(|| part.get("text").and_then(|x| x.as_str()))
                                    {
                                        content.push_str(t);
                                    }
                                }
                            }
                        } else if let Some(t) = extract_text_content(&item["content"]) {
                            content.push_str(&t);
                        }
                    }
                }
            }
        }
    }

    if content.is_empty() {
        // Chat-completions shaped proxy response
        if let Some(msg) = data
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|a| a.first())
            .and_then(|ch| ch.get("message"))
        {
            if let Some(t) = extract_text_content(&msg["content"]) {
                content = t;
            }
            for key in ["reasoning_content", "reasoning", "thinking", "reasoning_text"] {
                if let Some(t) = extract_text_content(&msg[key]) {
                    reasoning = t;
                    break;
                }
            }
        }
    }

    if content.is_empty() && !reasoning.is_empty() {
        content = reasoning.clone();
    }
    if content.is_empty() {
        return Err("No content in Responses API output".into());
    }
    let reasoning_opt = if reasoning.is_empty() {
        None
    } else {
        Some(reasoning)
    };
    Ok((content, reasoning_opt))
}

fn extract_responses_reasoning(data: &Value) -> Option<String> {
    let mut reasoning = String::new();
    if let Some(items) = data.get("output").and_then(|v| v.as_array()) {
        for item in items {
            if item.get("type").and_then(|t| t.as_str()) != Some("reasoning") {
                continue;
            }
            // Mirror extract_responses_output: summary and content parts.
            if let Some(parts) = item.get("summary").and_then(|c| c.as_array()) {
                for part in parts {
                    if let Some(t) = part.get("text").and_then(|x| x.as_str()) {
                        reasoning.push_str(t);
                    }
                }
            }
            if let Some(parts) = item.get("content").and_then(|c| c.as_array()) {
                for part in parts {
                    if let Some(t) = part.get("text").and_then(|x| x.as_str()) {
                        reasoning.push_str(t);
                    }
                }
            }
        }
    }
    if reasoning.is_empty() {
        None
    } else {
        Some(reasoning)
    }
}

/// Promote reasoning-only SSE into the content reply buffer.
/// Returns true when promotion happened — caller should emit a content chunk
/// so the FE matches non-stream fallback (which always emits content).
pub(crate) fn promote_reasoning_only(full: &mut String, full_reasoning: &str) -> bool {
    if full.is_empty() && !full_reasoning.is_empty() {
        *full = full_reasoning.to_string();
        true
    } else {
        false
    }
}

/// Consume complete `\n\n`-delimited Responses SSE blocks; return leftover + pieces.
pub(crate) fn consume_responses_sse(
    buffer: &str,
) -> (Vec<StreamPiece>, String, TokenUsage) {
    let normalized = buffer.replace("\r\n", "\n").replace('\r', "\n");
    let parts: Vec<&str> = normalized.split("\n\n").collect();
    if parts.len() <= 1 {
        return (vec![], normalized, TokenUsage::default());
    }
    let mut pieces = Vec::new();
    let mut usage = TokenUsage::default();
    for block in &parts[..parts.len() - 1] {
        let (p, u) = parse_responses_sse_block(block);
        usage.merge(&u);
        pieces.extend(p);
    }
    let rest = parts.last().unwrap_or(&"").to_string();
    (pieces, rest, usage)
}

fn emit_chunk(app_handle: &AppHandle, agent: &str, turn: u32, kind: &str, delta: &str) {
    if delta.is_empty() {
        return;
    }
    let _ = app_handle.emit(
        "stream-chunk",
        serde_json::json!({
            "agent": agent,
            "turn": turn,
            "kind": kind,
            "delta": delta,
        }),
    );
}

fn emit_stream_start(app_handle: &AppHandle, agent: &str, turn: u32, created_at: u64) {
    let _ = app_handle.emit(
        "stream-start",
        serde_json::json!({
            "agent": agent,
            "turn": turn,
            "created_at": created_at,
        }),
    );
}

fn note_ttft(started: Instant, ttft_ms: &mut Option<u64>) {
    if ttft_ms.is_none() {
        *ttft_ms = Some(started.elapsed().as_millis() as u64);
    }
}

fn ensure_stream_start(
    emitted: &mut bool,
    app_handle: &AppHandle,
    agent: &str,
    turn: u32,
    created_at: u64,
) {
    if !*emitted {
        emit_stream_start(app_handle, agent, turn, created_at);
        *emitted = true;
    }
}

async fn stream_responses(
    config: &AiConfig,
    speaking_agent: &str,
    chat_body: &Value,
    turn: u32,
    created_at: u64,
    app_handle: &AppHandle,
    session_id: &str,
    cancel: &StreamCancel<'_>,
) -> Result<StreamOutcome, String> {
    let client = stream_http_client();
    let started = Instant::now();
    let mut ttft_ms: Option<u64> = None;
    let mut usage = TokenUsage::default();
    let mut stream_started = false;

    let body = responses_body_from_chat(chat_body, config, true);
    let url = responses_url(&config.api_base_url);

    let send_fut = apply_go_headers(
        client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream"),
        &config.api_key,
        session_id,
    )
    .json(&body)
    .send();

    let res = tokio::select! {
        biased;
        _ = until_cancelled(cancel) => {
            return Err(STREAM_ABORTED.into());
        }
        res = send_fut => {
            res.map_err(|e| format!("Stream request failed: {}", e))?
        }
    };

    let status = res.status();
    if !status.is_success() {
        let data = error_json_with_cancel(res, cancel).await?;
        let err_msg = data["error"]["message"]
            .as_str()
            .or_else(|| data["error"].as_str())
            .unwrap_or("unknown API error");
        return Err(format!("API {}: {}", status, err_msg));
    }

    let content_type = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    // Non-SSE JSON body (stream ignored / proxy collapsed) — same as chat path.
    if content_type.contains("application/json") && !content_type.contains("event-stream") {
        let data = json_with_cancel(res, cancel).await?;
        usage.merge(&extract_usage(&data));
        let (text, reasoning) = extract_responses_output(&data)?;
        if cancel.is_cancelled() {
            return Err(STREAM_ABORTED.into());
        }
        emit_stream_start(app_handle, speaking_agent, turn, created_at);
        note_ttft(started, &mut ttft_ms);
        if let Some(ref r) = reasoning {
            emit_chunk(app_handle, speaking_agent, turn, "reasoning", r);
        }
        emit_chunk(app_handle, speaking_agent, turn, "content", &text);
        return Ok(StreamOutcome::from_text(
            text, reasoning, usage, started, ttft_ms,
        ));
    }

    // Holding `res` in this scope: dropping it on cancel aborts the HTTP body.
    let mut stream = res.bytes_stream();
    let mut raw: Vec<u8> = Vec::new();
    let mut text_buf = String::new();
    let mut full = String::new();
    let mut full_reasoning = String::new();

    loop {
        let item = tokio::select! {
            biased;
            _ = until_cancelled(cancel) => {
                drop(stream);
                return Err(STREAM_ABORTED.into());
            }
            item = stream.next() => item,
        };
        let Some(item) = item else {
            break;
        };
        let chunk = item.map_err(|e| format!("Stream read failed: {}", e))?;
        raw.extend_from_slice(&chunk);
        match std::str::from_utf8(&raw) {
            Ok(s) => {
                text_buf.push_str(s);
                raw.clear();
            }
            Err(e) => {
                let valid_up_to = e.valid_up_to();
                if valid_up_to > 0 {
                    let ok = std::str::from_utf8(&raw[..valid_up_to]).unwrap();
                    text_buf.push_str(ok);
                    raw.drain(..valid_up_to);
                }
            }
        }
        let (pieces, rest, chunk_usage) = consume_responses_sse(&text_buf);
        usage.merge(&chunk_usage);
        text_buf = rest;
        for piece in pieces {
            match piece {
                StreamPiece::Content(d) => {
                    ensure_stream_start(
                        &mut stream_started,
                        app_handle,
                        speaking_agent,
                        turn,
                        created_at,
                    );
                    note_ttft(started, &mut ttft_ms);
                    full.push_str(&d);
                    emit_chunk(app_handle, speaking_agent, turn, "content", &d);
                }
                StreamPiece::Reasoning(d) => {
                    ensure_stream_start(
                        &mut stream_started,
                        app_handle,
                        speaking_agent,
                        turn,
                        created_at,
                    );
                    note_ttft(started, &mut ttft_ms);
                    full_reasoning.push_str(&d);
                    emit_chunk(app_handle, speaking_agent, turn, "reasoning", &d);
                }
            }
        }
    }

    // Flush a trailing event that lacked a final blank line (common on some proxies).
    let (pieces, chunk_usage) = flush_responses_trailing(&text_buf);
    usage.merge(&chunk_usage);
    for piece in pieces {
        match piece {
            StreamPiece::Content(d) => {
                ensure_stream_start(
                    &mut stream_started,
                    app_handle,
                    speaking_agent,
                    turn,
                    created_at,
                );
                note_ttft(started, &mut ttft_ms);
                full.push_str(&d);
                emit_chunk(app_handle, speaking_agent, turn, "content", &d);
            }
            StreamPiece::Reasoning(d) => {
                ensure_stream_start(
                    &mut stream_started,
                    app_handle,
                    speaking_agent,
                    turn,
                    created_at,
                );
                note_ttft(started, &mut ttft_ms);
                full_reasoning.push_str(&d);
                emit_chunk(app_handle, speaking_agent, turn, "reasoning", &d);
            }
        }
    }

    if cancel.is_cancelled() {
        return Err(STREAM_ABORTED.into());
    }

    if promote_reasoning_only(&mut full, &full_reasoning) {
        // Parity with empty-SSE / JSON fallback: FE gets a content chunk too.
        emit_chunk(app_handle, speaking_agent, turn, "content", &full);
    }

    // Empty SSE: try parsing a collapsed JSON body, then completed-event harvest,
    // then non-stream Responses fallback.
    // Race cancel so stop/FreshStart does not hang on the fallback HTTP call.
    if full.is_empty() {
        if let Ok(data) = serde_json::from_str::<Value>(text_buf.trim()) {
            if let Ok((text, reasoning)) = extract_responses_output(&data) {
                usage.merge(&extract_usage(&data));
                if cancel.is_cancelled() {
                    return Err(STREAM_ABORTED.into());
                }
                note_ttft(started, &mut ttft_ms);
                ensure_stream_start(
                    &mut stream_started,
                    app_handle,
                    speaking_agent,
                    turn,
                    created_at,
                );
                if let Some(ref r) = reasoning {
                    emit_chunk(app_handle, speaking_agent, turn, "reasoning", r);
                }
                emit_chunk(app_handle, speaking_agent, turn, "content", &text);
                return Ok(StreamOutcome::from_text(
                    text, reasoning, usage, started, ttft_ms,
                ));
            }
        }

        if let Some((text, reasoning, done_usage)) = harvest_responses_completed(&text_buf) {
            usage.merge(&done_usage);
            if cancel.is_cancelled() {
                return Err(STREAM_ABORTED.into());
            }
            note_ttft(started, &mut ttft_ms);
            ensure_stream_start(
                &mut stream_started,
                app_handle,
                speaking_agent,
                turn,
                created_at,
            );
            if let Some(ref r) = reasoning {
                emit_chunk(app_handle, speaking_agent, turn, "reasoning", r);
            }
            emit_chunk(app_handle, speaking_agent, turn, "content", &text);
            return Ok(StreamOutcome::from_text(
                text, reasoning, usage, started, ttft_ms,
            ));
        }

        if cancel.is_cancelled() {
            return Err(STREAM_ABORTED.into());
        }
        let (content, reasoning, fb_usage) = tokio::select! {
            biased;
            _ = until_cancelled(cancel) => {
                return Err(STREAM_ABORTED.into());
            }
            result = call_responses_with_usage(config, chat_body, session_id, cancel) => {
                result?
            }
        };
        if cancel.is_cancelled() {
            return Err(STREAM_ABORTED.into());
        }
        usage.merge(&fb_usage);
        note_ttft(started, &mut ttft_ms);
        ensure_stream_start(
            &mut stream_started,
            app_handle,
            speaking_agent,
            turn,
            created_at,
        );
        if let Some(ref r) = reasoning {
            emit_chunk(app_handle, speaking_agent, turn, "reasoning", r);
        }
        emit_chunk(app_handle, speaking_agent, turn, "content", &content);
        return Ok(StreamOutcome::from_text(
            content, reasoning, usage, started, ttft_ms,
        ));
    }

    // Partial deltas arrived, but `response.completed` has a longer prefix-extending
    // final text: emit only the missing suffix (no duplicate / no bubble rewrite).
    if let Some((text, harvested_reasoning, done_usage)) = harvest_responses_completed(&text_buf)
    {
        if text.len() > full.len() && text.starts_with(&full) {
            let suffix = text[full.len()..].to_string();
            usage.merge(&done_usage);
            if cancel.is_cancelled() {
                return Err(STREAM_ABORTED.into());
            }
            if !suffix.is_empty() {
                emit_chunk(app_handle, speaking_agent, turn, "content", &suffix);
            }
            full = text;
            if let Some(ref hr) = harvested_reasoning {
                if hr.len() > full_reasoning.len() && hr.starts_with(&full_reasoning) {
                    let r_suffix = hr[full_reasoning.len()..].to_string();
                    if !r_suffix.is_empty() {
                        emit_chunk(app_handle, speaking_agent, turn, "reasoning", &r_suffix);
                    }
                    full_reasoning = hr.clone();
                } else if full_reasoning.is_empty() {
                    emit_chunk(app_handle, speaking_agent, turn, "reasoning", hr);
                    full_reasoning = hr.clone();
                }
            }
        }
    }

    let reasoning = if full_reasoning.is_empty() {
        None
    } else {
        Some(full_reasoning)
    };
    Ok(StreamOutcome::from_text(full, reasoning, usage, started, ttft_ms))
}

/// Non-stream Responses API call (empty-SSE / JSON fallback for muse-spark).
async fn call_responses_with_usage(
    config: &AiConfig,
    chat_body: &Value,
    session_id: &str,
    cancel: &StreamCancel<'_>,
) -> Result<(String, Option<String>, TokenUsage), String> {
    let client = short_http_client();
    let body = responses_body_from_chat(chat_body, config, false);
    let url = responses_url(&config.api_base_url);
    let send_fut = apply_go_headers(
        client.post(&url).header("Content-Type", "application/json"),
        &config.api_key,
        session_id,
    )
    .json(&body)
    .send();

    let res = tokio::select! {
        biased;
        _ = until_cancelled(cancel) => {
            return Err(STREAM_ABORTED.into());
        }
        res = send_fut => {
            res.map_err(|e| format!("Request failed: {}", e))?
        }
    };

    let status = res.status();
    if !status.is_success() {
        let data = error_json_with_cancel(res, cancel).await?;
        let err_msg = data["error"]["message"]
            .as_str()
            .or_else(|| data["error"].as_str())
            .unwrap_or("unknown API error");
        return Err(format!("API {}: {}", status, err_msg));
    }

    let data = json_with_cancel(res, cancel).await?;
    let usage = extract_usage(&data);
    let (content, reasoning) = extract_responses_output(&data)?;
    Ok((content, reasoning, usage))
}

/// Stream using a harness-prepared turn (preferred path).
pub async fn stream_prepared(
    prepared: &PreparedTurn,
    app_handle: &AppHandle,
    cancel: &StreamCancel<'_>,
) -> Result<StreamOutcome, String> {
    let session_id = if prepared.chat_id.is_empty() {
        "ai-convoir"
    } else {
        prepared.chat_id.as_str()
    };
    if prepared.uses_responses {
        return stream_responses(
            &prepared.config,
            prepared.agent,
            &prepared.chat_body,
            prepared.turn,
            prepared.created_at,
            app_handle,
            session_id,
            cancel,
        )
        .await;
    }
    stream_chat_sse(
        &prepared.config,
        prepared.agent,
        &prepared.context_messages,
        prepared.narration.as_deref(),
        &prepared.chat_body,
        prepared.turn,
        prepared.created_at,
        app_handle,
        session_id,
        cancel,
    )
    .await
}

/// Stream chat completions via SSE.
/// Cancelled when `reset` is set or `stream_epoch` diverges from `epoch_at_start` (stop/switch).
#[allow(dead_code)]
pub async fn stream_llm(
    config: &AiConfig,
    speaking_agent: &str,
    messages_context: &[Message],
    narration: Option<&str>,
    turn: u32,
    created_at: u64,
    app_handle: &AppHandle,
    session_id: &str,
    cancel: &StreamCancel<'_>,
) -> Result<StreamOutcome, String> {
    let mut body = build_chat_body(config, speaking_agent, messages_context, true, narration);
    let cache_key = crate::harness::compute_prompt_cache_key(config, speaking_agent);
    apply_prompt_cache_key(&mut body, &cache_key);
    crate::harness::cache::apply_stream_usage_option(&mut body);
    if uses_responses_api(&config.model) {
        return stream_responses(
            config,
            speaking_agent,
            &body,
            turn,
            created_at,
            app_handle,
            session_id,
            cancel,
        )
        .await;
    }
    stream_chat_sse(
        config,
        speaking_agent,
        messages_context,
        narration,
        &body,
        turn,
        created_at,
        app_handle,
        session_id,
        cancel,
    )
    .await
}

async fn stream_chat_sse(
    config: &AiConfig,
    speaking_agent: &str,
    messages_context: &[Message],
    narration: Option<&str>,
    chat_body: &Value,
    turn: u32,
    created_at: u64,
    app_handle: &AppHandle,
    session_id: &str,
    cancel: &StreamCancel<'_>,
) -> Result<StreamOutcome, String> {
    let client = stream_http_client();
    let started = Instant::now();
    let mut ttft_ms: Option<u64> = None;
    let mut usage = TokenUsage::default();
    let mut stream_started = false;

    let url = chat_url(&config.api_base_url);

    let send_fut = apply_go_headers(
        client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream"),
        &config.api_key,
        session_id,
    )
    .json(chat_body)
    .send();

    let res = tokio::select! {
        biased;
        _ = until_cancelled(cancel) => {
            return Err(STREAM_ABORTED.into());
        }
        res = send_fut => {
            res.map_err(|e| format!("Stream request failed: {}", e))?
        }
    };

    let status = res.status();
    if !status.is_success() {
        let data = error_json_with_cancel(res, cancel).await?;
        let err_msg = data["error"]["message"]
            .as_str()
            .or_else(|| data["error"].as_str())
            .unwrap_or("unknown API error");
        return Err(format!("API {}: {}", status, err_msg));
    }

    let content_type = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    if content_type.contains("application/json") && !content_type.contains("event-stream") {
        let data = json_with_cancel(res, cancel).await?;
        usage.merge(&extract_usage(&data));
        let msg = &data["choices"][0]["message"];
        let finish_reason = data["choices"][0]["finish_reason"]
            .as_str()
            .unwrap_or("stop");

        let (text, reasoning): (String, Option<String>) =
            match extract_text_content(&msg["content"]) {
                Some(c) => {
                    let mut r = None;
                    for key in [
                        "reasoning_content",
                        "reasoning",
                        "thinking",
                        "reasoning_text",
                    ] {
                        if let Some(t) = extract_text_content(&msg[key]) {
                            r = Some(t);
                            break;
                        }
                    }
                    (c, r)
                }
                None => {
                    if let Some(r) = extract_text_content(&msg["reasoning_content"])
                        .or_else(|| extract_text_content(&msg["reasoning"]))
                        .or_else(|| extract_text_content(&msg["thinking"]))
                    {
                        (r.clone(), Some(r))
                    } else if let Some(t) = extract_text_content(&data["choices"][0]["text"]) {
                        (t, None)
                    } else {
                        return Err(format!(
                            "No content in API response (finish_reason: {})",
                            finish_reason
                        ));
                    }
                }
            };

        if cancel.is_cancelled() {
            return Err(STREAM_ABORTED.into());
        }
        emit_stream_start(app_handle, speaking_agent, turn, created_at);
        note_ttft(started, &mut ttft_ms);
        if let Some(ref r) = reasoning {
            emit_chunk(app_handle, speaking_agent, turn, "reasoning", r);
        }
        emit_chunk(app_handle, speaking_agent, turn, "content", &text);
        return Ok(StreamOutcome::from_text(
            text, reasoning, usage, started, ttft_ms,
        ));
    }

    let mut stream = res.bytes_stream();
    let mut raw: Vec<u8> = Vec::new();
    let mut text_buf = String::new();
    let mut full = String::new();
    let mut full_reasoning = String::new();

    loop {
        let item = tokio::select! {
            biased;
            _ = until_cancelled(cancel) => {
                drop(stream);
                return Err(STREAM_ABORTED.into());
            }
            item = stream.next() => item,
        };
        let Some(item) = item else {
            break;
        };
        let chunk = item.map_err(|e| format!("Stream read failed: {}", e))?;
        raw.extend_from_slice(&chunk);

        match std::str::from_utf8(&raw) {
            Ok(s) => {
                text_buf.push_str(s);
                raw.clear();
            }
            Err(e) => {
                let valid_up_to = e.valid_up_to();
                if valid_up_to > 0 {
                    let ok = std::str::from_utf8(&raw[..valid_up_to]).unwrap();
                    text_buf.push_str(ok);
                    raw.drain(..valid_up_to);
                }
            }
        }

        let normalized = text_buf.replace("\r\n", "\n").replace('\r', "\n");
        let (deltas, rest, chunk_usage) = extract_sse_deltas_with_usage(&normalized);
        usage.merge(&chunk_usage);
        text_buf = rest;
        for piece in deltas {
            match piece {
                StreamPiece::Content(d) => {
                    ensure_stream_start(
                        &mut stream_started,
                        app_handle,
                        speaking_agent,
                        turn,
                        created_at,
                    );
                    note_ttft(started, &mut ttft_ms);
                    full.push_str(&d);
                    emit_chunk(app_handle, speaking_agent, turn, "content", &d);
                }
                StreamPiece::Reasoning(d) => {
                    ensure_stream_start(
                        &mut stream_started,
                        app_handle,
                        speaking_agent,
                        turn,
                        created_at,
                    );
                    note_ttft(started, &mut ttft_ms);
                    full_reasoning.push_str(&d);
                    emit_chunk(app_handle, speaking_agent, turn, "reasoning", &d);
                }
            }
        }
    }

    if !text_buf.is_empty() {
        let (deltas, _, chunk_usage) = extract_sse_deltas_with_usage(&(text_buf + "\n\n"));
        usage.merge(&chunk_usage);
        for piece in deltas {
            match piece {
                StreamPiece::Content(d) => {
                    ensure_stream_start(
                        &mut stream_started,
                        app_handle,
                        speaking_agent,
                        turn,
                        created_at,
                    );
                    note_ttft(started, &mut ttft_ms);
                    full.push_str(&d);
                    emit_chunk(app_handle, speaking_agent, turn, "content", &d);
                }
                StreamPiece::Reasoning(d) => {
                    ensure_stream_start(
                        &mut stream_started,
                        app_handle,
                        speaking_agent,
                        turn,
                        created_at,
                    );
                    note_ttft(started, &mut ttft_ms);
                    full_reasoning.push_str(&d);
                    emit_chunk(app_handle, speaking_agent, turn, "reasoning", &d);
                }
            }
        }
    }

    if cancel.is_cancelled() {
        return Err(STREAM_ABORTED.into());
    }

    // Reasoning-only stream (no content deltas) — treat reasoning as the reply.
    if promote_reasoning_only(&mut full, &full_reasoning) {
        // Parity with empty-SSE fallback: FE gets a content chunk too.
        emit_chunk(app_handle, speaking_agent, turn, "content", &full);
    }

    // Empty SSE: fall back to non-stream; emit chunks so FE is not left with a blank bubble.
    // Race cancel against the fallback HTTP call so stop/FreshStart does not hang on it.
    if full.is_empty() {
        if cancel.is_cancelled() {
            return Err(STREAM_ABORTED.into());
        }
        let (content, reasoning, fb_usage) = tokio::select! {
            biased;
            _ = until_cancelled(cancel) => {
                return Err(STREAM_ABORTED.into());
            }
            result = call_llm_with_usage(config, speaking_agent, messages_context, narration, cancel) => {
                result?
            }
        };
        if cancel.is_cancelled() {
            return Err(STREAM_ABORTED.into());
        }
        usage.merge(&fb_usage);
        note_ttft(started, &mut ttft_ms);
        ensure_stream_start(
            &mut stream_started,
            app_handle,
            speaking_agent,
            turn,
            created_at,
        );
        if let Some(ref r) = reasoning {
            emit_chunk(app_handle, speaking_agent, turn, "reasoning", r);
        }
        emit_chunk(app_handle, speaking_agent, turn, "content", &content);
        return Ok(StreamOutcome::from_text(
            content, reasoning, usage, started, ttft_ms,
        ));
    }

    let reasoning = if full_reasoning.is_empty() {
        None
    } else {
        Some(full_reasoning)
    };
    Ok(StreamOutcome::from_text(
        full, reasoning, usage, started, ttft_ms,
    ))
}

/// Like `extract_sse_deltas`, but also harvests `usage` from payloads (final chunk).
fn extract_sse_deltas_with_usage(buffer: &str) -> (Vec<StreamPiece>, String, TokenUsage) {
    let (deltas, rest) = extract_sse_deltas(buffer);
    let mut usage = TokenUsage::default();
    // Re-scan complete events for usage objects (may appear with empty delta).
    let (complete, _) = if let Some(idx) = buffer.rfind("\n\n") {
        let (head, tail) = buffer.split_at(idx + 2);
        (head.to_string(), tail.to_string())
    } else if buffer.ends_with('\n') {
        (buffer.to_string(), String::new())
    } else if let Some(idx) = buffer.rfind('\n') {
        let (head, tail) = buffer.split_at(idx + 1);
        (head.to_string(), tail.to_string())
    } else {
        return (deltas, rest, usage);
    };
    for line in complete.split('\n') {
        let line = line.trim_end_matches('\r').trim();
        if let Some(data) = line.strip_prefix("data:") {
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(data) {
                usage.merge(&extract_usage(&v));
            }
        }
    }
    (deltas, rest, usage)
}

pub async fn fetch_models(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let client = short_http_client();

    let url = models_url(base_url);
    let mut req = client.get(&url);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("Models request failed: {}", e))?;

    let status = res.status();
    let data: Value = res
        .json()
        .await
        .map_err(|e| format!("Models parse failed: {}", e))?;

    if !status.is_success() {
        let err_msg = data["error"]["message"]
            .as_str()
            .or_else(|| data["error"].as_str())
            .unwrap_or("unknown API error");
        return Err(format!("Models API {}: {}", status, err_msg));
    }

    parse_models_response(&data)
}

#[cfg(test)]
mod cancel_tests {
    use super::*;
    use crate::harness::client::{SHORT_HTTP_TIMEOUT_SECS, STREAM_HTTP_TIMEOUT_SECS};

    #[test]
    fn stream_cancel_detects_epoch_bump() {
        let reset = AtomicBool::new(false);
        let epoch = AtomicU64::new(3);
        let c = StreamCancel {
            reset: &reset,
            epoch: &epoch,
            epoch_at_start: 3,
        };
        assert!(!c.is_cancelled());
        epoch.fetch_add(1, Ordering::Release);
        assert!(c.is_cancelled());
    }

    #[test]
    fn stream_cancel_detects_reset() {
        let reset = AtomicBool::new(false);
        let epoch = AtomicU64::new(1);
        let c = StreamCancel {
            reset: &reset,
            epoch: &epoch,
            epoch_at_start: 1,
        };
        assert!(!c.is_cancelled());
        reset.store(true, Ordering::Release);
        assert!(c.is_cancelled());
    }

    #[test]
    fn cancel_before_stream_via_epoch() {
        let reset = AtomicBool::new(false);
        let epoch = AtomicU64::new(1);
        let c = StreamCancel {
            reset: &reset,
            epoch: &epoch,
            epoch_at_start: 1,
        };
        // Simulate stop before first byte: epoch bumps, cancel observed.
        epoch.fetch_add(1, Ordering::AcqRel);
        assert!(c.is_cancelled());
    }

    #[test]
    fn cancel_after_stream_via_reset() {
        let reset = AtomicBool::new(false);
        let epoch = AtomicU64::new(5);
        let c = StreamCancel {
            reset: &reset,
            epoch: &epoch,
            epoch_at_start: 5,
        };
        assert!(!c.is_cancelled());
        // Mid-stream reset/load.
        reset.store(true, Ordering::Release);
        assert!(c.is_cancelled());
    }

    #[tokio::test]
    async fn race_cancel_wins_when_already_cancelled() {
        let reset = AtomicBool::new(true);
        let epoch = AtomicU64::new(1);
        let c = StreamCancel {
            reset: &reset,
            epoch: &epoch,
            epoch_at_start: 1,
        };
        // Pending future never resolves; cancel must win immediately (biased select).
        let result = race_cancel(&c, std::future::pending::<Value>()).await;
        assert_eq!(result.unwrap_err(), STREAM_ABORTED);
    }

    #[tokio::test]
    async fn race_cancel_future_wins_when_not_cancelled() {
        let reset = AtomicBool::new(false);
        let epoch = AtomicU64::new(1);
        let c = StreamCancel {
            reset: &reset,
            epoch: &epoch,
            epoch_at_start: 1,
        };
        let result = race_cancel(&c, async { serde_json::json!({"ok": true}) }).await;
        assert_eq!(result.unwrap()["ok"], true);
    }

    #[tokio::test]
    async fn race_cancel_wins_over_slow_future() {
        let reset = std::sync::Arc::new(AtomicBool::new(false));
        let epoch = std::sync::Arc::new(AtomicU64::new(1));
        let c = StreamCancel {
            reset: reset.as_ref(),
            epoch: epoch.as_ref(),
            epoch_at_start: 1,
        };
        let reset_flag = std::sync::Arc::clone(&reset);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(40)).await;
            reset_flag.store(true, Ordering::Release);
        });
        let result = race_cancel(&c, async {
            tokio::time::sleep(Duration::from_secs(5)).await;
            serde_json::json!({"late": true})
        })
        .await;
        assert_eq!(result.unwrap_err(), STREAM_ABORTED);
    }

    #[test]
    fn extract_sse_usage_from_final_chunk() {
        let buf = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\n",
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":2,",
            "\"prompt_tokens_details\":{\"cached_tokens\":8}}}\n\n"
        );
        let (deltas, rest, usage) = extract_sse_deltas_with_usage(buf);
        assert_eq!(deltas, vec![StreamPiece::Content("Hi".into())]);
        assert!(rest.is_empty());
        assert_eq!(usage.prompt_tokens, Some(10));
        assert_eq!(usage.completion_tokens, Some(2));
        assert_eq!(usage.cached_tokens, Some(8));
    }

    #[test]
    fn fetch_models_uses_short_timeout_constant() {
        assert_eq!(SHORT_HTTP_TIMEOUT_SECS, 30);
        assert!(SHORT_HTTP_TIMEOUT_SECS < STREAM_HTTP_TIMEOUT_SECS);
    }

    #[test]
    fn responses_trailing_flush_without_blank_line() {
        let buf = "event: response.output_text.delta\ndata: {\"delta\":\"tail\"}";
        let (pieces, usage) = flush_responses_trailing(buf);
        assert_eq!(pieces, vec![StreamPiece::Content("tail".into())]);
        assert_eq!(usage.prompt_tokens, None);
    }

    #[test]
    fn responses_multi_line_data_joined() {
        let block = concat!(
            "event: response.output_text.delta\n",
            "data: {\"delta\":\"hel\"}\n",
            // Second data line is unusual but must be joined before JSON parse fails gracefully;
            // valid case: single JSON object split across data lines is joined with newline.
        );
        // Single-line JSON still works:
        let (pieces, _) = parse_responses_sse_block(
            "event: response.output_text.delta\ndata: {\"delta\":\"hello\"}",
        );
        assert_eq!(pieces, vec![StreamPiece::Content("hello".into())]);
        let _ = block;

        // Multi-line JSON in data: fields joined with \n
        let multiline = concat!(
            "event: response.output_text.delta\n",
            "data: {\"delta\":\n",
            "data: \"ab\"}",
        );
        let (pieces, _) = parse_responses_sse_block(multiline);
        assert_eq!(pieces, vec![StreamPiece::Content("ab".into())]);
    }

    #[test]
    fn consume_responses_sse_keeps_incomplete_tail() {
        let buf = concat!(
            "event: response.output_text.delta\n",
            "data: {\"delta\":\"A\"}\n\n",
            "event: response.output_text.delta\n",
            "data: {\"delta\":\"B\"}",
        );
        let (pieces, rest, _) = consume_responses_sse(buf);
        assert_eq!(pieces, vec![StreamPiece::Content("A".into())]);
        assert!(rest.contains("delta\":\"B\""));
        let (flushed, _) = flush_responses_trailing(&rest);
        assert_eq!(flushed, vec![StreamPiece::Content("B".into())]);
    }

    #[test]
    fn extract_responses_output_from_output_array() {
        let data = serde_json::json!({
            "output": [
                {
                    "type": "reasoning",
                    "summary": [{"type": "summary_text", "text": "think"}]
                },
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": "hello"}]
                }
            ],
            "usage": {"input_tokens": 5, "output_tokens": 1}
        });
        let (content, reasoning) = extract_responses_output(&data).unwrap();
        assert_eq!(content, "hello");
        assert_eq!(reasoning.as_deref(), Some("think"));
        assert_eq!(extract_usage(&data).prompt_tokens, Some(5));
    }

    #[test]
    fn extract_responses_output_text_field() {
        let data = serde_json::json!({ "output_text": "hi there" });
        let (content, reasoning) = extract_responses_output(&data).unwrap();
        assert_eq!(content, "hi there");
        assert!(reasoning.is_none());
    }

    #[test]
    fn extract_responses_output_empty_errors() {
        let data = serde_json::json!({ "output": [] });
        assert!(extract_responses_output(&data).is_err());
    }

    #[test]
    fn responses_body_forwards_temperature_and_max_output_tokens() {
        let config = crate::state::AiConfig {
            name: "A".into(),
            system_prompt: "sys".into(),
            model: "muse-spark-1.3-contributor".into(),
            api_base_url: "https://opencode.ai/zen/go/v1".into(),
            api_key: "k".into(),
            temperature: 0.42,
            max_tokens: 512,
            reasoning_effort: Default::default(),
            response_length: Default::default(),
            color: String::new(),
            icon: String::new(),
        };
        let chat = serde_json::json!({
            "messages": [
                {"role": "system", "content": "be nice"},
                {"role": "user", "content": "hi"}
            ],
            "prompt_cache_key": "acv-test"
        });
        let body = responses_body_from_chat(&chat, &config, false);
        assert_eq!(body["stream"], false);
        let temp = body["temperature"].as_f64().unwrap();
        assert!((temp - 0.42).abs() < 1e-5, "temperature={temp}");
        assert_eq!(body["max_output_tokens"], 512);
        assert_eq!(body["instructions"], "be nice");
        assert_eq!(body["prompt_cache_key"], "acv-test");
        assert_eq!(body["input"][0]["role"], "user");
        // Streaming body flips stream flag only.
        let streamed = responses_body_from_chat(&chat, &config, true);
        assert_eq!(streamed["stream"], true);
        assert_eq!(streamed["max_output_tokens"], 512);
    }

    #[test]
    fn responses_body_omits_max_output_tokens_when_zero() {
        let config = crate::state::AiConfig {
            name: "A".into(),
            system_prompt: "sys".into(),
            model: "muse-spark-1.3-contributor".into(),
            api_base_url: "https://opencode.ai/zen/go/v1".into(),
            api_key: "k".into(),
            temperature: 0.5,
            max_tokens: 0,
            reasoning_effort: Default::default(),
            response_length: Default::default(),
            color: String::new(),
            icon: String::new(),
        };
        let chat = serde_json::json!({
            "messages": [{"role": "user", "content": "hi"}]
        });
        let body = responses_body_from_chat(&chat, &config, false);
        assert!(
            body.get("max_output_tokens").is_none(),
            "max_tokens==0 must omit max_output_tokens, got {:?}",
            body.get("max_output_tokens")
        );
        // temperature still forwarded
        let temp = body["temperature"].as_f64().unwrap();
        assert!((temp - 0.5).abs() < 1e-5);
    }

    #[test]
    fn extract_responses_reasoning_reads_content_parts() {
        // output_text path uses extract_responses_reasoning — must also read content[].
        let data = serde_json::json!({
            "output_text": "visible",
            "output": [{
                "type": "reasoning",
                "content": [{"type": "reasoning_text", "text": "from-content"}]
            }]
        });
        let (content, reasoning) = extract_responses_output(&data).unwrap();
        assert_eq!(content, "visible");
        assert_eq!(reasoning.as_deref(), Some("from-content"));
    }

    #[test]
    fn extract_responses_reasoning_summary_and_content() {
        let data = serde_json::json!({
            "output_text": "hi",
            "output": [{
                "type": "reasoning",
                "summary": [{"type": "summary_text", "text": "sum-"}],
                "content": [{"text": "body"}]
            }]
        });
        let (_, reasoning) = extract_responses_output(&data).unwrap();
        assert_eq!(reasoning.as_deref(), Some("sum-body"));
    }

    #[test]
    fn promote_reasoning_only_copies_when_content_empty() {
        let mut full = String::new();
        assert!(promote_reasoning_only(&mut full, "think aloud"));
        assert_eq!(full, "think aloud");
        // Second call: content already present — no promote.
        assert!(!promote_reasoning_only(&mut full, "other"));
        assert_eq!(full, "think aloud");
    }

    #[test]
    fn promote_reasoning_only_skips_empty_reasoning() {
        let mut full = String::new();
        assert!(!promote_reasoning_only(&mut full, ""));
        assert!(full.is_empty());
        let mut full2 = String::from("already");
        assert!(!promote_reasoning_only(&mut full2, "reason"));
        assert_eq!(full2, "already");
    }

    #[test]
    fn parse_responses_uses_json_type_when_event_missing() {
        // Proxies often omit the SSE `event:` line and only set JSON `type`.
        let block = r#"data: {"type":"response.output_text.delta","delta":"via-type"}"#;
        let (pieces, _) = parse_responses_sse_block(block);
        assert_eq!(pieces, vec![StreamPiece::Content("via-type".into())]);
    }

    #[test]
    fn parse_responses_refusal_delta_as_content() {
        let block = concat!(
            "event: response.refusal.delta\n",
            r#"data: {"delta":"I cannot help with that."}"#,
        );
        let (pieces, _) = parse_responses_sse_block(block);
        assert_eq!(
            pieces,
            vec![StreamPiece::Content("I cannot help with that.".into())]
        );
    }

    #[test]
    fn harvest_responses_completed_from_sse() {
        let buf = concat!(
            "event: response.created\n",
            r#"data: {"type":"response.created"}"#,
            "\n\n",
            "event: response.completed\n",
            r#"data: {"type":"response.completed","response":{"output_text":"final answer","output":[{"type":"reasoning","summary":[{"text":"why"}]}],"usage":{"input_tokens":3,"output_tokens":2}}}"#,
        );
        let (content, reasoning, usage) = harvest_responses_completed(buf).unwrap();
        assert_eq!(content, "final answer");
        assert_eq!(reasoning.as_deref(), Some("why"));
        assert_eq!(usage.prompt_tokens, Some(3));
    }

    #[test]
    fn harvest_responses_completed_from_json_type_only() {
        let buf = r#"data: {"type":"response.completed","response":{"output_text":"done"}}"#;
        let (content, reasoning, _) = harvest_responses_completed(buf).unwrap();
        assert_eq!(content, "done");
        assert!(reasoning.is_none());
    }

    #[test]
    fn harvest_completed_extends_partial_prefix() {
        // Documents the stream polish rule: completed text longer + starts_with(partial)
        // → emit only the suffix (tested here as the pure string condition).
        let buf = concat!(
            "event: response.output_text.delta
",
            r#"data: {"type":"response.output_text.delta","delta":"Hel"}"#,
            "

",
            "event: response.completed
",
            r#"data: {"type":"response.completed","response":{"output_text":"Hello world"}}"#,
        );
        let (completed, _, _) = harvest_responses_completed(buf).unwrap();
        let partial = "Hel";
        assert!(completed.len() > partial.len());
        assert!(completed.starts_with(partial));
        assert_eq!(&completed[partial.len()..], "lo world");
    }

    #[test]
    fn extract_responses_refusal_content_part() {
        let data = serde_json::json!({
            "output": [{
                "type": "message",
                "role": "assistant",
                "content": [{"type": "refusal", "refusal": "No."}]
            }]
        });
        let (content, _) = extract_responses_output(&data).unwrap();
        assert_eq!(content, "No.");
    }

    #[test]
    fn extract_responses_assistant_role_without_type() {
        let data = serde_json::json!({
            "output": [{
                "role": "assistant",
                "content": [{"type": "output_text", "text": "proxy-ok"}]
            }]
        });
        let (content, _) = extract_responses_output(&data).unwrap();
        assert_eq!(content, "proxy-ok");
    }
}
