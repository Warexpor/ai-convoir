//! Agentic turn harness: typed state machine, prepare, prompt-cache, metrics.

import {
  buildChatBody,
  estimateTokens,
  messagesForApi,
  nextSpeaker,
  normalizeBaseUrl,
  systemPromptWithLength,
  trimMessagesForContext,
  usesResponsesFor,
} from "./engine.js";
import { configForAgent, type AiConfig, type InnerState, type Message } from "./state.js";
import { logger } from "./logging.js";

type Json = Record<string, unknown>;

// ── usage / cache ───────────────────────────────────────────────────

export interface TokenUsage {
  prompt_tokens?: number;
  cached_tokens?: number;
  completion_tokens?: number;
}

export function mergeUsage(into: TokenUsage, other: TokenUsage) {
  if (other.prompt_tokens !== undefined) into.prompt_tokens = other.prompt_tokens;
  if (other.cached_tokens !== undefined) into.cached_tokens = other.cached_tokens;
  if (other.completion_tokens !== undefined) into.completion_tokens = other.completion_tokens;
}

/** FNV-1a 64-bit — stable across runs. */
function fnv1a64(data: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  for (const b of data) {
    hash ^= BigInt(b);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

function bytes(parts: (string | number)[]): Uint8Array {
  const chunks = parts.map((p) => (typeof p === "number" ? Buffer.from([p]) : Buffer.from(p, "utf8")));
  return Buffer.concat(chunks);
}

/** Byte-stable fingerprint of the immutable prompt prefix for a speaking agent. */
export function immutablePrefixFingerprint(config: AiConfig, agent: string, transcript: Message[]): string {
  const parts: (string | number)[] = ["system", 0, systemPromptWithLength(config), 0];
  for (const [role, content] of messagesForApi(agent, transcript)) parts.push(role, 0, content, 0);
  return fnv1a64(bytes(parts));
}

/** Stable `prompt_cache_key`: hash(model + base + agent + system). No mutable tail. */
export function computePromptCacheKey(config: AiConfig, agent: string): string {
  const buf = bytes([
    config.model,
    "|",
    normalizeBaseUrl(config.api_base_url),
    "|",
    agent,
    "|",
    systemPromptWithLength(config),
  ]);
  return `acv-${fnv1a64(buf)}`;
}

export function applyPromptCacheKey(body: Json, key: string) {
  if (key) body.prompt_cache_key = key;
}

export function applyStreamUsageOption(body: Json) {
  if (body.stream === true) body.stream_options = { include_usage: true };
}

const num = (v: unknown) => (typeof v === "number" && v >= 0 ? Math.floor(v) : undefined);

/** Usage (+ cached tokens) from a full response or an SSE payload with `usage`. */
export function extractUsage(v: unknown): TokenUsage {
  const usage = (v as Json | null)?.usage as Json | undefined;
  if (!usage || typeof usage !== "object") return {};
  const pick = (...vals: unknown[]) => {
    for (const x of vals) {
      const n = num(x);
      if (n !== undefined) return n;
    }
    return undefined;
  };
  const out: TokenUsage = {};
  const p = pick(usage.prompt_tokens, usage.input_tokens);
  const c = pick(usage.completion_tokens, usage.output_tokens);
  const k = pick(
    (usage.prompt_tokens_details as Json | undefined)?.cached_tokens,
    (usage.input_tokens_details as Json | undefined)?.cached_tokens,
    usage.cached_tokens,
  );
  if (p !== undefined) out.prompt_tokens = p;
  if (c !== undefined) out.completion_tokens = c;
  if (k !== undefined) out.cached_tokens = k;
  return out;
}

export function estimatePromptTokens(
  config: AiConfig,
  agent: string,
  transcript: Message[],
  narration: string | null,
): number {
  let total = estimateTokens(systemPromptWithLength(config));
  for (const [role, content] of messagesForApi(agent, transcript)) {
    total += estimateTokens(role) + estimateTokens(content);
  }
  const n = narration?.trim();
  if (n) total += estimateTokens(n) + 40;
  return total;
}

// ── prepare ─────────────────────────────────────────────────────────

export interface PreparedTurn {
  agent: string;
  turn: number;
  config: AiConfig;
  contextMessages: Message[];
  narration: string | null;
  createdAt: number;
  chatId: string;
  promptEstTokens: number;
  trimmed: boolean;
  cacheKey: string;
  prefixFingerprint: string;
  chatBody: Json;
  usesResponses: boolean;
}

export function prepareTurn(
  inner: InnerState,
  narration: string | null,
  createdAt: number,
  stream: boolean,
): PreparedTurn {
  if (inner.mode !== "step" && inner.turn_count >= inner.max_turns) {
    throw new Error("Max turns reached");
  }
  const agent = nextSpeaker(inner.bot_count, inner.turn_count);
  const config = structuredClone(configForAgent(inner, agent));
  const active =
    inner.bot_count === 3
      ? [inner.ai1_config, inner.ai2_config, inner.ai3_config]
      : [inner.ai1_config, inner.ai2_config];
  const contextMessages = trimMessagesForContext(active, inner.seed_prompt, inner.messages, config.model);
  const trimmed = contextMessages.length < inner.messages.length;
  const cacheKey = computePromptCacheKey(config, agent);
  const chatBody = buildChatBody(config, agent, contextMessages, stream, narration);
  applyPromptCacheKey(chatBody, cacheKey);
  if (stream) applyStreamUsageOption(chatBody);
  const prepared: PreparedTurn = {
    agent,
    turn: inner.turn_count,
    config,
    contextMessages,
    narration,
    createdAt,
    chatId: inner.active_chat_id,
    promptEstTokens: estimatePromptTokens(config, agent, contextMessages, narration),
    trimmed,
    cacheKey,
    prefixFingerprint: immutablePrefixFingerprint(config, agent, contextMessages),
    chatBody,
    usesResponses: usesResponsesFor(config),
  };
  logger.debug("harness", `prepared turn agent=${agent} turn=${prepared.turn} key=${cacheKey} est=${prepared.promptEstTokens} trimmed=${trimmed}`);
  return prepared;
}

// ── turn state machine ──────────────────────────────────────────────

export type TurnPhase = "Idle" | "Preparing" | "Streaming" | "Committing" | "Next" | "Stopped" | "Error";

/** Drives prepare → stream → commit → next (or stop/error). Pause lives in AppState. */
export class TurnMachine {
  phase: TurnPhase = "Idle";

  private expect(from: TurnPhase[], to: TurnPhase, attempted: string) {
    if (!from.includes(this.phase)) {
      throw new Error(`invalid harness transition: ${this.phase} cannot ${attempted}`);
    }
    this.phase = to;
  }

  beginPrepare() {
    this.expect(["Idle", "Next"], "Preparing", "begin_prepare");
  }
  beginStream() {
    this.expect(["Preparing"], "Streaming", "begin_stream");
  }
  beginCommit() {
    this.expect(["Streaming"], "Committing", "begin_commit");
  }
  toNext() {
    this.expect(["Committing"], "Next", "to_next");
  }
  stop() {
    this.phase = "Stopped";
  }
  fail() {
    this.phase = "Error";
  }
  abortStream() {
    if (this.phase === "Streaming" || this.phase === "Preparing" || this.phase === "Committing") {
      this.phase = "Stopped";
    }
  }
}

// ── metrics ─────────────────────────────────────────────────────────

export interface TurnMetrics {
  agent: string;
  turn: number;
  prompt_est_tokens: number;
  trimmed: boolean;
  cache_key: string;
  ttft_ms: number | null;
  stream_duration_ms: number | null;
  content_chars: number;
  reasoning_chars: number;
  prompt_tokens: number | null;
  cached_tokens: number | null;
  completion_tokens: number | null;
  phase_end: string;
}

export function applyUsageToMetrics(m: TurnMetrics, u: TokenUsage) {
  if (u.prompt_tokens !== undefined) m.prompt_tokens = u.prompt_tokens;
  if (u.cached_tokens !== undefined) m.cached_tokens = u.cached_tokens;
  if (u.completion_tokens !== undefined) m.completion_tokens = u.completion_tokens;
}

export function logTurnMetrics(m: TurnMetrics) {
  logger.info("harness", `turn metrics ${JSON.stringify(m)}`);
}
