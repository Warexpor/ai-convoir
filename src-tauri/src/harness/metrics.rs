//! Per-turn harness metrics: estimate, cache, TTFT, duration, usage.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::cache::TokenUsage;

#[derive(Debug, Clone, Default, Serialize)]
pub struct TurnMetrics {
    pub agent: String,
    pub turn: u32,
    pub prompt_est_tokens: u32,
    pub trimmed: bool,
    pub cache_key: String,
    /// Time-to-first-token (ms), if observed.
    pub ttft_ms: Option<u64>,
    /// Wall time of the stream phase (ms).
    pub stream_duration_ms: Option<u64>,
    pub content_chars: usize,
    pub reasoning_chars: usize,
    pub prompt_tokens: Option<u32>,
    pub cached_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub phase_end: String,
}

impl TurnMetrics {
    pub fn apply_usage(&mut self, usage: &TokenUsage) {
        if usage.prompt_tokens.is_some() {
            self.prompt_tokens = usage.prompt_tokens;
        }
        if usage.cached_tokens.is_some() {
            self.cached_tokens = usage.cached_tokens;
        }
        if usage.completion_tokens.is_some() {
            self.completion_tokens = usage.completion_tokens;
        }
    }
}

pub fn log_turn_metrics(m: &TurnMetrics) {
    tracing::info!(
        target: "harness",
        agent = %m.agent,
        turn = m.turn,
        prompt_est_tokens = m.prompt_est_tokens,
        trimmed = m.trimmed,
        cache_key = %m.cache_key,
        ttft_ms = ?m.ttft_ms,
        stream_duration_ms = ?m.stream_duration_ms,
        content_chars = m.content_chars,
        reasoning_chars = m.reasoning_chars,
        prompt_tokens = ?m.prompt_tokens,
        cached_tokens = ?m.cached_tokens,
        completion_tokens = ?m.completion_tokens,
        phase_end = %m.phase_end,
        "turn metrics"
    );
}

/// Optional UI/debug event — cheap JSON emit.
pub fn emit_harness_metrics(app: &AppHandle, m: &TurnMetrics) {
    let _ = app.emit("harness-metrics", m);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::cache::TokenUsage;

    #[test]
    fn apply_usage_fills_fields() {
        let mut m = TurnMetrics::default();
        m.apply_usage(&TokenUsage {
            prompt_tokens: Some(100),
            cached_tokens: Some(80),
            completion_tokens: Some(20),
        });
        assert_eq!(m.prompt_tokens, Some(100));
        assert_eq!(m.cached_tokens, Some(80));
        assert_eq!(m.completion_tokens, Some(20));
    }
}
