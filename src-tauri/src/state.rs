use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningEffort {
    #[default]
    None,
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ResponseLength {
    Brief,
    Small,
    #[default]
    Normal,
    Long,
    VeryLong,
}

impl ReasoningEffort {
    pub fn as_api_str(&self) -> &'static str {
        match self {
            ReasoningEffort::None => "none",
            ReasoningEffort::Low => "low",
            ReasoningEffort::Medium => "medium",
            ReasoningEffort::High => "high",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ConversationMode {
    #[default]
    Auto,
    Step,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    #[serde(default = "default_agent_name")]
    pub name: String,
    pub system_prompt: String,
    pub model: String,
    pub api_base_url: String,
    pub api_key: String,
    pub temperature: f32,
    pub max_tokens: u32,
    #[serde(default)]
    pub reasoning_effort: ReasoningEffort,
    #[serde(default)]
    pub response_length: ResponseLength,
}

fn default_agent_name() -> String {
    "Agent".into()
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            name: "Agent 1".into(),
            system_prompt: "You are a thoughtful, articulate AI. Engage in a deep and interesting conversation with the other AI.".into(),
            model: "muse-spark-1.3-contributor".into(),
            api_base_url: "https://opencode.ai/zen/go/v1".into(),
            api_key: String::new(),
            temperature: 0.7,
            max_tokens: 1024,
            reasoning_effort: ReasoningEffort::None,
            response_length: ResponseLength::Normal,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub agent: String,
    pub role: String,
    pub content: String,
    pub turn: u32,
    pub created_at: u64,
    /// Model chain-of-thought / reasoning (optional; not sent back as assistant role).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AppStatus {
    Idle,
    Running,
    Paused,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InnerState {
    pub ai1_config: AiConfig,
    pub ai2_config: AiConfig,
    #[serde(default)]
    pub ai3_config: AiConfig,
    /// Number of active bots: 2 or 3
    #[serde(default = "default_bot_count")]
    pub bot_count: u8,
    pub messages: Vec<Message>,
    pub status: AppStatus,
    /// Number of completed single-bot turns
    pub turn_count: u32,
    pub max_turns: u32,
    pub delay_ms: u64,
    #[serde(default)]
    pub mode: ConversationMode,
    /// Opening first message / scene starter (optional)
    #[serde(default)]
    pub seed_prompt: String,
    /// One-shot director note for the *next* agent only (cleared after use)
    #[serde(default)]
    pub pending_narration: String,
    /// Active chat ID (matches frontend localStorage). Empty = fresh session.
    #[serde(default)]
    pub active_chat_id: String,
}

fn default_bot_count() -> u8 {
    2
}

impl Default for InnerState {
    fn default() -> Self {
        Self {
            ai1_config: AiConfig {
                name: "Agent 1".into(),
                ..Default::default()
            },
            ai2_config: AiConfig {
                name: "Agent 2".into(),
                system_prompt: "You are a sharp, witty AI who loves debate and pushing ideas further. Engage with the other AI critically but constructively.".into(),
                ..Default::default()
            },
            ai3_config: AiConfig {
                name: "Agent 3".into(),
                system_prompt: "You are a calm mediator AI. Synthesize viewpoints, spot blind spots, and keep the discussion grounded.".into(),
                ..Default::default()
            },
            bot_count: 2,
            messages: Vec::new(),
            status: AppStatus::Idle,
            turn_count: 0,
            max_turns: 20,
            delay_ms: 1000,
            mode: ConversationMode::Auto,
            seed_prompt: String::new(),
            pending_narration: String::new(),
            active_chat_id: String::new(),
        }
    }
}

impl InnerState {
    pub fn config_for_agent(&self, agent: &str) -> &AiConfig {
        match agent {
            "ai2" => &self.ai2_config,
            "ai3" => &self.ai3_config,
            _ => &self.ai1_config,
        }
    }
}

pub struct AppState {
    pub inner: Mutex<InnerState>,
    pub pause_flag: AtomicBool,
    pub reset_flag: AtomicBool,
    /// When true, auto-loop should only do one step then pause (used by step command).
    pub step_once: AtomicBool,
    /// Prevents spawning multiple concurrent conversation loops.
    pub loop_active: AtomicBool,
    /// Path to the SQLite database file.
    pub db_path: Mutex<String>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(InnerState::default()),
            pause_flag: AtomicBool::new(false),
            reset_flag: AtomicBool::new(false),
            step_once: AtomicBool::new(false),
            loop_active: AtomicBool::new(false),
            db_path: Mutex::new(String::new()),
        }
    }
}
