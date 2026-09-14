import type { AiConfig, InnerState, Message, StreamKind } from "../types";
import { LENGTH_INSTRUCTIONS } from "../types";
import { emit } from "./bus";
import {
  MUSE_SPARK_13_CONTRIBUTOR,
  resolveApiBase,
  responsesUrl,
  usesResponsesApi,
} from "./openaiCompat";

type EngineState = {
  config: InnerState | null;
  messages: Message[];
  turnCount: number;
  status: "Idle" | "Running" | "Paused";
  pendingNarration: string;
  sessionId: string;
  abort: AbortController | null;
  loopActive: boolean;
  stepOnce: boolean;
  paused: boolean;
  reset: boolean;
};

const state: EngineState = {
  config: null,
  messages: [],
  turnCount: 0,
  status: "Idle",
  pendingNarration: "",
  sessionId: "ai-conversation",
  abort: null,
  loopActive: false,
  stepOnce: false,
  paused: false,
  reset: false,
};

function nowMs(): number {
  return Date.now();
}

function emitStatus() {
  emit("status-update", { status: state.status, turn: state.turnCount });
}

function agentConfig(id: string): AiConfig | null {
  const cfg = state.config;
  if (!cfg) return null;
  if (id === "ai1") return cfg.ai1_config;
  if (id === "ai2") return cfg.ai2_config;
  if (id === "ai3") return cfg.ai3_config;
  return null;
}

function nextSpeaker(): string {
  const n = state.config && state.config.bot_count >= 3 ? 3 : 2;
  const ids = n === 3 ? ["ai1", "ai2", "ai3"] : ["ai1", "ai2"];
  return ids[state.turnCount % n];
}

function lockAgent(cfg: AiConfig): AiConfig {
  return {
    ...cfg,
    model: MUSE_SPARK_13_CONTRIBUTOR,
    api_base_url: cfg.api_base_url || "https://opencode.ai/zen/go/v1",
  };
}

function injectSeed() {
  const seed = state.config?.seed_prompt?.trim() || "";
  if (!seed) return;
  if (state.messages.some((m) => m.agent === "seed")) return;
  const msg: Message = {
    agent: "seed",
    role: "user",
    content: seed,
    turn: 0,
    created_at: nowMs(),
  };
  state.messages.push(msg);
  emit("new-message", msg);
}

function friendlyApiError(status: number, detail: string): string {
  const d = detail.toLowerCase();
  if (
    d.includes("geo") ||
    d.includes("region") ||
    d.includes("geographic") ||
    d.includes("not available in")
  ) {
    return "Muse Spark 1.3 contributor isn’t available in this region.";
  }
  if (
    status === 401 ||
    d.includes("unauthorized") ||
    d.includes("invalid api") ||
    d.includes("incorrect api")
  ) {
    return "That API key was rejected. Check it in Settings.";
  }
  if (status === 429) {
    return "Too many requests. Wait a moment, then press Next.";
  }
  if (status === 400 && d.includes("session")) {
    return "The session header was missing. Refresh and try again.";
  }
  return `Couldn’t reach OpenCode Go (${status}): ${detail}`;
}

function goHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "x-opencode-session": state.sessionId || "ai-conversation",
  };
}

function transcriptForApi(speaking: string, cfg: AiConfig) {
  const lengthNote =
    LENGTH_INSTRUCTIONS[cfg.response_length || "normal"] || "";
  const instructions = lengthNote
    ? `${cfg.system_prompt}\n\n${lengthNote}`
    : cfg.system_prompt;
  const input = state.messages.map((m) => ({
    role: m.agent === speaking ? "assistant" : "user",
    content: m.content,
  }));
  const note = state.pendingNarration.trim();
  if (note) {
    input.push({
      role: "user",
      content: `[Director note — for you only; weave this into your reply naturally, do not quote or acknowledge this note explicitly]\n${note}`,
    });
  }
  return { instructions, input };
}

function parseResponsesDelta(eventName: string, data: string): { kind: StreamKind; text: string } | null {
  if (!data || data === "[DONE]") return null;
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (eventName === "response.output_text.delta") {
    const text = String(json.delta ?? json.text ?? "");
    return text ? { kind: "content", text } : null;
  }
  if (
    eventName === "response.reasoning_summary_text.delta" ||
    eventName === "response.reasoning_text.delta"
  ) {
    const text = String(json.delta ?? json.text ?? "");
    return text ? { kind: "reasoning", text } : null;
  }
  return null;
}

async function streamResponses(cfg: AiConfig, speaking: string, turn: number) {
  if (!usesResponsesApi(cfg.model)) {
    throw new Error(
      `${cfg.model} is not enabled. This app uses Muse Spark 1.3 contributor.`,
    );
  }
  if (!cfg.api_key.trim()) {
    throw new Error("Add an OpenCode Go API key in Settings.");
  }

  const { instructions, input } = transcriptForApi(speaking, cfg);
  const url = responsesUrl(resolveApiBase(cfg.api_base_url));
  const ac = new AbortController();
  state.abort = ac;

  emit("stream-start", { agent: speaking, turn });

  const res = await fetch(url, {
    method: "POST",
    headers: goHeaders(cfg.api_key),
    body: JSON.stringify({
      model: MUSE_SPARK_13_CONTRIBUTOR,
      instructions,
      input,
      stream: true,
    }),
    signal: ac.signal,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = (await res.json()) as {
        error?: { message?: string } | string;
      };
      if (typeof err.error === "string") detail = err.error;
      else if (err.error?.message) detail = err.error.message;
    } catch {
      /* keep statusText */
    }
    throw new Error(friendlyApiError(res.status, detail));
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let eventName = "";

  const flushEvent = (raw: string) => {
    let name = eventName;
    let data = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    eventName = "";
    const piece = parseResponsesDelta(name, data);
    if (!piece) return;
    if (piece.kind === "reasoning") {
      reasoning += piece.text;
      emit("stream-chunk", {
        agent: speaking,
        turn,
        kind: "reasoning",
        delta: piece.text,
      });
    } else {
      content += piece.text;
      emit("stream-chunk", {
        agent: speaking,
        turn,
        kind: "content",
        delta: piece.text,
      });
    }
  };

  while (true) {
    if (state.reset) throw new DOMException("Aborted", "AbortError");
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (raw.trim()) flushEvent(raw);
    }
  }
  if (buffer.trim()) flushEvent(buffer);

  if (!content && reasoning) content = reasoning;
  if (!content) throw new Error("Empty model reply");
  return { content, reasoning: reasoning || undefined };
}

async function runOneTurn(): Promise<boolean> {
  if (state.reset) return false;
  const cfg = state.config;
  if (!cfg) return false;
  if (cfg.mode !== "step" && state.turnCount >= cfg.max_turns) return false;

  const speaking = nextSpeaker();
  const agent = lockAgent(agentConfig(speaking) || cfg.ai1_config);
  const turn = state.turnCount;
  const narration = state.pendingNarration;
  try {
    const { content, reasoning } = await streamResponses(agent, speaking, turn);
    if (state.reset) return false;
    if (narration && state.pendingNarration === narration) {
      state.pendingNarration = "";
      emit("narration-cleared", true);
    }
    const msg: Message = {
      agent: speaking,
      role: "assistant",
      content,
      turn,
      created_at: nowMs(),
      reasoning,
    };
    state.messages.push(msg);
    state.turnCount += 1;
    emit("new-message", msg);
    emit("stream-done", { agent: speaking, turn });
    emitStatus();
    return true;
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      emit("stream-abort", { agent: speaking, turn });
      return false;
    }
    emit("stream-abort", { agent: speaking, turn });
    emit("error", `${speaking} error: ${e instanceof Error ? e.message : e}`);
    state.status = "Paused";
    state.paused = true;
    emitStatus();
    return true;
  }
}

async function loop() {
  if (state.loopActive) return;
  state.loopActive = true;
  try {
    for (const m of state.messages) {
      if (m.agent === "seed") emit("new-message", m);
    }
    while (!state.reset) {
      if (state.status === "Idle") break;
      if (state.paused && !state.stepOnce) {
        await new Promise((r) => setTimeout(r, 40));
        continue;
      }
      if (state.config?.mode !== "step" && state.turnCount >= (state.config?.max_turns ?? 40)) {
        break;
      }
      const stepped = state.stepOnce || state.config?.mode === "step";
      const ok = await runOneTurn();
      if (!ok) break;
      if (stepped) {
        state.stepOnce = false;
        state.paused = true;
        state.status = "Paused";
        emitStatus();
        continue;
      }
      const delay = state.config?.delay_ms ?? 800;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
  } finally {
    state.loopActive = false;
    state.abort = null;
  }
}

export function setEngineConfig(cfg: InnerState) {
  state.config = {
    ...cfg,
    ai1_config: lockAgent(cfg.ai1_config),
    ai2_config: lockAgent(cfg.ai2_config),
    ai3_config: lockAgent(cfg.ai3_config),
  };
}

export function setEngineSession(id: string) {
  state.sessionId = id || "ai-conversation";
}

export function getEngineMessages(): Message[] {
  return state.messages;
}

export function getEngineStatus(): ["Idle" | "Running" | "Paused", number] {
  return [state.status, state.turnCount];
}

export async function engineStart() {
  if (state.status === "Running") throw new Error("Conversation is already running");
  if (state.config?.mode === "step" && state.status === "Paused") {
    throw new Error(
      "Step mode — press Next to advance one turn, or switch to Auto and Start",
    );
  }
  state.reset = false;
  state.paused = false;
  state.stepOnce = false;
  if (state.messages.length === 0) {
    state.turnCount = 0;
    injectSeed();
  }
  if (state.config?.mode === "step") {
    state.status = "Paused";
    state.paused = true;
  } else {
    state.status = "Running";
  }
  emitStatus();
  void loop();
}

export async function engineStep() {
  if (state.messages.length === 0) {
    state.turnCount = 0;
    injectSeed();
  }
  state.reset = false;
  state.stepOnce = true;
  state.paused = false;
  state.status = "Running";
  emitStatus();
  void loop();
}

export async function enginePause() {
  state.paused = true;
  state.stepOnce = false;
  state.status = "Paused";
  emitStatus();
}

export async function engineStop() {
  state.paused = true;
  state.stepOnce = false;
  state.status = "Idle";
  state.abort?.abort();
  emitStatus();
  emit("stream-abort", { agent: "", turn: 0 });
}

export async function engineReset() {
  state.reset = true;
  state.paused = true;
  state.stepOnce = false;
  state.abort?.abort();
  state.messages = [];
  state.turnCount = 0;
  state.pendingNarration = "";
  state.status = "Idle";
  emitStatus();
}

export async function engineLoadTranscript(messages: Message[], turnCount: number, chatId: string) {
  state.reset = true;
  state.paused = true;
  state.stepOnce = false;
  state.abort?.abort();
  state.messages = messages;
  state.turnCount = turnCount;
  state.status = "Idle";
  state.pendingNarration = "";
  setEngineSession(chatId);
  emitStatus();
  state.reset = false;
}

export async function engineSetNarration(text: string) {
  state.pendingNarration = text;
}

export async function engineDeleteMessage(
  agent: string,
  turn: number,
  created_at: number,
) {
  state.messages = state.messages.filter(
    (m) => !(m.agent === agent && m.turn === turn && m.created_at === created_at),
  );
}

export async function engineFetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${resolveApiBase(baseUrl)}/models`;
  const res = await fetch(url, {
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      "x-opencode-session": state.sessionId || "ai-conversation",
    },
  });
  if (!res.ok) throw new Error(friendlyApiError(res.status, `Models API ${res.status}`));
  const data = (await res.json()) as { data?: { id?: string }[] };
  const ids = (data.data || [])
    .map((m) => m.id)
    .filter((id): id is string => !!id);
  const locked = ids.filter((id) => id === MUSE_SPARK_13_CONTRIBUTOR);
  return locked.length ? locked : [MUSE_SPARK_13_CONTRIBUTOR];
}
