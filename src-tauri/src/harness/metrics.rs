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

    #[test]
    fn apply_usage_none_does_not_wipe() {
        let mut m = TurnMetrics::default();
        m.apply_usage(&TokenUsage {
            prompt_tokens: Some(10),
            cached_tokens: Some(8),
            completion_tokens: Some(2),
        });
        m.apply_usage(&TokenUsage::default());
        assert_eq!(m.prompt_tokens, Some(10));
        assert_eq!(m.cached_tokens, Some(8));
        assert_eq!(m.completion_tokens, Some(2));
    }

    /// Mirrors run_one_turn Ok path and Ok+cancel path: both record content/reasoning chars.
    #[test]
    fn metrics_records_content_and_reasoning_chars() {
        let content = "hello";
        let reasoning = Some("think".to_string());
        let mut ok = TurnMetrics::default();
        ok.content_chars = content.chars().count();
        ok.reasoning_chars = reasoning
            .as_ref()
            .map(|r| r.chars().count())
            .unwrap_or(0);
        ok.phase_end = "Completed".into();
        assert_eq!(ok.content_chars, 5);
        assert_eq!(ok.reasoning_chars, 5);

        let mut cancelled = TurnMetrics::default();
        cancelled.content_chars = content.chars().count();
        cancelled.reasoning_chars = reasoning
            .as_ref()
            .map(|r| r.chars().count())
            .unwrap_or(0);
        cancelled.phase_end = "Stopped".into();
        assert_eq!(cancelled.content_chars, 5);
        assert_eq!(cancelled.reasoning_chars, 5);
        assert_eq!(cancelled.phase_end, "Stopped");

        // No reasoning → 0 chars
        let mut bare = TurnMetrics::default();
        bare.content_chars = "x".chars().count();
        bare.reasoning_chars = None::<String>
            .as_ref()
            .map(|r: &String| r.chars().count())
            .unwrap_or(0);
        assert_eq!(bare.content_chars, 1);
        assert_eq!(bare.reasoning_chars, 0);
    }
}
