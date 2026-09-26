#![allow(unused_imports)]
//! Agentic turn harness: typed state machine, prepare, prompt-cache, metrics, HTTP client.
//!
//! Owns the prepare → stream → commit → next pipeline used by `commands` / `llm`.
//! Pure helpers stay in `engine`; this module orchestrates them into a stable turn lifecycle.

pub mod cache;
pub mod client;
pub mod metrics;
pub mod prepare;
pub mod turn;

pub use cache::{
    apply_prompt_cache_key, compute_prompt_cache_key, extract_usage, immutable_prefix_fingerprint,
    TokenUsage,
};
pub use client::shared_http_client;
pub use metrics::{emit_harness_metrics, log_turn_metrics, TurnMetrics};
pub use prepare::{prepare_turn, PreparedTurn};
pub use turn::{TurnPhase, TurnMachine, TransitionError};
