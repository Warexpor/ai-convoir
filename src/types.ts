export type ReasoningEffort = "none" | "low" | "medium" | "high";
export type ResponseLength = "brief" | "small" | "normal" | "long" | "very_long";
export type ConversationMode = "auto" | "step";
export type AppStatus = "Idle" | "Running" | "Paused";
export type StreamKind = "content" | "reasoning";

export interface AiConfig {
  name: string;
  system_prompt: string;
  model: string;
  api_base_url: string;
  api_key: string;
  temperature: number;
  max_tokens: number;
  reasoning_effort: ReasoningEffort;
  response_length: ResponseLength;
  /** Signature color (hex). Empty → the slot's default hue. */
  color?: string;
  /** Avatar: "" → initials, "g:<glyph>" → built-in glyph, else 1–2 literal chars. */
  icon?: string;
}

export interface Message {
  agent: string;
  role: string;
  content: string;
  turn: number;
  created_at: number;
  streaming?: boolean;
  /** Model chain-of-thought / reasoning (optional). */
  reasoning?: string | null;
}

export interface InnerState {
  ai1_config: AiConfig;
  ai2_config: AiConfig;
  ai3_config: AiConfig;
  bot_count: number;
  messages: Message[];
  status: AppStatus;
  turn_count: number;
  max_turns: number;
  delay_ms: number;
  mode: ConversationMode;
  seed_prompt: string;
  pending_narration?: string;
}

export interface StatusPayload {
  status: string;
  turn: number;
}

export interface StreamStart {
  agent: string;
  turn: number;
  /** Backend-owned identity for delete; optional for older payloads. */
  created_at?: number;
}

export interface StreamChunk {
  agent: string;
  turn: number;
  delta: string;
  /** content (default) or reasoning/thoughts */
  kind?: StreamKind;
}

export const OPENCODE_ZEN_BASE = "https://opencode.ai/zen/v1";
export const OPENCODE_GO_BASE = "https://opencode.ai/zen/go/v1";
export const MUSE_SPARK_13_CONTRIBUTOR = "muse-spark-1.3-contributor";

export function relativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function agentLabel(agent: string, config?: InnerState | null): string {
  if (agent === "seed") return "You";
  if (agent === "narrator") return "Note";
  if (!config) {
    if (agent === "ai1") return "Agent 1";
    if (agent === "ai2") return "Agent 2";
    if (agent === "ai3") return "Agent 3";
    return agent;
  }
  if (agent === "ai1") return config.ai1_config.name || "Agent 1";
  if (agent === "ai2") return config.ai2_config.name || "Agent 2";
  if (agent === "ai3") return config.ai3_config.name || "Agent 3";
  return agent;
}

/** Default signature hues per slot. Chrome stays monochrome; color is signal. */
export const SLOT_COLORS: Record<string, string> = {
  ai1: "#fafafa",
  ai2: "#a1a1aa",
  ai3: "#75757e",
};

/** Presets: a black-and-white ladder, plus two barely-warm/cool whites.
 *  Voices are told apart by value, not hue; the UI renders each one as a
 *  wide gradient off its tone. */
export const VOICE_PALETTE = [
  "#fafafa",
  "#dcdce0",
  "#bdbdc4",
  "#a1a1aa",
  "#8b8b93",
  "#75757e",
  "#e8e3d9",
  "#c9ced6",
];

/** Older presets (saturated, then muted) → the monochrome ladder, so
 *  existing casts follow the palette without a data migration. */
const LEGACY_COLORS: Record<string, string> = {
  "#ff7a3d": "#fafafa",
  "#6cc4ff": "#a1a1aa",
  "#c49bff": "#75757e",
  "#4fe3a5": "#bdbdc4",
  "#ff6b9a": "#dcdce0",
  "#ffc84a": "#e8e3d9",
  "#2fd4d4": "#c9ced6",
  "#b6f05a": "#bdbdc4",
  "#ff8f6b": "#fafafa",
  "#d4d4d8": "#8b8b93",
  "#c89a86": "#fafafa",
  "#9cb8d4": "#a1a1aa",
  "#aba3cc": "#75757e",
  "#9fb49c": "#bdbdc4",
  "#cbb591": "#e8e3d9",
  "#c79aa8": "#dcdce0",
  "#8e949c": "#8b8b93",
  "#e4ded4": "#e8e3d9",
};

/** Anything carrying voice configs: live state, a saved chat, a cast. */
export type VoiceSource = Pick<InnerState, "ai1_config" | "ai2_config" | "ai3_config">;

export function agentConfig(
  agent: string,
  config?: VoiceSource | null,
): AiConfig | undefined {
  if (!config) return undefined;
  if (agent === "ai1") return config.ai1_config;
  if (agent === "ai2") return config.ai2_config;
  if (agent === "ai3") return config.ai3_config;
  return undefined;
}

/** Hex color for a voice: the user's pick, else the slot default. */
export function agentAccent(agent: string, config?: VoiceSource | null): string {
  const custom = agentConfig(agent, config)?.color;
  if (custom && /^#[0-9a-f]{6}$/i.test(custom)) {
    return LEGACY_COLORS[custom.toLowerCase()] ?? custom;
  }
  if (agent === "seed") return "#ededed";
  return SLOT_COLORS[agent] ?? "#8a8a8a";
}

/** Dark or light ink for text sitting on a solid voice color. */
export function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#0b0b0c";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L =
    0.2126 * lin((n >> 16) & 255) +
    0.7152 * lin((n >> 8) & 255) +
    0.0722 * lin(n & 255);
  return L > 0.22 ? "#0b0b0c" : "#f5f5f5";
}

export function activeAgentIds(config: InnerState | null): string[] {
  return config && config.bot_count >= 3 ? ["ai1", "ai2", "ai3"] : ["ai1", "ai2"];
}

export function agentInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function nextAgentId(config: InnerState | null, turnCount: number): string {
  if (!config) return "ai1";
  const n = config.bot_count >= 3 ? 3 : 2;
  const ids = n === 3 ? ["ai1", "ai2", "ai3"] : ["ai1", "ai2"];
  return ids[turnCount % n];
}

// ── Token estimation ──────────────────────────────────────────────

/** Rough token estimation: ~4 chars per token for English text. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Known model context windows (tokens). Falls back to 128K. */
export const MODEL_CONTEXTS: Record<string, number> = {
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-3.5-turbo": 16385,
  "o1": 200000,
  "o1-mini": 128000,
  "o3-mini": 200000,
  "claude-sonnet-4": 200000,
  "claude-sonnet-4-20250514": 200000,
  "claude-4-opus": 200000,
  "claude-4-opus-20250514": 200000,
  "claude-3-5-sonnet": 200000,
  "claude-3-5-sonnet-latest": 200000,
  "claude-3-opus": 200000,
  "claude-3-sonnet": 200000,
  "claude-3-haiku": 200000,
  "gemini-2.5-pro": 1000000,
  "gemini-2.0-flash": 1000000,
  "gemini-1.5-pro": 2000000,
  "gemini-1.5-flash": 1000000,
  "muse-spark-1.3-contributor": 128000,
  "muse-spark-1.2-contributor": 128000,
  "deepseek-chat": 128000,
  "deepseek-reasoner": 128000,
};

export function contextWindow(model: string): number {
  // Exact match first
  if (MODEL_CONTEXTS[model]) return MODEL_CONTEXTS[model];
  // Prefix match for versioned models (e.g. gpt-4o-2024-08-06)
  for (const [key, val] of Object.entries(MODEL_CONTEXTS)) {
    if (model.startsWith(key)) return val;
  }
  return 128000;
}

/** Response-length instructions appended to system prompt. */
export const LENGTH_INSTRUCTIONS: Record<ResponseLength, string> = {
  brief: "Keep your response extremely brief — at most one sentence.",
  small: "Keep your response short — at most 2–3 sentences.",
  normal:
    "Respond at a natural length — thorough enough to cover the point, concise enough to stay on topic.",
  long: "You may respond at length — provide thorough detail.",
  very_long:
    "Respond as extensively as you like — cover all angles and go deep.",
};

/** Full system prompt with length instruction appended. */
export function effectiveSystemPrompt(config: AiConfig): string {
  const inst = LENGTH_INSTRUCTIONS[config.response_length || "normal"];
  if (!inst) return config.system_prompt;
  return config.system_prompt + (inst ? "\n\n" + inst : "");
}

/** Total estimated tokens for the active conversation. */
export function totalTokenUsage(messages: Message[], config: InnerState | null): {
  used: number;
  capacity: number;
} {
  if (!config) return { used: 0, capacity: 128000 };
  const activeBots = config.bot_count >= 3 ? 3 : 2;
  const agents = activeBots === 3
    ? [config.ai1_config, config.ai2_config, config.ai3_config]
    : [config.ai1_config, config.ai2_config];

  // System prompts are sent with every request
  const systemTokens = agents.reduce((sum, a) => sum + estimateTokens(a.system_prompt), 0);

  // All messages
  const msgTokens = messages.reduce((sum, m) => {
    let t = estimateTokens(m.content);
    if (m.reasoning) t += estimateTokens(m.reasoning);
    return sum + t;
  }, 0);

  // Seed prompt if present
  const seedTokens = estimateTokens(config.seed_prompt);

  const used = systemTokens + msgTokens + seedTokens;
  const capacity = contextWindow(agents[0]?.model || "");

  return { used, capacity };
}

/** Remove oldest complete turns until token usage is below the target ratio. */
export function compactMessages(
  messages: Message[],
  config: InnerState | null,
  targetRatio = 0.6,
): Message[] {
  if (messages.length < 4) return messages;
  const { used, capacity } = totalTokenUsage(messages, config);
  if (capacity === 0 || used / capacity < 0.75) return messages; // no compaction needed

  // Group by turn number
  const turnGroups = new Map<number, Message[]>();
  for (const m of messages) {
    const arr = turnGroups.get(m.turn) || [];
    arr.push(m);
    turnGroups.set(m.turn, arr);
  }
  const sortedTurns = [...turnGroups.keys()].sort((a, b) => a - b);

  let remaining = [...messages];
  for (const turn of sortedTurns) {
    if (remaining.length < 4) break;
    const before = remaining.length;
    remaining = remaining.filter((m) => m.turn !== turn);
    if (remaining.length === before) continue;
    const { used: usedAfter } = totalTokenUsage(remaining, config);
    if (usedAfter / capacity <= targetRatio) break;
  }

  if (remaining.length < messages.length) {
    return remaining;
  }
  return messages;
}
