//! Pure conversation orchestration helpers (no I/O).

import type { AiConfig, AppStatus, ConversationMode, Message } from "./state.js";
import { codexAccountId } from "./jwt.js";

export const OPENCODE_ZEN_BASE = "https://opencode.ai/zen/v1";
export const OPENCODE_GO_BASE = "https://opencode.ai/zen/go/v1";
export const USER_AGENT = "ai-convoir/2.0";

type Json = Record<string, unknown>;

export function agentIds(botCount: number): string[] {
  return botCount === 3 ? ["ai1", "ai2", "ai3"] : ["ai1", "ai2"];
}

/** Next speaker after `turnsCompleted` single-bot turns (0-based cycle). */
export function nextSpeaker(botCount: number, turnsCompleted: number): string {
  const ids = agentIds(botCount);
  return ids[turnsCompleted % ids.length];
}

/** The speaking agent's past messages → assistant, everyone else's → user. */
export function messagesForApi(speakingAgent: string, transcript: Message[]): [string, string][] {
  return transcript.map((m) => [m.agent === speakingAgent ? "assistant" : "user", m.content]);
}

export function formatNarrationNote(narration: string): string {
  return `[Director note — for you only; weave this into your reply naturally, do not quote or acknowledge this note explicitly]\n${narration.trim()}`;
}

/** System prompt for API body / prompt-cache (byte-stable for a given config). */
export function systemPromptWithLength(config: AiConfig): string {
  return config.system_prompt;
}

/** OpenAI-compatible chat completions body. Message list is append-ordered. */
export function buildChatBody(
  config: AiConfig,
  speakingAgent: string,
  transcript: Message[],
  stream: boolean,
  narration: string | null,
): Json {
  const apiMessages: Json[] = [{ role: "system", content: systemPromptWithLength(config) }];
  for (const [role, content] of messagesForApi(speakingAgent, transcript)) {
    apiMessages.push({ role, content });
  }
  const n = narration?.trim();
  if (n) apiMessages.push({ role: "system", content: formatNarrationNote(n) });

  const body: Json = { model: config.model, messages: apiMessages, stream };
  // OpenAI reasoning models (gpt-5*, o-series) only accept the default temperature.
  if (!isOpenaiReasoningModel(config.api_base_url, config.model)) {
    body.temperature = config.temperature;
  }
  // Some providers reject max_tokens: 0; omit so the server default applies.
  if (config.max_tokens > 0) {
    // api.openai.com deprecated max_tokens; reasoning models reject it outright.
    const field = hostOf(config.api_base_url) === "api.openai.com" ? "max_completion_tokens" : "max_tokens";
    body[field] = config.max_tokens;
  }
  if (config.reasoning_effort !== "none") body.reasoning_effort = config.reasoning_effort;
  return body;
}

/** Display text from OpenAI content that may be a string or content-parts array. */
export function extractTextContent(node: unknown): string | null {
  if (typeof node === "string") return node ? node : null;
  if (Array.isArray(node)) {
    let out = "";
    for (const part of node) {
      if (typeof part === "string") out += part;
      else if (part && typeof (part as Json).text === "string") out += (part as Json).text as string;
    }
    return out ? out : null;
  }
  return null;
}

export type StreamPiece = { kind: "content" | "reasoning"; text: string };

export const REASONING_KEYS = ["reasoning_content", "reasoning", "thinking", "reasoning_text"];

function parseJson(data: string): Json | null {
  try {
    const v = JSON.parse(data);
    return v && typeof v === "object" ? (v as Json) : null;
  } catch {
    return null;
  }
}

/**
 * Incremental pieces from one chat SSE `data:` payload. Only reads
 * `choices[0].delta` — `message.content` is often cumulative and would duplicate.
 */
export function parseSseDataPayload(data: string): StreamPiece[] {
  const d = data.trim();
  if (!d || d === "[DONE]") return [];
  const v = parseJson(d);
  const choice = Array.isArray(v?.choices) ? (v!.choices as Json[])[0] : undefined;
  if (!choice) return [];
  const out: StreamPiece[] = [];
  const delta = choice.delta as Json | undefined;
  if (delta && typeof delta === "object") {
    for (const key of REASONING_KEYS) {
      const t = extractTextContent(delta[key]);
      if (t) {
        out.push({ kind: "reasoning", text: t });
        break;
      }
    }
    const c = extractTextContent(delta.content) ?? extractTextContent(delta.text);
    if (c) out.push({ kind: "content", text: c });
    return out;
  }
  const t = extractTextContent(choice.text);
  if (t) out.push({ kind: "content", text: t });
  return out;
}

/** Split a buffer into complete lines (head) and the trailing incomplete line. */
export function splitComplete(buffer: string): [string, string] | null {
  const dbl = buffer.lastIndexOf("\n\n");
  if (dbl >= 0) return [buffer.slice(0, dbl + 2), buffer.slice(dbl + 2)];
  if (buffer.endsWith("\n")) return [buffer, ""];
  const nl = buffer.lastIndexOf("\n");
  if (nl >= 0) return [buffer.slice(0, nl + 1), buffer.slice(nl + 1)];
  return null;
}

/** Parse a raw chat SSE buffer; returns pieces + leftover incomplete event. */
export function extractSseDeltas(buffer: string): [StreamPiece[], string] {
  const split = splitComplete(buffer);
  if (!split) return [[], buffer];
  const [complete, rest] = split;
  const deltas: StreamPiece[] = [];
  for (const raw of complete.split("\n")) {
    const line = raw.replace(/\r$/, "").trim();
    if (!line || line.startsWith(":") || line.startsWith("event:")) continue;
    if (line.startsWith("data:")) deltas.push(...parseSseDataPayload(line.slice(5).trim()));
  }
  return [deltas, rest];
}

export function parseModelsResponse(data: unknown): string[] {
  const arr = (data as Json | null)?.data;
  if (!Array.isArray(arr)) throw new Error("Models response missing data array");
  const ids = [
    ...new Set(arr.map((m) => (m as Json)?.id).filter((x): x is string => typeof x === "string")),
  ].sort();
  if (!ids.length) throw new Error("No model ids in response");
  return ids;
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export const modelsUrl = (base: string) => `${normalizeBaseUrl(base)}/models`;
export const chatUrl = (base: string) => `${normalizeBaseUrl(base)}/chat/completions`;
/** OpenAI Responses API (required for muse-spark-* on OpenCode Go). */
export const responsesUrl = (base: string) => `${normalizeBaseUrl(base)}/responses`;

export function usesResponsesApi(model: string): boolean {
  return model.startsWith("muse-spark");
}

/** ChatGPT sign-in (Codex backend) only speaks the Responses API. */
export function isCodexBase(base: string): boolean {
  return hostOf(base) === "chatgpt.com";
}

export function usesResponsesFor(config: AiConfig): boolean {
  return usesResponsesApi(config.model) || isCodexBase(config.api_base_url);
}

/** Lower-cased host of a base URL ("" when it can't be parsed). */
export function hostOf(base: string): string {
  const s = base.trim();
  const i = s.indexOf("://");
  const rest = i >= 0 ? s.slice(i + 3) : s;
  const authority = rest.split(/[/?#]/)[0] ?? "";
  const hostPort = authority.split("@").pop() ?? "";
  return (hostPort.split(":")[0] ?? "").toLowerCase();
}

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** OpenAI reasoning models on api.openai.com reject custom temperature. */
export function isOpenaiReasoningModel(base: string, model: string): boolean {
  if (hostOf(base) !== "api.openai.com") return false;
  const m = model.trim().toLowerCase();
  return m.startsWith("gpt-5") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4");
}

/** Auth + identification headers for an OpenAI-compatible provider, keyed off the host. */
export function providerHeaders(base: string, apiKey: string, sessionId: string): Record<string, string> {
  const host = hostOf(base);
  const h: Record<string, string> = { "User-Agent": USER_AGENT };
  const key = apiKey.trim();
  if (key) h.Authorization = `Bearer ${key}`;
  if (hostIs(host, "opencode.ai")) {
    h["x-opencode-session"] = sessionId.trim() ? sessionId : "ai-convoir";
  } else if (hostIs(host, "openrouter.ai")) {
    h["HTTP-Referer"] = "https://github.com/Warexpor/ai-convoir";
    h["X-Title"] = "AI ConvoIR";
  } else if (host === "chatgpt.com") {
    // Codex backend: the access token names the ChatGPT account to bill.
    const acc = codexAccountId(key);
    if (acc) h["chatgpt-account-id"] = acc;
    h["OpenAI-Beta"] = "responses=experimental";
    h.originator = "ai_convoir";
    if (sessionId.trim()) h.session_id = sessionId;
  } else if (hostIs(host, "anthropic.com")) {
    if (key) h["x-api-key"] = key;
    h["anthropic-version"] = "2023-06-01";
  }
  return h;
}

export type StartAction =
  | "RejectAlreadyRunning"
  | "ResumeAuto"
  | "RejectStepPaused"
  | "FreshStart"
  | "ContinueIdle";

/** What `start_conversation` should do; transcript length lets Stop → Start resume. */
export function startActionWithTranscript(
  status: AppStatus,
  mode: ConversationMode,
  messageCount: number,
): StartAction {
  if (status === "Running") return "RejectAlreadyRunning";
  if (status === "Paused") return mode === "auto" ? "ResumeAuto" : "RejectStepPaused";
  if (messageCount > 0) return mode === "auto" ? "ContinueIdle" : "RejectStepPaused";
  return "FreshStart";
}

/** Validate a single-step advance. Mode is never changed (step_once drives it). */
export function prepareStep(mode: ConversationMode, turnCount: number, maxTurns: number): void {
  if (mode !== "step" && turnCount >= maxTurns) throw new Error("Max turns reached");
}

const EXACT_CONTEXT: Record<string, number> = {
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-3.5-turbo": 128000,
  "deepseek-chat": 128000,
  "deepseek-reasoner": 128000,
  o1: 200000,
  "o1-mini": 200000,
  "o3-mini": 200000,
  "claude-sonnet-4": 200000,
  "claude-4-opus": 200000,
  "claude-3-5-sonnet": 200000,
  "claude-3-opus": 200000,
  "claude-3-sonnet": 200000,
  "claude-3-haiku": 200000,
  "gemini-2.5-pro": 1_000_000,
  "gemini-2.0-flash": 1_000_000,
  "gemini-1.5-pro": 2_000_000,
  "gemini-1.5-flash": 2_000_000,
};

/** Known model context windows (tokens). Mirrors the frontend's MODEL_CONTEXTS. */
export function contextWindowFor(model: string): number {
  if (model in EXACT_CONTEXT) return EXACT_CONTEXT[model];
  if (model.startsWith("gpt-4o") || model.startsWith("gpt-4-turbo") || model.startsWith("gpt-3.5")) return 128000;
  if (model.startsWith("claude") || model.startsWith("o1") || model.startsWith("o3")) return 200000;
  if (model.startsWith("gemini")) return 1_000_000;
  return 128000;
}

/** Rough token estimate: ~4 UTF-8 bytes per token. */
export function estimateTokens(s: string): number {
  return Math.floor((Buffer.byteLength(s, "utf8") + 3) / 4);
}

/**
 * Newest-first subset of messages that fits the speaking model's window.
 * Never deletes anything; always keeps at least the newest message.
 */
export function trimMessagesForContext(
  activeConfigs: AiConfig[],
  seedPrompt: string,
  allMessages: Message[],
  speakingModel: string,
): Message[] {
  if (!allMessages.length) return [];
  const model = speakingModel.trim() ? speakingModel : (activeConfigs[0]?.model ?? "gpt-4o-mini");
  const ctx = contextWindowFor(model);
  const systemTokens = activeConfigs.reduce((n, c) => n + estimateTokens(c.system_prompt), 0);
  const budget = Math.max(0, ctx - (systemTokens + estimateTokens(seedPrompt) + 2000));
  let used = 0;
  const kept: Message[] = [];
  for (let i = allMessages.length - 1; i >= 0; i--) {
    const m = allMessages[i];
    const t = estimateTokens(m.content) + (m.reasoning ? estimateTokens(m.reasoning) : 0);
    if (used + t > budget) {
      if (!kept.length) kept.push(m);
      break;
    }
    used += t;
    kept.push(m);
  }
  return kept.reverse();
}
