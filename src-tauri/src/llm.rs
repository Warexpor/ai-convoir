use crate::engine::{
    build_chat_body, chat_url, extract_sse_deltas, extract_text_content, models_url,
    parse_models_response, responses_url, uses_responses_api, StreamPiece,
};
use crate::state::{AiConfig, Message};
use futures_util::StreamExt;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};

/// Returned when reset/stop cancels an in-flight SSE stream.
pub const STREAM_ABORTED: &str = "aborted";

/// Cancel signal for an in-flight stream: reset clears transcript; epoch bumps on stop/switch.
pub struct StreamCancel<'a> {
    pub reset: &'a AtomicBool,
    pub epoch: &'a AtomicU64,
    pub epoch_at_start: u64,
}

impl StreamCancel<'_> {
    pub fn is_cancelled(&self) -> bool {
        self.reset.load(Ordering::Relaxed)
            || self.epoch.load(Ordering::Relaxed) != self.epoch_at_start
    }
}

/// Non-streaming call. Returns (content, optional reasoning).
pub async fn call_llm(
    config: &AiConfig,
    speaking_agent: &str,
    messages_context: &[Message],
    narration: Option<&str>,
) -> Result<(String, Option<String>), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let body = build_chat_body(config, speaking_agent, messages_context, false, narration);
    let url = chat_url(&config.api_base_url);

    let res = apply_go_headers(
        client.post(&url).header("Content-Type", "application/json"),
        &config.api_key,
        "ai-conversation",
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
            // Content empty — try reasoning as fallback visible text
            if let Some(r) = extract_text_content(&msg["reasoning_content"])
                .or_else(|| extract_text_content(&msg["reasoning"]))
                .or_else(|| extract_text_content(&msg["thinking"]))
            {
                // Reasoning models sometimes put output in reasoning fields
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

    Ok((content, reasoning))
}

fn apply_go_headers(
    req: reqwest::RequestBuilder,
    api_key: &str,
    session_id: &str,
) -> reqwest::RequestBuilder {
    let session = if session_id.trim().is_empty() {
        "ai-conversation"
    } else {
        session_id
    };
    req.header("Authorization", format!("Bearer {}", api_key))
        .header("User-Agent", "ai-conversation/2.0")
        .header("x-opencode-session", session)
}

fn responses_body(
    config: &AiConfig,
    speaking_agent: &str,
    messages_context: &[Message],
    stream: bool,
    narration: Option<&str>,
) -> Value {
    let chat = build_chat_body(config, speaking_agent, messages_context, stream, narration);
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
    serde_json::json!({
        "model": model,
        "instructions": instructions,
        "input": input,
        "stream": stream,
    })
}

fn parse_responses_event(event: &str, data: &str) -> Vec<StreamPiece> {
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return vec![];
    }
    let Ok(v) = serde_json::from_str::<Value>(data) else {
        return vec![];
    };
    let text = v
        .get("delta")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("text").and_then(|x| x.as_str()))
        .unwrap_or("");
    if text.is_empty() {
        return vec![];
    }
    match event {
        "response.output_text.delta" => vec![StreamPiece::Content(text.to_string())],
        "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
            vec![StreamPiece::Reasoning(text.to_string())]
        }
        _ => vec![],
    }
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

async fn stream_responses(
    config: &AiConfig,
    speaking_agent: &str,
    messages_context: &[Message],
    narration: Option<&str>,
    turn: u32,
    created_at: u64,
    app_handle: &AppHandle,
    session_id: &str,
    cancel: &StreamCancel<'_>,
) -> Result<(String, Option<String>), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let body = responses_body(config, speaking_agent, messages_context, true, narration);
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
                        data.push_str(v.trim());
                    }
                }
                for piece in parse_responses_event(event, &data) {
                    match piece {
                        StreamPiece::Content(d) => {
                            full.push_str(&d);
                            emit_chunk(app_handle, speaking_agent, turn, "content", &d);
                        }
                        StreamPiece::Reasoning(d) => {
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
    Ok((full, reasoning))
}

/// Stream chat completions via SSE.
/// Cancelled when `reset` is set or `stream_epoch` diverges from `epoch_at_start` (stop/switch).
/// Returns (answer content, optional full reasoning text).
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
) -> Result<(String, Option<String>), String> {
    if uses_responses_api(&config.model) {
        return stream_responses(
            config,
            speaking_agent,
            messages_context,
            narration,
            turn,
            created_at,
            app_handle,
            session_id,
            cancel,
        )
        .await;
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let body = build_chat_body(config, speaking_agent, messages_context, true, narration);
    let url = chat_url(&config.api_base_url);

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
        if let Some(ref r) = reasoning {
            emit_chunk(app_handle, speaking_agent, turn, "reasoning", r);
        }
        emit_chunk(app_handle, speaking_agent, turn, "content", &text);
        return Ok((text, reasoning));
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
        let (deltas, rest) = extract_sse_deltas(&normalized);
        text_buf = rest;
        for piece in deltas {
            match piece {
                StreamPiece::Content(d) => {
                    full.push_str(&d);
                    emit_chunk(app_handle, speaking_agent, turn, "content", &d);
                }
                StreamPiece::Reasoning(d) => {
                    full_reasoning.push_str(&d);
                    emit_chunk(app_handle, speaking_agent, turn, "reasoning", &d);
                }
            }
        }
    }

    if !text_buf.is_empty() {
        let (deltas, _) = extract_sse_deltas(&(text_buf + "\n\n"));
        for piece in deltas {
            match piece {
                StreamPiece::Content(d) => {
                    full.push_str(&d);
                    emit_chunk(app_handle, speaking_agent, turn, "content", &d);
                }
                StreamPiece::Reasoning(d) => {
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
        return call_llm(config, speaking_agent, messages_context, narration).await;
    }

    let reasoning = if full_reasoning.is_empty() {
        None
    } else {
        Some(full_reasoning)
    };
    Ok((full, reasoning))
}

pub async fn fetch_models(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

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
}
