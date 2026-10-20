import {
  buildChatBody,
  chatUrl,
  extractSseDeltas,
  extractTextContent,
  isCodexBase,
  modelsUrl,
  parseModelsResponse,
  providerHeaders,
  REASONING_KEYS,
  responsesUrl,
  splitComplete,
  type StreamPiece,
} from "./engine.js";
import {
  applyPromptCacheKey,
  computePromptCacheKey,
  extractUsage,
  mergeUsage,
  type PreparedTurn,
  type TokenUsage,
} from "./harness.js";
import type { AiConfig, AppState, Message } from "./state.js";
import { hydrate, isOauthProvider } from "./oauth.js";

type Json = Record<string, unknown>;
export type Emit = (event: string, payload: unknown) => void;

/** Returned when reset/stop cancels an in-flight stream. */
export const STREAM_ABORTED = "aborted";

/** Timeout for fetch_models / non-stream JSON calls (fail fast). */
export const SHORT_HTTP_TIMEOUT_MS = 30_000;
/** Timeout for SSE bodies (long generations). */
export const STREAM_HTTP_TIMEOUT_MS = 900_000;

export interface StreamOutcome {
  content: string;
  reasoning: string | null;
  usage: TokenUsage;
  ttftMs: number | null;
  streamDurationMs: number;
}

/** Cancel signal for an in-flight stream: reset flag, or the epoch moved on. */
export class StreamCancel {
  readonly signal: AbortSignal;
  constructor(
    private state: AppState,
    readonly epochAtStart: number,
  ) {
    this.signal = state.epochAbort.signal;
  }
  isCancelled(): boolean {
    return this.state.resetFlag || this.state.streamEpoch !== this.epochAtStart || this.signal.aborted;
  }
}

class Aborted extends Error {
  constructor() {
    super(STREAM_ABORTED);
  }
}

function checkCancel(cancel: StreamCancel) {
  if (cancel.isCancelled()) throw new Aborted();
}

/** POST/GET with cancel + timeout. Cancel → STREAM_ABORTED; timeout/network → readable error. */
async function send(
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: unknown },
  cancel: StreamCancel | null,
  timeoutMs: number,
  failPrefix: string,
): Promise<Response> {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (cancel) signals.push(cancel.signal);
  if (cancel) checkCancel(cancel);
  try {
    return await fetch(url, {
      method: init.method ?? "POST",
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.any(signals),
    });
  } catch (e) {
    if (cancel?.isCancelled()) throw new Aborted();
    throw new Error(`${failPrefix}: ${describe(e)}`);
  }
}

function describe(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError") return "timed out";
    const cause = (e as { cause?: { message?: string; code?: string } }).cause;
    return cause?.message || cause?.code || e.message;
  }
  return String(e);
}

async function readJson(res: Response, cancel: StreamCancel | null): Promise<unknown> {
  try {
    return await res.json();
  } catch (e) {
    if (cancel?.isCancelled()) throw new Aborted();
    throw new Error(`Parse failed: ${describe(e)}`);
  }
}

async function apiError(res: Response, cancel: StreamCancel | null, prefix = "API"): Promise<Error> {
  let data: Json = {};
  try {
    data = ((await res.json()) as Json) ?? {};
  } catch {
    if (cancel?.isCancelled()) return new Aborted();
  }
  const err = data.error as Json | string | undefined;
  const msg =
    (typeof err === "object" && err && typeof err.message === "string" && err.message) ||
    (typeof err === "string" && err) ||
    "unknown API error";
  return new Error(`${prefix} ${res.status} ${res.statusText}`.trimEnd() + `: ${msg}`);
}

function headersFor(config: AiConfig, sessionId: string, stream: boolean): Record<string, string> {
  const h = providerHeaders(config.api_base_url, config.api_key, sessionId);
  h["Content-Type"] = "application/json";
  if (stream) h.Accept = "text/event-stream";
  return h;
}

/** Content + reasoning from a chat-completions JSON body (non-stream / collapsed). */
export function extractChatMessagePair(data: unknown): [string, string | null] | null {
  const choices = (data as Json | null)?.choices;
  const choice = Array.isArray(choices) ? (choices[0] as Json | undefined) : undefined;
  if (!choice) return null;
  const msg = (choice.message as Json | undefined) ?? choice;
  const content = extractTextContent(msg.content);
  if (content) {
    for (const key of REASONING_KEYS) {
      const t = extractTextContent(msg[key]);
      if (t) return [content, t];
    }
    return [content, null];
  }
  const r =
    extractTextContent(msg.reasoning_content) ?? extractTextContent(msg.reasoning) ?? extractTextContent(msg.thinking);
  if (r) return [r, r];
  const t = extractTextContent(choice.text);
  return t ? [t, null] : null;
}

function finishReason(data: unknown): string {
  const choices = (data as Json | null)?.choices;
  const fr = Array.isArray(choices) ? (choices[0] as Json | undefined)?.finish_reason : undefined;
  return typeof fr === "string" ? fr : "stop";
}

async function callLlmWithUsage(
  config: AiConfig,
  agent: string,
  context: Message[],
  narration: string | null,
  sessionId: string,
  cancel: StreamCancel,
): Promise<[string, string | null, TokenUsage]> {
  const body = buildChatBody(config, agent, context, false, narration);
  applyPromptCacheKey(body, computePromptCacheKey(config, agent));
  const res = await send(chatUrl(config.api_base_url), { headers: headersFor(config, sessionId, false), body }, cancel, SHORT_HTTP_TIMEOUT_MS, "Request failed");
  if (!res.ok) throw await apiError(res, cancel);
  const data = await readJson(res, cancel);
  const pair = extractChatMessagePair(data);
  if (!pair) throw new Error(`No content in API response (finish_reason: ${finishReason(data)})`);
  return [pair[0], pair[1], extractUsage(data)];
}

// ── Responses API ───────────────────────────────────────────────────

export function responsesBodyFromChat(chat: Json, config: AiConfig, stream: boolean): Json {
  const msgs = Array.isArray(chat.messages) ? (chat.messages as Json[]) : [];
  let instructions = "";
  const input: Json[] = [];
  for (const m of msgs) {
    const role = typeof m.role === "string" ? m.role : "";
    const content = typeof m.content === "string" ? m.content : "";
    if (role === "system" && !instructions) instructions = content;
    // Extra system rows (director note) → user; some proxies reject system in `input`.
    else input.push({ role: role === "system" ? "user" : role, content });
  }
  const body: Json = {
    model: config.model.trim() ? config.model : "muse-spark-1.3-contributor",
    instructions,
    input,
    stream,
    temperature: config.temperature,
  };
  if (config.max_tokens > 0) body.max_output_tokens = config.max_tokens;
  if (config.reasoning_effort !== "none") {
    body.reasoning = { effort: config.reasoning_effort, summary: "auto" };
  }
  if (typeof chat.prompt_cache_key === "string") applyPromptCacheKey(body, chat.prompt_cache_key);
  if (isCodexBase(config.api_base_url)) codexAdjust(body, config);
  return body;
}

/** Codex backend: stateless streamed requests only, no sampling/length knobs. */
function codexAdjust(body: Json, config: AiConfig) {
  delete body.temperature;
  delete body.max_output_tokens;
  body.store = false;
  body.stream = true;
  body.include = ["reasoning.encrypted_content"];
  if (config.reasoning_effort !== "none") {
    body.reasoning = { effort: config.reasoning_effort, summary: "auto" };
  }
}

function parseJson(data: string): Json | null {
  try {
    const v = JSON.parse(data);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function blockEventData(block: string): [string, string] {
  let event = "";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trim();
  }
  return [event, data];
}

function parseResponsesEvent(event: string, data: string): [StreamPiece[], TokenUsage] {
  const d = data.trim();
  if (!d || d === "[DONE]") return [[], {}];
  const v = parseJson(d);
  if (!v) return [[], {}];
  const usage = extractUsage(v);
  // Proxies often put the type only in JSON (no SSE `event:` line).
  const ty = event || (typeof v.type === "string" ? v.type : "");
  // `response.completed` is ignored here (would duplicate live deltas).
  const text =
    (typeof v.delta === "string" && v.delta) ||
    (typeof v.text === "string" && v.text) ||
    (typeof v.refusal === "string" && v.refusal) ||
    "";
  if (!text) return [[], usage];
  switch (ty) {
    case "response.output_text.delta":
    case "response.refusal.delta":
      return [[{ kind: "content", text }], usage];
    case "response.reasoning_summary_text.delta":
    case "response.reasoning_text.delta":
      return [[{ kind: "reasoning", text }], usage];
    default:
      return [[], usage];
  }
}

export function parseResponsesSseBlock(block: string): [StreamPiece[], TokenUsage] {
  const [event, data] = blockEventData(block);
  return parseResponsesEvent(event, data);
}

const normalizeNl = (s: string) => s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

/** Consume complete `\n\n`-delimited Responses SSE blocks; return pieces + leftover. */
export function consumeResponsesSse(buffer: string): [StreamPiece[], string, TokenUsage] {
  const parts = normalizeNl(buffer).split("\n\n");
  if (parts.length <= 1) return [[], parts[0] ?? "", {}];
  const pieces: StreamPiece[] = [];
  const usage: TokenUsage = {};
  for (const block of parts.slice(0, -1)) {
    const [p, u] = parseResponsesSseBlock(block);
    mergeUsage(usage, u);
    pieces.push(...p);
  }
  return [pieces, parts[parts.length - 1], usage];
}

function textParts(parts: unknown, accept: (ty: string) => boolean, into: string[]) {
  if (!Array.isArray(parts)) return false;
  for (const part of parts as Json[]) {
    const pty = typeof part?.type === "string" ? part.type : "";
    if (accept(pty) && typeof part.text === "string") into.push(part.text);
    else if (pty === "refusal") {
      const t = typeof part.refusal === "string" ? part.refusal : typeof part.text === "string" ? part.text : "";
      if (t) into.push(t);
    }
  }
  return true;
}

function reasoningFromItem(item: Json, into: string[]) {
  for (const key of ["summary", "content"]) {
    const parts = item[key];
    if (Array.isArray(parts)) {
      for (const p of parts as Json[]) if (typeof p?.text === "string") into.push(p.text);
    }
  }
}

function extractResponsesReasoning(data: Json): string | null {
  const out: string[] = [];
  if (Array.isArray(data.output)) {
    for (const item of data.output as Json[]) if (item?.type === "reasoning") reasoningFromItem(item, out);
  }
  return out.length ? out.join("") : null;
}

/** Visible text (+ reasoning) from a non-stream Responses JSON body. */
export function extractResponsesOutput(data: Json): [string, string | null] {
  const ot = extractTextContent(data.output_text);
  if (ot) return [ot, extractResponsesReasoning(data)];
  const content: string[] = [];
  const reasoning: string[] = [];
  if (Array.isArray(data.output)) {
    for (const item of data.output as Json[]) {
      const ty = typeof item?.type === "string" ? item.type : "";
      if (ty === "message") {
        if (!textParts(item.content, (p) => p === "output_text" || p === "text", content)) {
          const t = extractTextContent(item.content);
          if (t) content.push(t);
        }
      } else if (ty === "reasoning") {
        reasoningFromItem(item, reasoning);
      } else if (!ty && item?.role === "assistant") {
        // Some proxies omit `type` and only set role=assistant.
        if (!textParts(item.content, (p) => p === "output_text" || p === "text" || p === "", content)) {
          const t = extractTextContent(item.content);
          if (t) content.push(t);
        }
      }
    }
  }
  let c = content.join("");
  let r = reasoning.join("");
  if (!c) {
    const pair = extractChatMessagePair(data);
    if (pair) {
      const choices = data.choices as Json[];
      const msg = (choices?.[0]?.message as Json | undefined) ?? {};
      const mc = extractTextContent(msg.content);
      if (mc) c = mc;
      for (const key of REASONING_KEYS) {
        const t = extractTextContent(msg[key]);
        if (t) {
          r = t;
          break;
        }
      }
    }
  }
  if (!c && r) c = r;
  if (!c) throw new Error("No content in Responses API output");
  return [c, r || null];
}

/** Find a `response.completed` payload and pull its final text (empty-SSE recovery). */
export function harvestResponsesCompleted(buffer: string): [string, string | null, TokenUsage] | null {
  for (const block of normalizeNl(buffer).split("\n\n")) {
    const [event, data] = blockEventData(block);
    const d = data.trim();
    if (!d) continue;
    const v = parseJson(d);
    if (!v) continue;
    const ty = event || (typeof v.type === "string" ? v.type : "");
    if (ty !== "response.completed") continue;
    const resp = (v.response as Json | undefined) ?? v;
    try {
      const [c, r] = extractResponsesOutput(resp);
      if (c) return [c, r, extractUsage(resp)];
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

async function callResponsesWithUsage(
  config: AiConfig,
  chatBody: Json,
  sessionId: string,
  cancel: StreamCancel,
): Promise<[string, string | null, TokenUsage]> {
  const body = responsesBodyFromChat(chatBody, config, false);
  const res = await send(responsesUrl(config.api_base_url), { headers: headersFor(config, sessionId, false), body }, cancel, SHORT_HTTP_TIMEOUT_MS, "Request failed");
  if (!res.ok) throw await apiError(res, cancel);
  const data = (await readJson(res, cancel)) as Json;
  const [c, r] = extractResponsesOutput(data ?? {});
  return [c, r, extractUsage(data)];
}

// ── stream plumbing ─────────────────────────────────────────────────

/** Per-turn emitter state shared by both stream flavours. */
class TurnStream {
  started = false;
  ttftMs: number | null = null;
  readonly t0 = performance.now();
  usage: TokenUsage = {};
  full = "";
  fullReasoning = "";

  constructor(
    private emit: Emit,
    readonly agent: string,
    readonly turn: number,
    readonly createdAt: number,
  ) {}

  ensureStart() {
    if (!this.started) {
      this.emit("stream-start", { agent: this.agent, turn: this.turn, created_at: this.createdAt });
      this.started = true;
    }
  }

  chunk(kind: "content" | "reasoning", delta: string) {
    if (!delta) return;
    this.emit("stream-chunk", { agent: this.agent, turn: this.turn, kind, delta });
  }

  noteTtft() {
    if (this.ttftMs === null) this.ttftMs = Math.round(performance.now() - this.t0);
  }

  piece(p: StreamPiece) {
    this.ensureStart();
    this.noteTtft();
    if (p.kind === "content") this.full += p.text;
    else this.fullReasoning += p.text;
    this.chunk(p.kind, p.text);
  }

  /** Emit a whole reply at once (collapsed JSON / fallback). */
  whole(content: string, reasoning: string | null): StreamOutcome {
    this.noteTtft();
    this.ensureStart();
    if (reasoning) this.chunk("reasoning", reasoning);
    this.chunk("content", content);
    return this.outcome(content, reasoning);
  }

  outcome(content: string, reasoning: string | null): StreamOutcome {
    return {
      content,
      reasoning,
      usage: this.usage,
      ttftMs: this.ttftMs,
      streamDurationMs: Math.round(performance.now() - this.t0),
    };
  }
}

async function* readText(res: Response, cancel: StreamCancel): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  try {
    while (true) {
      let r: ReadableStreamReadResult<Uint8Array>;
      try {
        r = await reader.read();
      } catch (e) {
        if (cancel.isCancelled()) throw new Aborted();
        throw new Error(`Stream read failed: ${describe(e)}`);
      }
      checkCancel(cancel);
      if (r.done) break;
      const s = decoder.decode(r.value, { stream: true });
      if (s) yield s;
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
    if (cancel.isCancelled()) void res.body.cancel().catch(() => {});
  }
}

function isJsonOnly(res: Response): boolean {
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  return ct.includes("application/json") && !ct.includes("event-stream");
}

async function streamResponses(
  config: AiConfig,
  ts: TurnStream,
  chatBody: Json,
  sessionId: string,
  cancel: StreamCancel,
): Promise<StreamOutcome> {
  const body = responsesBodyFromChat(chatBody, config, true);
  const res = await send(responsesUrl(config.api_base_url), { headers: headersFor(config, sessionId, true), body }, cancel, STREAM_HTTP_TIMEOUT_MS, "Stream request failed");
  if (!res.ok) throw await apiError(res, cancel);
  // Open the FE bubble as soon as the provider accepts the request.
  ts.ensureStart();

  if (isJsonOnly(res)) {
    const data = ((await readJson(res, cancel)) as Json) ?? {};
    mergeUsage(ts.usage, extractUsage(data));
    const [text, reasoning] = extractResponsesOutput(data);
    checkCancel(cancel);
    return ts.whole(text, reasoning);
  }

  let textBuf = "";
  for await (const s of readText(res, cancel)) {
    const [pieces, rest, u] = consumeResponsesSse(textBuf + s);
    mergeUsage(ts.usage, u);
    textBuf = rest;
    pieces.forEach((p) => ts.piece(p));
  }
  // Flush a trailing event that lacked a final blank line.
  if (textBuf.trim()) {
    const [pieces, u] = parseResponsesSseBlock(normalizeNl(textBuf));
    mergeUsage(ts.usage, u);
    pieces.forEach((p) => ts.piece(p));
  }
  checkCancel(cancel);

  // Empty content: collapsed JSON → response.completed harvest → reasoning promote → HTTP fallback.
  if (!ts.full) {
    const data = parseJson(textBuf.trim());
    if (data) {
      try {
        const [text, reasoning] = extractResponsesOutput(data);
        mergeUsage(ts.usage, extractUsage(data));
        checkCancel(cancel);
        return ts.whole(text, reasoning);
      } catch {
        /* fall through */
      }
    }
    const harvested = harvestResponsesCompleted(textBuf);
    if (harvested && harvested[0]) {
      mergeUsage(ts.usage, harvested[2]);
      checkCancel(cancel);
      return ts.whole(harvested[0], harvested[1]);
    }
  }

  if (!ts.full && ts.fullReasoning) {
    ts.full = ts.fullReasoning;
    ts.chunk("content", ts.full);
  }

  if (!ts.full) {
    checkCancel(cancel);
    const [c, r, u] = await callResponsesWithUsage(config, chatBody, sessionId, cancel);
    checkCancel(cancel);
    mergeUsage(ts.usage, u);
    return ts.whole(c, r);
  }

  // Partial deltas, but response.completed extends them: emit only the missing suffix.
  const harvested = harvestResponsesCompleted(textBuf);
  if (harvested) {
    const [text, hr, u] = harvested;
    if (text.length > ts.full.length && text.startsWith(ts.full)) {
      mergeUsage(ts.usage, u);
      checkCancel(cancel);
      ts.chunk("content", text.slice(ts.full.length));
      ts.full = text;
      if (hr) {
        if (hr.length > ts.fullReasoning.length && hr.startsWith(ts.fullReasoning)) {
          ts.chunk("reasoning", hr.slice(ts.fullReasoning.length));
          ts.fullReasoning = hr;
        } else if (!ts.fullReasoning) {
          ts.chunk("reasoning", hr);
          ts.fullReasoning = hr;
        }
      }
    }
  }
  return ts.outcome(ts.full, ts.fullReasoning || null);
}

/** Like extractSseDeltas, but also harvests `usage` from complete payloads. */
function extractSseDeltasWithUsage(buffer: string): [StreamPiece[], string, TokenUsage] {
  const [deltas, rest] = extractSseDeltas(buffer);
  const usage: TokenUsage = {};
  const split = splitComplete(buffer);
  if (split) {
    for (const raw of split[0].split("\n")) {
      const line = raw.replace(/\r$/, "").trim();
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      const v = parseJson(d);
      if (v) mergeUsage(usage, extractUsage(v));
    }
  }
  return [deltas, rest, usage];
}

async function streamChatSse(
  config: AiConfig,
  ts: TurnStream,
  context: Message[],
  narration: string | null,
  chatBody: Json,
  sessionId: string,
  cancel: StreamCancel,
): Promise<StreamOutcome> {
  const res = await send(chatUrl(config.api_base_url), { headers: headersFor(config, sessionId, true), body: chatBody }, cancel, STREAM_HTTP_TIMEOUT_MS, "Stream request failed");
  if (!res.ok) throw await apiError(res, cancel);
  ts.ensureStart();

  if (isJsonOnly(res)) {
    const data = await readJson(res, cancel);
    mergeUsage(ts.usage, extractUsage(data));
    const pair = extractChatMessagePair(data);
    if (!pair) throw new Error(`No content in API response (finish_reason: ${finishReason(data)})`);
    checkCancel(cancel);
    return ts.whole(pair[0], pair[1]);
  }

  let textBuf = "";
  for await (const s of readText(res, cancel)) {
    const [deltas, rest, u] = extractSseDeltasWithUsage(normalizeNl(textBuf + s));
    mergeUsage(ts.usage, u);
    textBuf = rest;
    deltas.forEach((p) => ts.piece(p));
  }
  if (textBuf) {
    const [deltas, , u] = extractSseDeltasWithUsage(`${textBuf}\n\n`);
    mergeUsage(ts.usage, u);
    deltas.forEach((p) => ts.piece(p));
  }
  checkCancel(cancel);

  if (!ts.full) {
    const data = parseJson(textBuf.trim());
    const pair = data ? extractChatMessagePair(data) : null;
    if (pair) {
      mergeUsage(ts.usage, extractUsage(data));
      checkCancel(cancel);
      return ts.whole(pair[0], pair[1]);
    }
  }

  if (!ts.full && ts.fullReasoning) {
    ts.full = ts.fullReasoning;
    ts.chunk("content", ts.full);
  }

  if (!ts.full) {
    checkCancel(cancel);
    const [c, r, u] = await callLlmWithUsage(config, ts.agent, context, narration, sessionId, cancel);
    checkCancel(cancel);
    mergeUsage(ts.usage, u);
    return ts.whole(c, r);
  }
  return ts.outcome(ts.full, ts.fullReasoning || null);
}

/**
 * Stream a harness-prepared turn. Throws Error(STREAM_ABORTED) on cancel,
 * any other Error on API/network failure.
 */
export async function streamPrepared(prepared: PreparedTurn, emit: Emit, cancel: StreamCancel): Promise<StreamOutcome> {
  const sessionId = prepared.chatId || "ai-convoir";
  try {
    // Sign-in providers get a fresh access token per turn.
    const config = isOauthProvider(prepared.config.provider) ? await hydrate(prepared.config) : prepared.config;
    checkCancel(cancel);
    const ts = new TurnStream(emit, prepared.agent, prepared.turn, prepared.createdAt);
    if (prepared.usesResponses) return await streamResponses(config, ts, prepared.chatBody, sessionId, cancel);
    return await streamChatSse(config, ts, prepared.contextMessages, prepared.narration, prepared.chatBody, sessionId, cancel);
  } catch (e) {
    if (e instanceof Aborted || cancel.isCancelled()) throw new Error(STREAM_ABORTED);
    throw e;
  }
}

export async function fetchModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const res = await send(
    modelsUrl(baseUrl),
    { method: "GET", headers: providerHeaders(baseUrl, apiKey, "ai-convoir") },
    null,
    SHORT_HTTP_TIMEOUT_MS,
    "Models request failed",
  );
  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`Models parse failed: ${describe(e)}`);
  }
  if (!res.ok) {
    const err = (data as Json | null)?.error as Json | string | undefined;
    const msg =
      (typeof err === "object" && err && typeof err.message === "string" && err.message) ||
      (typeof err === "string" && err) ||
      "unknown API error";
    throw new Error(`Models API ${res.status} ${res.statusText}`.trimEnd() + `: ${msg}`);
  }
  return parseModelsResponse(data);
}
