export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ResponseLength = "brief" | "small" | "normal" | "long" | "very_long";
export type ConversationMode = "auto" | "step";
export type AppStatus = "Idle" | "Running" | "Paused";

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
  /** UI-only: signature color (hex). Empty = slot default. */
  color: string;
  /** UI-only: avatar icon ("" = initials, "g:<glyph>", or literal chars). */
  icon: string;
  /** Provider id from the frontend registry. Routing keys off `api_base_url`. */
  provider: string;
}

export interface Message {
  agent: string;
  role: string;
  content: string;
  turn: number;
  created_at: number;
  /** Model chain-of-thought / reasoning (not sent back as assistant role). */
  reasoning?: string | null;
}

export interface InnerState {
  ai1_config: AiConfig;
  ai2_config: AiConfig;
  ai3_config: AiConfig;
  /** Number of active bots: 2 or 3 */
  bot_count: number;
  messages: Message[];
  status: AppStatus;
  /** Number of completed single-bot turns */
  turn_count: number;
  max_turns: number;
  delay_ms: number;
  mode: ConversationMode;
  /** Opening first message / scene starter (optional) */
  seed_prompt: string;
  /** One-shot director note for the *next* agent only (cleared after use) */
  pending_narration: string;
  /** Active chat ID (matches frontend storage). Empty = fresh session. */
  active_chat_id: string;
}

export function defaultAgent(name: string, systemPrompt: string): AiConfig {
  return {
    name,
    system_prompt: systemPrompt,
    model: "muse-spark-1.3-contributor",
    api_base_url: "https://opencode.ai/zen/go/v1",
    api_key: "",
    temperature: 0.85,
    max_tokens: 2048,
    reasoning_effort: "none",
    response_length: "normal",
    color: "",
    icon: "",
    provider: "opencode_go",
  };
}

/** Fill serde-style defaults on configs coming over IPC. */
export function normalizeAgent(raw: Partial<AiConfig> | null | undefined): AiConfig {
  const d = defaultAgent(
    "Agent",
    "You are a thoughtful, articulate AI. Engage in a deep and interesting conversation with the other AI.",
  );
  const c = raw ?? {};
  return {
    name: c.name ?? "Agent",
    system_prompt: c.system_prompt ?? "",
    model: c.model ?? d.model,
    api_base_url: c.api_base_url ?? d.api_base_url,
    api_key: c.api_key ?? "",
    temperature: typeof c.temperature === "number" ? c.temperature : d.temperature,
    max_tokens: typeof c.max_tokens === "number" ? Math.max(0, Math.floor(c.max_tokens)) : d.max_tokens,
    reasoning_effort: c.reasoning_effort ?? "none",
    response_length: c.response_length ?? "normal",
    color: c.color ?? "",
    icon: c.icon ?? "",
    provider: c.provider ?? "",
  };
}

export function defaultInnerState(): InnerState {
  return {
    ai1_config: defaultAgent(
      "Ava",
      "You are Ava — warm, curious, slightly mischievous. Speak naturally in first person when in character.",
    ),
    ai2_config: defaultAgent(
      "Jules",
      "You are Jules — dry humor, observant, pushes back gently. Keep replies chatty and human.",
    ),
    ai3_config: defaultAgent("Rin", "You are Rin — quiet, precise, reframes the room when needed."),
    bot_count: 2,
    messages: [],
    status: "Idle",
    turn_count: 0,
    max_turns: 40,
    delay_ms: 800,
    mode: "step",
    seed_prompt: "",
    pending_narration: "",
    active_chat_id: "",
  };
}

export function configForAgent(inner: InnerState, agent: string): AiConfig {
  if (agent === "ai2") return inner.ai2_config;
  if (agent === "ai3") return inner.ai3_config;
  return inner.ai1_config;
}

export class AppState {
  inner: InnerState = defaultInnerState();
  pauseFlag = false;
  resetFlag = false;
  /** Bumped on stop/reset/load so in-flight SSE + commits are discarded. */
  streamEpoch = 0;
  /** Aborted (and replaced) on every epoch bump so in-flight fetches drop at once. */
  epochAbort = new AbortController();
  /** Per-chat counter: a detached transcript save only writes while still current. */
  transcriptSaveEpochs = new Map<string, number>();
  /** When true, the loop does one step then pauses. */
  stepOnce = false;
  /** Prevents spawning multiple concurrent conversation loops. */
  loopActive = false;
  dbPath = "";

  /** Clear reset only when no conversation loop is active (avoids races with abort). */
  clearResetIfIdle() {
    if (!this.loopActive) this.resetFlag = false;
  }

  bumpStreamEpoch(): number {
    this.streamEpoch += 1;
    this.epochAbort.abort();
    this.epochAbort = new AbortController();
    return this.streamEpoch;
  }

  setReset() {
    this.resetFlag = true;
    this.epochAbort.abort();
    this.epochAbort = new AbortController();
  }

  bumpTranscriptSaveEpoch(chatId: string): number {
    const next = (this.transcriptSaveEpochs.get(chatId) ?? 0) + 1;
    this.transcriptSaveEpochs.set(chatId, next);
    return next;
  }

  currentTranscriptSaveEpoch(chatId: string): number {
    return this.transcriptSaveEpochs.get(chatId) ?? 0;
  }

  clearTranscriptSaveEpoch(chatId: string) {
    this.transcriptSaveEpochs.delete(chatId);
  }
}
