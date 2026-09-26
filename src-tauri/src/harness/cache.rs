//! Prompt-cache planning: stable prefixes, cache keys, usage extraction.
//!
//! OpenAI-compatible APIs accept top-level `prompt_cache_key` for cache routing.
//! We always compute & log the key; we attach it to chat/completions and responses
//! bodies (unknown fields are typically ignored by proxies that don't support it).
//! Anthropic-style `cache_control` is not used — no Anthropic-native path exists.

use crate::engine::{estimate_tokens_pub, messages_for_api, system_prompt_with_length};
use crate::state::{AiConfig, Message};
use serde_json::{json, Value};

/// Token usage pulled from SSE final JSON / non-stream responses when present.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TokenUsage {
    pub prompt_tokens: Option<u32>,
    pub cached_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
}

impl TokenUsage {
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.prompt_tokens.is_none()
            && self.cached_tokens.is_none()
            && self.completion_tokens.is_none()
    }

    pub fn merge(&mut self, other: &TokenUsage) {
        if other.prompt_tokens.is_some() {
            self.prompt_tokens = other.prompt_tokens;
        }
        if other.cached_tokens.is_some() {
            self.cached_tokens = other.cached_tokens;
        }
        if other.completion_tokens.is_some() {
            self.completion_tokens = other.completion_tokens;
        }
    }
}

/// FNV-1a 64-bit — stable across runs, no extra crate.
fn fnv1a64(data: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in data {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn hex64(v: u64) -> String {
    format!("{v:016x}")
}

/// Byte-stable fingerprint of the immutable prompt prefix for a speaking agent:
/// composed system prompt + remapped history roles/content (append-only order).
///
/// When history only appends, the fingerprint of any shared prefix slice is unchanged.
pub fn immutable_prefix_fingerprint(
    config: &AiConfig,
    speaking_agent: &str,
    transcript: &[Message],
) -> String {
    let system = system_prompt_with_length(config);
    let mut buf = Vec::with_capacity(system.len() + 64);
    buf.extend_from_slice(b"system\0");
    buf.extend_from_slice(system.as_bytes());
    buf.push(0);
    for (role, content) in messages_for_api(speaking_agent, transcript) {
        buf.extend_from_slice(role.as_bytes());
        buf.push(0);
        buf.extend_from_slice(content.as_bytes());
        buf.push(0);
    }
    hex64(fnv1a64(&buf))
}

/// Stable `prompt_cache_key`: hash(model + base + system + speaking_agent).
/// Does **not** include mutable tail (narration / latest user notes) so related
/// turns for the same agent/config share a routing key.
pub fn compute_prompt_cache_key(config: &AiConfig, speaking_agent: &str) -> String {
    let system = system_prompt_with_length(config);
    let base = crate::engine::normalize_base_url(&config.api_base_url);
    let mut buf = Vec::new();
    buf.extend_from_slice(config.model.as_bytes());
    buf.push(b'|');
    buf.extend_from_slice(base.as_bytes());
    buf.push(b'|');
    buf.extend_from_slice(speaking_agent.as_bytes());
    buf.push(b'|');
    buf.extend_from_slice(system.as_bytes());
    format!("acv-{}", hex64(fnv1a64(&buf)))
}

/// Attach OpenAI-compatible `prompt_cache_key` to a request body.
pub fn apply_prompt_cache_key(body: &mut Value, key: &str) {
    if key.is_empty() {
        return;
    }
    body["prompt_cache_key"] = json!(key);
}

/// Enable usage reporting on streamed chat completions (OpenAI-compatible).
pub fn apply_stream_usage_option(body: &mut Value) {
    if body.get("stream").and_then(|v| v.as_bool()) == Some(true) {
        body["stream_options"] = json!({ "include_usage": true });
    }
}

/// Pull usage (+ cached_tokens) from a JSON object that may be a full response
/// or an SSE `data:` payload with a top-level `usage` field.
pub fn extract_usage(v: &Value) -> TokenUsage {
    let Some(usage) = v.get("usage") else {
        return TokenUsage::default();
    };

    let prompt_tokens = usage
        .get("prompt_tokens")
        .or_else(|| usage.get("input_tokens"))
        .and_then(|x| x.as_u64())
        .map(|n| n as u32);

    let completion_tokens = usage
        .get("completion_tokens")
        .or_else(|| usage.get("output_tokens"))
        .and_then(|x| x.as_u64())
        .map(|n| n as u32);

    let cached_tokens = usage
        .get("prompt_tokens_details")
        .and_then(|d| d.get("cached_tokens"))
        .or_else(|| {
            usage
                .get("input_tokens_details")
                .and_then(|d| d.get("cached_tokens"))
        })
        .or_else(|| usage.get("cached_tokens"))
        .and_then(|x| x.as_u64())
        .map(|n| n as u32);

    TokenUsage {
        prompt_tokens,
        cached_tokens,
        completion_tokens,
    }
}

/// Rough estimate of tokens that will be sent (system + remapped history + narration).
pub fn estimate_prompt_tokens(
    config: &AiConfig,
    speaking_agent: &str,
    transcript: &[Message],
    narration: Option<&str>,
) -> u32 {
    let system = system_prompt_with_length(config);
    let mut total = estimate_tokens_pub(&system);
    for (role, content) in messages_for_api(speaking_agent, transcript) {
        total += estimate_tokens_pub(&role) + estimate_tokens_pub(&content);
    }
    if let Some(n) = narration {
        let t = n.trim();
        if !t.is_empty() {
            total += estimate_tokens_pub(t) + 40; // director-note wrapper overhead
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{ReasoningEffort, ResponseLength};

    fn cfg(system: &str) -> AiConfig {
        AiConfig {
            name: "Bot".into(),
            system_prompt: system.into(),
            model: "test-model".into(),
            api_base_url: "https://example.com/v1".into(),
            api_key: "sk".into(),
            temperature: 0.5,
            max_tokens: 256,
            reasoning_effort: ReasoningEffort::None,
            response_length: ResponseLength::Normal,
            color: String::new(),
            icon: String::new(),
            provider: String::new(),
        }
    }

    fn msg(agent: &str, content: &str, turn: u32) -> Message {
        Message {
            agent: agent.into(),
            role: "assistant".into(),
            content: content.into(),
            turn,
            created_at: turn as u64,
            reasoning: None,
        }
    }

    #[test]
    fn cache_key_stable_for_same_config_agent() {
        let c = cfg("You are Alice.");
        let a = compute_prompt_cache_key(&c, "ai1");
        let b = compute_prompt_cache_key(&c, "ai1");
        assert_eq!(a, b);
        assert!(a.starts_with("acv-"));
        // Different agent → different key (role remap differs at request time)
        let c2 = compute_prompt_cache_key(&c, "ai2");
        assert_ne!(a, c2);
    }

    #[test]
    fn cache_key_changes_with_model_or_system() {
        let c1 = cfg("sys-a");
        let mut c2 = cfg("sys-a");
        c2.model = "other-model".into();
        let c3 = cfg("sys-b");
        assert_ne!(
            compute_prompt_cache_key(&c1, "ai1"),
            compute_prompt_cache_key(&c2, "ai1")
        );
        assert_ne!(
            compute_prompt_cache_key(&c1, "ai1"),
            compute_prompt_cache_key(&c3, "ai1")
        );
    }

    #[test]
    fn prefix_fingerprint_stable_across_append() {
        let c = cfg("You are Alice.");
        let t1 = vec![msg("ai1", "hello", 0), msg("ai2", "hi", 1)];
        let fp1 = immutable_prefix_fingerprint(&c, "ai1", &t1);
        let mut t2 = t1.clone();
        t2.push(msg("ai1", "again", 2));
        let fp2 = immutable_prefix_fingerprint(&c, "ai1", &t2);
        // Full-transcript fingerprints differ after append…
        assert_ne!(fp1, fp2);
        // …but the shared prefix (first 2 msgs) fingerprint is unchanged:
        let fp_prefix_again = immutable_prefix_fingerprint(&c, "ai1", &t2[..2]);
        assert_eq!(fp1, fp_prefix_again);
    }

    #[test]
    fn prefix_roles_remap_per_speaker() {
        let c = cfg("sys");
        let t = vec![msg("ai1", "A", 0), msg("ai2", "B", 1)];
        let fp_ai1 = immutable_prefix_fingerprint(&c, "ai1", &t);
        let fp_ai2 = immutable_prefix_fingerprint(&c, "ai2", &t);
        assert_ne!(fp_ai1, fp_ai2);
    }

    #[test]
    fn apply_prompt_cache_key_sets_field() {
        let mut body = json!({ "model": "x", "messages": [] });
        apply_prompt_cache_key(&mut body, "acv-deadbeef");
        assert_eq!(body["prompt_cache_key"], "acv-deadbeef");
    }

    #[test]
    fn extract_usage_chat_and_responses_shapes() {
        let chat = json!({
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 20,
                "prompt_tokens_details": { "cached_tokens": 80 }
            }
        });
        let u = extract_usage(&chat);
        assert_eq!(u.prompt_tokens, Some(100));
        assert_eq!(u.cached_tokens, Some(80));
        assert_eq!(u.completion_tokens, Some(20));

        let resp = json!({
            "usage": {
                "input_tokens": 50,
                "output_tokens": 10,
                "input_tokens_details": { "cached_tokens": 40 }
            }
        });
        let u2 = extract_usage(&resp);
        assert_eq!(u2.prompt_tokens, Some(50));
        assert_eq!(u2.cached_tokens, Some(40));
        assert_eq!(u2.completion_tokens, Some(10));
    }

    #[test]
    fn stream_options_only_when_streaming() {
        let mut body = json!({ "stream": true });
        apply_stream_usage_option(&mut body);
        assert_eq!(body["stream_options"]["include_usage"], true);
        let mut body2 = json!({ "stream": false });
        apply_stream_usage_option(&mut body2);
        assert!(body2.get("stream_options").is_none());
    }
}
