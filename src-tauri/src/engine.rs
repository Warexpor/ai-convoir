//! Pure conversation orchestration helpers (no I/O).
//! Covered by unit tests in this module.

use crate::state::{AiConfig, AppStatus, ConversationMode, Message, ReasoningEffort, ResponseLength};
use serde_json::{json, Value};

/// OpenCode Zen OpenAI-compatible base URL.
pub const OPENCODE_ZEN_BASE: &str = "https://opencode.ai/zen/v1";
/// OpenCode Go OpenAI-compatible base URL.
pub const OPENCODE_GO_BASE: &str = "https://opencode.ai/zen/go/v1";

/// Agent ids for a given bot count (2 or 3).
pub fn agent_ids(bot_count: u8) -> Vec<&'static str> {
    match bot_count {
        3 => vec!["ai1", "ai2", "ai3"],
        _ => vec!["ai1", "ai2"],
    }
}

/// Next speaker after `turns_completed` single-bot turns (0-based cycle).
pub fn next_speaker(bot_count: u8, turns_completed: u32) -> &'static str {
    let ids = agent_ids(bot_count);
    let n = ids.len().max(1);
    ids[(turns_completed as usize) % n]
}

/// Simulate step sequence for `steps` turns; returns agent id list.
#[cfg(test)]
pub fn simulate_turn_order(bot_count: u8, steps: u32) -> Vec<&'static str> {
    (0..steps).map(|i| next_speaker(bot_count, i)).collect()
}

/// Map transcript roles for the speaking agent:
/// - that agent's past messages → assistant
/// - everyone else's → user
pub fn messages_for_api(speaking_agent: &str, transcript: &[Message]) -> Vec<(String, String)> {
    transcript
        .iter()
        .map(|m| {
            let role = if m.agent == speaking_agent {
                "assistant".to_string()
            } else {
                "user".to_string()
            };
            (role, m.content.clone())
        })
        .collect()
}

/// Format a one-shot director / narration note for the next speaker.
pub fn format_narration_note(narration: &str) -> String {
    format!(
        "[Director note — for you only; weave this into your reply naturally, do not quote or acknowledge this note explicitly]\n{}",
        narration.trim()
    )
}

/// Build OpenAI-compatible chat completions JSON body.
/// Includes `reasoning_effort` only when not `None`.
/// `stream` enables SSE streaming. Optional `narration` is injected as a final user note.
/// Appends response-length instruction to the system prompt.
pub fn build_chat_body(
    config: &AiConfig,
    speaking_agent: &str,
    transcript: &[Message],
    stream: bool,
    narration: Option<&str>,
) -> Value {
    let mut api_messages: Vec<Value> = Vec::new();

    // Compose system prompt with response-length instruction
    let system_content = match config.response_length {
        ResponseLength::Brief => format!("{}\n\nKeep your response extremely brief — at most one sentence.", config.system_prompt),
        ResponseLength::Small => format!("{}\n\nKeep your response short — at most 2–3 sentences.", config.system_prompt),
        ResponseLength::Normal => format!("{}\n\nRespond at a natural length — thorough enough to cover the point, concise enough to stay on topic.", config.system_prompt),
        ResponseLength::Long => format!("{}\n\nYou may respond at length — provide thorough detail.", config.system_prompt),
        ResponseLength::VeryLong => format!("{}\n\nRespond as extensively as you like — cover all angles and go deep.", config.system_prompt),
    };

    api_messages.push(json!({
        "role": "system",
        "content": system_content,
    }));

    for (role, content) in messages_for_api(speaking_agent, transcript) {
        api_messages.push(json!({
            "role": role,
            "content": content,
        }));
    }

    if let Some(n) = narration {
        let t = n.trim();
        if !t.is_empty() {
            api_messages.push(json!({
                "role": "system",
                "content": format_narration_note(t),
            }));
        }
    }

    let mut body = json!({
        "model": config.model,
        "messages": api_messages,
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
        "stream": stream,
    });

    if config.reasoning_effort != ReasoningEffort::None {
        body["reasoning_effort"] = json!(config.reasoning_effort.as_api_str());
    }

    body
}

/// Pull display text from OpenAI content that may be a string or content-parts array.
pub fn extract_text_content(node: &Value) -> Option<String> {
    if let Some(s) = node.as_str() {
        return if s.is_empty() {
            None
        } else {
            Some(s.to_string())
        };
    }
    if let Some(arr) = node.as_array() {
        let mut out = String::new();
        for part in arr {
            if let Some(t) = part.as_str() {
                out.push_str(t);
                continue;
            }
            if let Some(t) = part.get("text").and_then(|x| x.as_str()) {
                out.push_str(t);
                continue;
            }
            // OpenAI content part: { "type": "text", "text": "..." }
            if part.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(t) = part.get("text").and_then(|x| x.as_str()) {
                    out.push_str(t);
                }
            }
        }
        return if out.is_empty() { None } else { Some(out) };
    }
    None
}

/// One incremental stream piece: visible answer text or model reasoning/thoughts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamPiece {
    Content(String),
    Reasoning(String),
}

/// Extract **incremental** pieces from one OpenAI-style SSE `data:` JSON payload.
///
/// Only reads `choices[0].delta` (and delta-style `text`). Does **not** read
/// `message.content` — many providers put the *full cumulative* message there;
/// appending it would duplicate / scramble the stream.
pub fn parse_sse_data_payload(data: &str) -> Vec<StreamPiece> {
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return vec![];
    }
    let Ok(v) = serde_json::from_str::<Value>(data) else {
        return vec![];
    };

    let Some(choice) = v.get("choices").and_then(|c| c.as_array()).and_then(|a| a.first())
    else {
        return vec![];
    };

    let mut out = Vec::new();

    if let Some(delta) = choice.get("delta") {
        // Reasoning / thoughts (OpenAI o-series, OpenCode, various compat)
        for key in [
            "reasoning_content",
            "reasoning",
            "thinking",
            "reasoning_text",
        ] {
            if let Some(text) = extract_text_content(&delta[key]) {
                out.push(StreamPiece::Reasoning(text));
                break;
            }
        }
        if let Some(text) = extract_text_content(&delta["content"]) {
            out.push(StreamPiece::Content(text));
        } else if let Some(text) = extract_text_content(&delta["text"]) {
            out.push(StreamPiece::Content(text));
        }
        return out;
    }

    if let Some(text) = extract_text_content(&choice["text"]) {
        out.push(StreamPiece::Content(text));
    }
    out
}

/// Parse a raw SSE byte buffer into content/reasoning pieces.
/// Completes on blank-line event boundaries (`\n\n`); returns leftover incomplete event.
pub fn extract_sse_deltas(buffer: &str) -> (Vec<StreamPiece>, String) {
    let mut deltas = Vec::new();
    let (complete, rest) = if let Some(idx) = buffer.rfind("\n\n") {
        let (head, tail) = buffer.split_at(idx + 2);
        (head.to_string(), tail.to_string())
    } else if buffer.ends_with('\n') {
        (buffer.to_string(), String::new())
    } else if let Some(idx) = buffer.rfind('\n') {
        let (head, tail) = buffer.split_at(idx + 1);
        (head.to_string(), tail.to_string())
    } else {
        return (vec![], buffer.to_string());
    };

    for line in complete.split('\n') {
        let line = line.trim_end_matches('\r').trim();
        if line.is_empty() || line.starts_with(':') || line.starts_with("event:") {
            continue;
        }
        if let Some(data) = line.strip_prefix("data:") {
            deltas.extend(parse_sse_data_payload(data.trim()));
        }
    }
    (deltas, rest)
}

/// Parse OpenAI-style `GET /models` JSON into a sorted unique list of model ids.
pub fn parse_models_response(data: &Value) -> Result<Vec<String>, String> {
    let arr = data
        .get("data")
        .and_then(|d| d.as_array())
        .ok_or_else(|| "Models response missing data array".to_string())?;

    let mut ids: Vec<String> = arr
        .iter()
        .filter_map(|m| {
            m.get("id")
                .and_then(|id| id.as_str())
                .map(|s| s.to_string())
        })
        .collect();

    if ids.is_empty() {
        return Err("No model ids in response".into());
    }

    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// Normalize base URL (strip trailing slash).
pub fn normalize_base_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

/// Build models endpoint URL from base.
pub fn models_url(base: &str) -> String {
    format!("{}/models", normalize_base_url(base))
}

/// Build chat completions endpoint URL from base.
pub fn chat_url(base: &str) -> String {
    format!("{}/chat/completions", normalize_base_url(base))
}

/// OpenAI Responses API (required for muse-spark-* on OpenCode Go).
pub fn responses_url(base: &str) -> String {
    format!("{}/responses", normalize_base_url(base))
}

pub fn uses_responses_api(model: &str) -> bool {
    model.starts_with("muse-spark")
}

/// What `start_conversation` should do given current status + mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartAction {
    /// Already running — error
    RejectAlreadyRunning,
    /// Paused or stopped mid-chat in auto — continue without clearing
    ResumeAuto,
    /// Paused in step — do not silent no-op; caller should error (use Step)
    RejectStepPaused,
    /// Idle with empty transcript — fresh start
    FreshStart,
    /// Idle but transcript present — continue from here (auto) or nudge step
    ContinueIdle,
}

#[cfg(test)]
pub fn start_action(status: &AppStatus, mode: &ConversationMode) -> StartAction {
    start_action_with_transcript(status, mode, 0)
}

/// Like `start_action`, but uses transcript length so Stop → Start resumes.
pub fn start_action_with_transcript(
    status: &AppStatus,
    mode: &ConversationMode,
    message_count: usize,
) -> StartAction {
    match status {
        AppStatus::Running => StartAction::RejectAlreadyRunning,
        AppStatus::Paused => match mode {
            ConversationMode::Auto => StartAction::ResumeAuto,
            ConversationMode::Step => StartAction::RejectStepPaused,
        },
        AppStatus::Idle => {
            if message_count > 0 {
                match mode {
                    ConversationMode::Auto => StartAction::ContinueIdle,
                    ConversationMode::Step => StartAction::RejectStepPaused,
                }
            } else {
                StartAction::FreshStart
            }
        }
    }
}

/// Validate a single-step advance. Returns `Ok(mode)` with **mode unchanged**
/// (step must never flip Auto→Step). Sets step_once externally.
pub fn prepare_step(
    mode: ConversationMode,
    turn_count: u32,
    max_turns: u32,
) -> Result<ConversationMode, String> {
    if turn_count >= max_turns {
        return Err("Max turns reached".into());
    }
    // Intentionally return the same mode — step_once handles single-turn pause.
    Ok(mode)
}

/// Known model context windows (tokens). Mirrors the frontend's MODEL_CONTEXTS.
fn context_window_for(model: &str) -> u32 {
    // Exact match
    match model {
        "gpt-4o" | "gpt-4o-mini" | "gpt-4-turbo" | "gpt-3.5-turbo" | "deepseek-chat"
        | "deepseek-reasoner" => return 128000,
        "o1" | "o1-mini" | "o3-mini" => return 200000,
        "claude-sonnet-4" | "claude-4-opus" | "claude-3-5-sonnet" | "claude-3-opus"
        | "claude-3-sonnet" | "claude-3-haiku" => return 200000,
        "gemini-2.5-pro" | "gemini-2.0-flash" => return 1_000_000,
        "gemini-1.5-pro" | "gemini-1.5-flash" => return 2_000_000,
        _ => {}
    }
    // Prefix match
    if model.starts_with("gpt-4o") || model.starts_with("gpt-4-turbo") || model.starts_with("gpt-3.5") {
        return 128000;
    }
    if model.starts_with("claude") || model.starts_with("o1") || model.starts_with("o3") {
        return 200000;
    }
    if model.starts_with("gemini") {
        return 1_000_000;
    }
    if model.starts_with("deepseek") {
        return 128000;
    }
    128000 // default fallback
}

/// Rough token estimate: ~4 chars per token.
fn estimate_tokens(s: &str) -> u32 {
    let len = s.len() as u32;
    (len + 3) / 4
}

/// Return a subset of messages that fits within the model's context window.
///
/// **Never deletes anything** — operates on a copy. Walks messages from newest
/// to oldest and includes as many as fit after subtracting system prompts,
/// seed prompt, and a safety buffer.
pub fn trim_messages_for_context(
    active_configs: &[&crate::state::AiConfig],
    seed_prompt: &str,
    all_messages: &[crate::state::Message],
) -> Vec<crate::state::Message> {
    if all_messages.is_empty() {
        return vec![];
    }

    let model = active_configs
        .first()
        .map(|c| c.model.as_str())
        .unwrap_or("gpt-4o-mini");
    let ctx = context_window_for(model);

    // System prompts from all active agents + seed prompt consume budget
    let system_tokens: u32 = active_configs
        .iter()
        .map(|c| estimate_tokens(&c.system_prompt))
        .sum();
    let seed_tokens = estimate_tokens(seed_prompt);
    let buffer = 2000; // reserve room for the response itself
    let budget = ctx.saturating_sub(system_tokens + seed_tokens + buffer);

    let mut used = 0u32;
    let mut kept: Vec<crate::state::Message> = Vec::new();

    for m in all_messages.iter().rev() {
        let msg_tokens = estimate_tokens(&m.content)
            + m.reasoning.as_deref().map_or(0, estimate_tokens);
        if used + msg_tokens > budget {
            break;
        }
        used += msg_tokens;
        kept.push(m.clone());
    }

    kept.reverse();
    kept
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::ReasoningEffort;

    fn sample_config(system: &str, effort: ReasoningEffort) -> AiConfig {
        AiConfig {
            name: "Bot".into(),
            system_prompt: system.into(),
            model: "test-model".into(),
            api_base_url: "https://example.com/v1".into(),
            api_key: "sk-test".into(),
            temperature: 0.5,
            max_tokens: 256,
            reasoning_effort: effort,
            response_length: ResponseLength::Normal,
        }
    }

    #[test]
    fn turn_order_two_bots() {
        let seq = simulate_turn_order(2, 6);
        assert_eq!(seq, vec!["ai1", "ai2", "ai1", "ai2", "ai1", "ai2"]);
        assert_eq!(next_speaker(2, 0), "ai1");
        assert_eq!(next_speaker(2, 1), "ai2");
    }

    #[test]
    fn turn_order_three_bots() {
        let seq = simulate_turn_order(3, 7);
        assert_eq!(seq, vec!["ai1", "ai2", "ai3", "ai1", "ai2", "ai3", "ai1"]);
        assert_eq!(next_speaker(3, 2), "ai3");
        assert_eq!(next_speaker(3, 3), "ai1");
    }

    #[test]
    fn agent_ids_clamp() {
        assert_eq!(agent_ids(2).len(), 2);
        assert_eq!(agent_ids(3).len(), 3);
        assert_eq!(agent_ids(1).len(), 2); // invalid falls back to 2
        assert_eq!(agent_ids(99).len(), 2);
    }

    #[test]
    fn build_body_includes_system_transcript_and_reasoning() {
        let cfg = sample_config("You are Alice.", ReasoningEffort::High);
        let transcript = vec![
            Message {
                agent: "ai1".into(),
                role: "assistant".into(),
                content: "Hello from Alice".into(),
                turn: 0,
                created_at: 1,
                reasoning: None,
            },
            Message {
                agent: "ai2".into(),
                role: "assistant".into(),
                content: "Hello from Bob".into(),
                turn: 1,
                created_at: 2,
                reasoning: None,
            },
        ];

        let body = build_chat_body(&cfg, "ai1", &transcript, true, Some("look sad"));
        let s = body.to_string();

        assert!(s.contains("You are Alice."));
        assert!(s.contains("Hello from Alice"));
        assert!(s.contains("Hello from Bob"));
        assert!(s.contains("reasoning_effort"));
        assert!(s.contains("high"));
        assert!(s.contains("look sad"));
        assert!(s.contains("Director note"));
        assert_eq!(body["model"], "test-model");
        assert_eq!(body["stream"], true);

        // Speaking agent messages → assistant; others → user
        let msgs = body["messages"].as_array().unwrap();
        assert_eq!(msgs[0]["role"], "system");
        assert_eq!(msgs[1]["role"], "assistant"); // ai1's own
        assert_eq!(msgs[2]["role"], "user"); // ai2's
        assert_eq!(msgs[3]["role"], "system"); // narration
    }

    #[test]
    fn build_body_omits_reasoning_when_none() {
        let cfg = sample_config("sys", ReasoningEffort::None);
        let body = build_chat_body(&cfg, "ai1", &[], false, None);
        assert!(body.get("reasoning_effort").is_none());
        let s = body.to_string();
        assert!(!s.contains("reasoning_effort"));
        assert_eq!(body["stream"], false);
    }

    #[test]
    fn parse_sse_chunk_content() {
        let data = r#"{"choices":[{"delta":{"content":"Hello"}}]}"#;
        assert_eq!(
            parse_sse_data_payload(data),
            vec![StreamPiece::Content("Hello".into())]
        );
        assert!(parse_sse_data_payload("[DONE]").is_empty());
        let (deltas, rest) = extract_sse_deltas(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\ndata: [DONE]\n\npartial",
        );
        assert_eq!(deltas, vec![StreamPiece::Content("Hi".into())]);
        assert_eq!(rest, "partial");
    }

    #[test]
    fn parse_sse_ignores_cumulative_message_content() {
        let data = r#"{"choices":[{"delta":{},"message":{"content":"Hello world full"}}]}"#;
        assert!(
            parse_sse_data_payload(data).is_empty(),
            "must not treat message.content as a stream delta"
        );
    }

    #[test]
    fn parse_sse_content_parts_array() {
        let data = r#"{"choices":[{"delta":{"content":[{"type":"text","text":"ab"}]}}]}"#;
        assert_eq!(
            parse_sse_data_payload(data),
            vec![StreamPiece::Content("ab".into())]
        );
    }

    #[test]
    fn parse_sse_reasoning_content() {
        let data = r#"{"choices":[{"delta":{"reasoning_content":"think","content":"hi"}}]}"#;
        assert_eq!(
            parse_sse_data_payload(data),
            vec![
                StreamPiece::Reasoning("think".into()),
                StreamPiece::Content("hi".into())
            ]
        );
    }

    #[test]
    fn extract_text_string_and_array() {
        assert_eq!(
            extract_text_content(&json!("hi")).as_deref(),
            Some("hi")
        );
        assert_eq!(
            extract_text_content(&json!([{"type":"text","text":"x"},{"type":"text","text":"y"}]))
                .as_deref(),
            Some("xy")
        );
    }

    #[test]
    fn format_narration_includes_text() {
        let n = format_narration_note("whisper secrets");
        assert!(n.contains("whisper secrets"));
        assert!(n.contains("Director note"));
    }

    #[test]
    fn parse_models_openai_shape() {
        let data = json!({
            "object": "list",
            "data": [
                { "id": "gpt-4o", "object": "model" },
                { "id": "gpt-4o-mini", "object": "model" },
                { "id": "gpt-4o", "object": "model" }
            ]
        });
        let ids = parse_models_response(&data).unwrap();
        assert!(!ids.is_empty());
        assert!(ids.contains(&"gpt-4o".to_string()));
        assert!(ids.contains(&"gpt-4o-mini".to_string()));
        // deduped
        assert_eq!(ids.iter().filter(|x| *x == "gpt-4o").count(), 1);
    }

    #[test]
    fn parse_models_empty_errors() {
        let data = json!({ "data": [] });
        assert!(parse_models_response(&data).is_err());
        let bad = json!({ "foo": 1 });
        assert!(parse_models_response(&bad).is_err());
    }

    #[test]
    fn opencode_presets_match_docs() {
        assert_eq!(OPENCODE_ZEN_BASE, "https://opencode.ai/zen/v1");
        assert_eq!(OPENCODE_GO_BASE, "https://opencode.ai/zen/go/v1");
        assert_eq!(
            models_url(OPENCODE_ZEN_BASE),
            "https://opencode.ai/zen/v1/models"
        );
        assert_eq!(
            chat_url(OPENCODE_GO_BASE),
            "https://opencode.ai/zen/go/v1/chat/completions"
        );
    }

    #[test]
    fn simulate_transcript_length_matches_steps() {
        // After N steps, transcript length would be N messages
        let steps = 5u32;
        let order = simulate_turn_order(3, steps);
        assert_eq!(order.len(), steps as usize);
        let order2 = simulate_turn_order(2, steps);
        assert_eq!(order2.len(), steps as usize);
    }

    #[test]
    fn prepare_step_preserves_auto_mode() {
        let mode = ConversationMode::Auto;
        let out = prepare_step(mode.clone(), 3, 20).unwrap();
        assert_eq!(out, ConversationMode::Auto);
        assert_eq!(out, mode);
    }

    #[test]
    fn prepare_step_preserves_step_mode() {
        let out = prepare_step(ConversationMode::Step, 0, 10).unwrap();
        assert_eq!(out, ConversationMode::Step);
    }

    #[test]
    fn prepare_step_rejects_max_turns() {
        assert!(prepare_step(ConversationMode::Auto, 10, 10).is_err());
        assert!(prepare_step(ConversationMode::Auto, 11, 10).is_err());
    }

    #[test]
    fn start_action_resume_auto_when_paused_auto() {
        assert_eq!(
            start_action(&AppStatus::Paused, &ConversationMode::Auto),
            StartAction::ResumeAuto
        );
    }

    #[test]
    fn start_action_rejects_silent_noop_when_paused_step() {
        // Must not be a silent Ok path — FE Start/Space would appear dead
        assert_eq!(
            start_action(&AppStatus::Paused, &ConversationMode::Step),
            StartAction::RejectStepPaused
        );
    }

    #[test]
    fn start_action_running_and_idle() {
        assert_eq!(
            start_action(&AppStatus::Running, &ConversationMode::Auto),
            StartAction::RejectAlreadyRunning
        );
        assert_eq!(
            start_action(&AppStatus::Idle, &ConversationMode::Step),
            StartAction::FreshStart
        );
    }

    #[test]
    fn start_after_stop_continues_when_transcript_exists() {
        assert_eq!(
            start_action_with_transcript(&AppStatus::Idle, &ConversationMode::Auto, 4),
            StartAction::ContinueIdle
        );
        assert_eq!(
            start_action_with_transcript(&AppStatus::Idle, &ConversationMode::Step, 4),
            StartAction::RejectStepPaused
        );
        assert_eq!(
            start_action_with_transcript(&AppStatus::Idle, &ConversationMode::Auto, 0),
            StartAction::FreshStart
        );
    }

    #[test]
    fn step_mid_auto_then_start_still_resumes_auto() {
        // Regression: step must not flip mode, so start_action stays ResumeAuto
        let mode = ConversationMode::Auto;
        let mode_after_step = prepare_step(mode, 2, 50).unwrap();
        assert_eq!(mode_after_step, ConversationMode::Auto);
        assert_eq!(
            start_action(&AppStatus::Paused, &mode_after_step),
            StartAction::ResumeAuto
        );
    }
}
