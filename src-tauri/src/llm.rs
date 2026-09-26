use crate::engine::{
    build_chat_body, chat_url, extract_sse_deltas, extract_text_content, models_url,
    parse_models_response, responses_url, uses_responses_api, StreamPiece,
};
use crate::harness::cache::{
    apply_prompt_cache_key, extract_usage, TokenUsage,
};
use crate::harness::client::shared_http_client;
use crate::harness::prepare::PreparedTurn;
use crate::state::{AiConfig, Message};
use futures_util::StreamExt;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;
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

/// Non-streaming call. Returns (content, optional reasoning).
#[allow(dead_code)]
pub async fn call_llm(
    config: &AiConfig,
    speaking_agent: &str,
    messages_context: &[Message],
    narration: Option<&str>,
) -> Result<(String, Option<String>), String> {
    let (content, reasoning, _usage) =
        call_llm_with_usage(config, speaking_agent, messages_context, narration).await?;
    Ok((content, reasoning))
}

async fn call_llm_with_usage(
    config: &AiConfig,
    speaking_agent: &str,
    messages_context: &[Message],
    narration: Option<&str>,
) -> Result<(String, Option<String>, TokenUsage), String> {
    let client = shared_http_client();

    let mut body = build_chat_body(config, speaking_agent, messages_context, false, narration);
    let cache_key = crate::harness::compute_prompt_cache_key(config, speaking_agent);
    apply_prompt_cache_key(&mut body, &cache_key);
    let url = chat_url(&config.api_base_url);

    let res = apply_go_headers(
        client.post(&url).header("Content-Type", "application/json"),
        &config.api_key,
        "ai-convoir",
    )
    .json(&body)
    .send()
    .await
    .map_err(|e| format!("Request failed: {}", e))?;

    let status = res.status();
    let data: Value = res
        .json()
        .await
        .map_err(|e| format!("Parse failed: {}", e))?;

    if !status.is_success() {
        let err_msg = data["error"]["message"]
            .as_str()
            .or_else(|| data["error"].as_str())
            .unwrap_or("unknown API error");
        return Err(format!("API {}: {}", status, err_msg));
    }

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
    });
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
    let text = v
        .get("delta")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("text").and_then(|x| x.as_str()))
        .unwrap_or("");
    if text.is_empty() {
        return (vec![], usage);
    }
    let pieces = match event {
        "response.output_text.delta" => vec![StreamPiece::Content(text.to_string())],
        "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
            vec![StreamPiece::Reasoning(text.to_string())]
        }
        _ => vec![],
    };
    (pieces, usage)
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
    let client = shared_http_client();
    let started = Instant::now();
    let mut ttft_ms: Option<u64> = None;
    let mut usage = TokenUsage::default();

    let body = responses_body_from_chat(chat_body, config, true);
    let url = responses_url(&config.api_base_url);

    let res = apply_go_headers(
        client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream"),
        &config.api_key,
        session_id,
    )
    .json(&body)
    .send()
    .await
    .map_err(|e| format!("Stream request failed: {}", e))?;

    let status = res.status();
    if !status.is_success() {
        let data: Value = res.json().await.unwrap_or(serde_json::json!({}));
        let err_msg = data["error"]["message"]
            .as_str()
            .or_else(|| data["error"].as_str())
            .unwrap_or("unknown API error");
        return Err(format!("API {}: {}", status, err_msg));
    }

    emit_stream_start(app_handle, speaking_agent, turn, created_at);

    let mut stream = res.bytes_stream();
    let mut raw: Vec<u8> = Vec::new();
    let mut text_buf = String::new();
    let mut full = String::new();
    let mut full_reasoning = String::new();

    while let Some(item) = stream.next().await {
        if cancel.is_cancelled() {
            return Err(STREAM_ABORTED.into());
        }
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
        let parts: Vec<&str> = normalized.split("\n\n").collect();
        if parts.len() > 1 {
            for block in &parts[..parts.len() - 1] {
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
                let (pieces, chunk_usage) = parse_responses_event(event, &data);
                usage.merge(&chunk_usage);
                for piece in pieces {
                    match piece {
                        StreamPiece::Content(d) => {
                            note_ttft(started, &mut ttft_ms);
                            full.push_str(&d);
                            emit_chunk(app_handle, speaking_agent, turn, "content", &d);
                        }
                        StreamPiece::Reasoning(d) => {
                            note_ttft(started, &mut ttft_ms);
                            full_reasoning.push_str(&d);
                            emit_chunk(app_handle, speaking_agent, turn, "reasoning", &d);
                        }
                    }
                }
            }
            text_buf = parts.last().unwrap_or(&"").to_string();
        } else {
            text_buf = normalized;
        }
    }

    // Flush a trailing event that lacked a final blank line (common on some proxies).
    if !text_buf.trim().is_empty() {
        let trailing = text_buf.replace("\r\n", "\n").replace('\r', "\n");
        let mut event = "";
        let mut data = String::new();
        for line in trailing.lines() {
            if let Some(v) = line.strip_prefix("event:") {
                event = v.trim();
            } else if let Some(v) = line.strip_prefix("data:") {
                if !data.is_empty() {
                    data.push('\n');
                }
                data.push_str(v.trim());
            }
        }
        let (pieces, chunk_usage) = parse_responses_event(event, &data);
        usage.merge(&chunk_usage);
        for piece in pieces {
            match piece {
                StreamPiece::Content(d) => {
                    note_ttft(started, &mut ttft_ms);
                    full.push_str(&d);
                    emit_chunk(app_handle, speaking_agent, turn, "content", &d);
                }
                StreamPiece::Reasoning(d) => {
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

    if full.is_empty() && !full_reasoning.is_empty() {
        full = full_reasoning.clone();
    }
    if full.is_empty() {
        return Err("Empty model reply".into());
    }
    let reasoning = if full_reasoning.is_empty() {
        None
    } else {
        Some(full_reasoning)
    };
    Ok(StreamOutcome::from_text(full, reasoning, usage, started, ttft_ms))
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
    stream_llm_with_body(
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
    stream_llm_with_body(
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

async fn stream_llm_with_body(
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
    if uses_responses_api(&config.model) {
        return stream_responses(
            config,
            speaking_agent,
            chat_body,
            turn,
            created_at,
            app_handle,
            session_id,
            cancel,
        )
        .await;
    }

    let client = shared_http_client();
    let started = Instant::now();
    let mut ttft_ms: Option<u64> = None;
    let mut usage = TokenUsage::default();

    let url = chat_url(&config.api_base_url);

    let res = apply_go_headers(
        client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream"),
        &config.api_key,
        session_id,
    )
    .json(chat_body)
    .send()
    .await
    .map_err(|e| format!("Stream request failed: {}", e))?;

    let status = res.status();
    if !status.is_success() {
        let data: Value = res.json().await.unwrap_or(serde_json::json!({}));
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
        let data: Value = res
            .json()
            .await
            .map_err(|e| format!("Parse failed: {}", e))?;
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

    emit_stream_start(app_handle, speaking_agent, turn, created_at);

    let mut stream = res.bytes_stream();
    let mut raw: Vec<u8> = Vec::new();
    let mut text_buf = String::new();
    let mut full = String::new();
    let mut full_reasoning = String::new();

    while let Some(item) = stream.next().await {
        if cancel.is_cancelled() {
            return Err(STREAM_ABORTED.into());
        }
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
                    note_ttft(started, &mut ttft_ms);
                    full.push_str(&d);
                    emit_chunk(app_handle, speaking_agent, turn, "content", &d);
                }
                StreamPiece::Reasoning(d) => {
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
                    note_ttft(started, &mut ttft_ms);
                    full.push_str(&d);
                    emit_chunk(app_handle, speaking_agent, turn, "content", &d);
                }
                StreamPiece::Reasoning(d) => {
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

    // Empty SSE: fall back to non-stream without emitting stream-abort (avoids UI flicker).
    if full.is_empty() {
        if cancel.is_cancelled() {
            return Err(STREAM_ABORTED.into());
        }
        let (content, reasoning, fb_usage) =
            call_llm_with_usage(config, speaking_agent, messages_context, narration).await?;
        usage.merge(&fb_usage);
        note_ttft(started, &mut ttft_ms);
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
    let client = shared_http_client();

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
        epoch.fetch_add(1, Ordering::Relaxed);
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
        reset.store(true, Ordering::Relaxed);
        assert!(c.is_cancelled());
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
        assert_eq!(usage.cached_tokens, Some(8));
        assert_eq!(usage.completion_tokens, Some(2));
    }
}
