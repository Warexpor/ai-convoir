//! Prepare step: select speaker, trim context, build body, estimate tokens, cache key.

use crate::engine::{
    build_chat_body, next_speaker, trim_messages_for_context, uses_responses_for,
};
use crate::harness::cache::{
    apply_prompt_cache_key, apply_stream_usage_option, compute_prompt_cache_key,
    estimate_prompt_tokens, immutable_prefix_fingerprint,
};
use crate::state::{AiConfig, ConversationMode, InnerState, Message};
use serde_json::Value;

/// Snapshot produced by the prepare phase — ready for stream orchestration.
#[derive(Debug, Clone)]
#[allow(dead_code)] // bot_count/mode/max_turns/prefix retained for harness metrics callers
pub struct PreparedTurn {
    pub agent: &'static str,
    pub turn: u32,
    pub config: AiConfig,
    /// Messages actually sent (may be a trimmed suffix of the transcript).
    pub context_messages: Vec<Message>,
    pub narration: Option<String>,
    pub created_at: u64,
    pub chat_id: String,
    pub prompt_est_tokens: u32,
    pub trimmed: bool,
    pub cache_key: String,
    pub prefix_fingerprint: String,
    /// OpenAI-compat chat body **or** (when muse-spark) a marker that llm builds responses.
    pub chat_body: Value,
    pub uses_responses: bool,
    pub bot_count: u8,
    pub mode: ConversationMode,
    pub max_turns: u32,
}

#[derive(Debug, Clone)]
pub struct PrepareError {
    pub message: String,
}

impl std::fmt::Display for PrepareError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

/// Build a prepared turn from locked inner state fields (caller holds/drops the lock).
///
/// `narration` is passed in already consumed (cleared) from pending_narration.
pub fn prepare_turn(
    inner: &InnerState,
    narration: Option<String>,
    created_at: u64,
    stream: bool,
) -> Result<PreparedTurn, PrepareError> {
    if inner.mode != ConversationMode::Step && inner.turn_count >= inner.max_turns {
        return Err(PrepareError {
            message: "Max turns reached".into(),
        });
    }

    let agent = next_speaker(inner.bot_count, inner.turn_count);
    let config = inner.config_for_agent(agent).clone();

    let all_msgs = &inner.messages;
    let active_configs: Vec<&AiConfig> = match inner.bot_count {
        3 => vec![&inner.ai1_config, &inner.ai2_config, &inner.ai3_config],
        _ => vec![&inner.ai1_config, &inner.ai2_config],
    };
    let context_messages = trim_messages_for_context(
        &active_configs,
        &inner.seed_prompt,
        all_msgs,
        &config.model,
    );
    let trimmed = context_messages.len() < all_msgs.len();

    let narr_ref = narration.as_deref();
    let prompt_est_tokens =
        estimate_prompt_tokens(&config, agent, &context_messages, narr_ref);
    let cache_key = compute_prompt_cache_key(&config, agent);
    let prefix_fingerprint =
        immutable_prefix_fingerprint(&config, agent, &context_messages);

    let mut chat_body = build_chat_body(&config, agent, &context_messages, stream, narr_ref);
    apply_prompt_cache_key(&mut chat_body, &cache_key);
    if stream {
        apply_stream_usage_option(&mut chat_body);
    }

    tracing::debug!(
        target: "harness",
        agent,
        turn = inner.turn_count,
        %cache_key,
        prompt_est_tokens,
        trimmed,
        prefix_fp = %prefix_fingerprint,
        "prepared turn"
    );

    Ok(PreparedTurn {
        agent,
        turn: inner.turn_count,
        config,
        context_messages,
        narration,
        created_at,
        chat_id: inner.active_chat_id.clone(),
        prompt_est_tokens,
        trimmed,
        cache_key,
        prefix_fingerprint,
        chat_body,
        uses_responses: uses_responses_for(inner.config_for_agent(agent)),
        bot_count: inner.bot_count,
        mode: inner.mode.clone(),
        max_turns: inner.max_turns,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::InnerState;

    #[test]
    fn prepare_builds_body_with_cache_key() {
        let mut inner = InnerState::default();
        inner.ai1_config.model = "gpt-4o-mini".into();
        inner.ai1_config.api_base_url = "https://api.openai.com/v1".into();
        inner.messages.push(Message {
            agent: "seed".into(),
            role: "user".into(),
            content: "hello".into(),
            turn: 0,
            created_at: 1,
            reasoning: None,
        });
        let prep = prepare_turn(&inner, None, 99, true).unwrap();
        assert_eq!(prep.agent, "ai1");
        assert_eq!(prep.turn, 0);
        assert!(prep.cache_key.starts_with("acv-"));
        assert_eq!(prep.chat_body["prompt_cache_key"], prep.cache_key);
        assert_eq!(prep.chat_body["stream"], true);
        assert_eq!(prep.chat_body["stream_options"]["include_usage"], true);
        assert!(!prep.trimmed);
        assert!(prep.prompt_est_tokens > 0);
    }

    #[test]
    fn prepare_rejects_max_turns_in_auto() {
        let mut inner = InnerState::default();
        inner.mode = ConversationMode::Auto;
        inner.max_turns = 2;
        inner.turn_count = 2;
        assert!(prepare_turn(&inner, None, 1, true).is_err());
    }

    #[test]
    fn prepare_prefix_stable_when_history_appends() {
        let mut inner = InnerState::default();
        inner.ai1_config.model = "gpt-4o-mini".into();
        let prep1 = prepare_turn(&inner, None, 1, true).unwrap();
        let key1 = prep1.cache_key.clone();
        // Append a message from another agent — cache_key (config-based) stays same
        inner.messages.push(Message {
            agent: "ai2".into(),
            role: "assistant".into(),
            content: "reply".into(),
            turn: 0,
            created_at: 2,
            reasoning: None,
        });
        // Still ai1's turn (turn_count 0)
        let prep2 = prepare_turn(&inner, None, 2, true).unwrap();
        assert_eq!(key1, prep2.cache_key);
    }

    #[test]
    fn prepare_marks_trimmed_and_keeps_newest() {
        let mut inner = InnerState::default();
        inner.ai1_config.model = "gpt-4o-mini".into();
        // Force tiny budget via huge system prompt.
        inner.ai1_config.system_prompt = "x".repeat(600_000);
        inner.ai2_config.system_prompt = "y".repeat(600_000);
        for i in 0..5 {
            inner.messages.push(Message {
                agent: if i % 2 == 0 { "ai1" } else { "ai2" }.into(),
                role: "assistant".into(),
                content: format!("msg-{i}"),
                turn: i,
                created_at: i as u64,
                reasoning: None,
            });
        }
        let prep = prepare_turn(&inner, Some("note".into()), 99, true).unwrap();
        assert!(prep.trimmed);
        assert_eq!(prep.context_messages.len(), 1);
        assert_eq!(prep.context_messages[0].content, "msg-4");
        assert_eq!(prep.narration.as_deref(), Some("note"));
        assert!(!prep.uses_responses); // gpt-4o-mini
    }

    #[test]
    fn prepare_sets_uses_responses_for_muse_spark() {
        let mut inner = InnerState::default();
        inner.ai1_config.model = "muse-spark-1.3-contributor".into();
        let prep = prepare_turn(&inner, None, 1, true).unwrap();
        assert!(prep.uses_responses);
    }
}
