import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as db from "./db.js";
import { prepareStep, startActionWithTranscript } from "./engine.js";
import {
  applyUsageToMetrics,
  logTurnMetrics,
  prepareTurn,
  TurnMachine,
  type PreparedTurn,
  type TurnMetrics,
} from "./harness.js";
import { fetchModels, STREAM_ABORTED, StreamCancel, streamPrepared, type Emit, type StreamOutcome } from "./llm.js";
import { logger, logPath, writeFrontend } from "./logging.js";
import * as oauth from "./oauth.js";
import * as secrets from "./secrets.js";
import { AppState, normalizeAgent, type AiConfig, type AppStatus, type ConversationMode, type InnerState, type Message } from "./state.js";

type Json = Record<string, unknown>;
type Args = Json;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function injectSeedIfAny(inner: InnerState) {
  const seed = inner.seed_prompt.trim();
  if (!seed || inner.messages.some((m) => m.agent === "seed")) return;
  inner.messages.push({ agent: "seed", role: "user", content: seed, turn: 0, created_at: Date.now() });
}

/** Desktop if present, else home. */
export function exportDir(): string {
  const home = os.homedir() || process.cwd();
  const desktop = path.join(home, "Desktop");
  try {
    if (fs.statSync(desktop).isDirectory()) return desktop;
  } catch {
    /* no Desktop */
  }
  return home;
}

/** Drop lagging transcript fields from a meta-only snapshot (hydrate is SoT). */
export function stripMessagesFromMetaSnapshot(snapshot: Json) {
  delete snapshot.messages;
  delete snapshot.turn_count;
}

function str(v: unknown, name: string): string {
  if (typeof v !== "string") throw new Error(`${name} must be a string`);
  return v;
}

function int(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`${name} must be a non-negative number`);
  return Math.floor(v);
}

function messageList(v: unknown): Message[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((m): m is Json => !!m && typeof m === "object")
    .map((m) => {
      const out: Message = {
        agent: String(m.agent ?? ""),
        role: String(m.role ?? ""),
        content: String(m.content ?? ""),
        turn: Math.max(0, Math.floor(Number(m.turn) || 0)),
        created_at: Math.max(0, Math.floor(Number(m.created_at) || 0)),
      };
      if (typeof m.reasoning === "string") out.reasoning = m.reasoning;
      return out;
    });
}

export class Commands {
  constructor(
    readonly state: AppState,
    private emit: Emit,
  ) {}

  private withDb<T>(f: (conn: ReturnType<typeof db.open>) => T): T {
    if (!this.state.dbPath) throw new Error("Database not ready");
    return f(db.open(this.state.dbPath));
  }

  private status(status: string, turn: number) {
    this.emit("status-update", { status, turn });
  }

  private abortAll() {
    this.emit("stream-abort", { agent: "", turn: 0 });
  }

  /** IPC entry point. Errors become rejected promises with a string message. */
  async invoke(cmd: string, a: Args): Promise<unknown> {
    switch (cmd) {
      case "get_presets":
        return [
          { id: "opencode_zen", name: "OpenCode Zen", base_url: "https://opencode.ai/zen/v1" },
          { id: "opencode_go", name: "OpenCode Go", base_url: "https://opencode.ai/zen/go/v1" },
          { id: "openai", name: "OpenAI", base_url: "https://api.openai.com/v1" },
        ];
      case "fetch_models": {
        const base = str(a.baseUrl, "baseUrl");
        if (!base.trim()) throw new Error("Base URL is required");
        return fetchModels(base, typeof a.apiKey === "string" ? a.apiKey : "");
      }
      case "start_conversation":
        return this.start();
      case "step_conversation":
        return this.step();
      case "pause_conversation":
        return this.pause();
      case "stop_conversation":
        return this.stop();
      case "reset_conversation":
        return this.reset();
      case "load_transcript":
        return this.loadTranscript(messageList(a.messages), int(a.turnCount ?? 0, "turnCount"), str(a.chatId ?? "", "chatId"));
      case "get_messages":
        return structuredClone(this.state.inner.messages);
      case "get_status":
        return [this.state.inner.status, this.state.inner.turn_count];
      case "get_config":
        return structuredClone(this.state.inner);
      case "update_config":
        return this.updateConfig(a);
      case "export_chat": {
        const file = path.join(exportDir(), `AI-ConvoIR-${Math.floor(Date.now() / 1000)}.md`);
        try {
          fs.writeFileSync(file, str(a.content, "content"));
        } catch (e) {
          throw new Error(`Failed to save file: ${(e as Error).message}`);
        }
        return file;
      }
      case "set_active_chat":
        this.state.inner.active_chat_id = str(a.chatId, "chatId");
        return null;
      case "set_narration":
        this.state.inner.pending_narration = str(a.text, "text");
        return null;
      case "get_narration":
        return this.state.inner.pending_narration;
      case "upsert_saved_chat":
        return this.upsertSavedChat(a.snapshot);
      case "upsert_saved_chat_meta":
        return this.upsertSavedChatMeta(a.snapshot);
      case "list_saved_chats":
        return this.withDb((c) => db.listHydratedChats(c));
      case "get_saved_chat": {
        const chatId = str(a.chatId, "chatId");
        return this.withDb((c) => {
          const json = db.getChatMeta(c, chatId);
          return json === null ? null : db.hydrateChatFromMeta(c, chatId, json);
        });
      }
      case "delete_saved_chat":
        return this.deleteSavedChat(str(a.chatId, "chatId"));
      case "delete_messages":
        return this.deleteMessage(str(a.agent, "agent"), int(a.turn, "turn"), int(a.createdAt, "createdAt"));
      case "frontend_log":
        writeFrontend(String(a.level ?? "info"), String(a.message ?? ""), typeof a.source === "string" ? a.source : null);
        return null;
      case "get_log_path":
        return logPath();
      case "secret_get":
      case "secret_set":
      case "secret_delete": {
        const acc = str(a.account, "account");
        if (!secrets.validAccount(acc)) throw new Error("invalid account");
        if (cmd === "secret_get") return secrets.get(acc);
        const value = cmd === "secret_set" ? str(a.value, "value").trim() : "";
        if (value) secrets.set(acc, value);
        else secrets.remove(acc);
        return null;
      }
      case "oauth_begin":
        return oauth.oauthBegin(str(a.provider, "provider"));
      case "oauth_wait":
        return oauth.oauthWait(str(a.provider, "provider"));
      case "oauth_cancel":
        oauth.oauthCancel(str(a.provider, "provider"));
        return null;
      case "oauth_status":
        return oauth.oauthStatus(str(a.provider, "provider"));
      case "oauth_logout":
        oauth.oauthLogout(str(a.provider, "provider"));
        return null;
      default:
        throw new Error(`unknown command: ${cmd}`);
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────

  start() {
    const s = this.state;
    const inner = s.inner;
    const action = startActionWithTranscript(inner.status, inner.mode, inner.messages.length);
    if (action === "RejectAlreadyRunning") throw new Error("Conversation is already running");
    if (action === "RejectStepPaused") {
      throw new Error("Step mode — press Next to advance one turn, or switch to Auto and Start");
    }
    if (action === "ResumeAuto" || action === "ContinueIdle") {
      s.clearResetIfIdle();
      s.pauseFlag = false;
      s.stepOnce = false;
      inner.status = "Running";
      this.status("Running", inner.turn_count);
      this.spawnLoopIfNeeded();
      return null;
    }
    // Fresh start — bump epoch so a lingering in-flight stream cannot commit
    // or restore its narration into this new run.
    s.bumpStreamEpoch();
    s.pauseFlag = false;
    s.clearResetIfIdle();
    s.stepOnce = false;
    inner.messages = [];
    inner.turn_count = 0;
    inner.pending_narration = "";
    if (inner.mode === "step") {
      inner.status = "Paused";
      s.pauseFlag = true;
    } else {
      inner.status = "Running";
    }
    injectSeedIfAny(inner);
    this.status(inner.status, inner.turn_count);
    this.abortAll();
    this.spawnLoopIfNeeded();
    logger.info("commands", "start_conversation");
    return null;
  }

  step() {
    const s = this.state;
    const inner = s.inner;
    if (inner.status === "Idle" && !inner.messages.length) {
      inner.turn_count = 0;
      injectSeedIfAny(inner);
    }
    prepareStep(inner.mode, inner.turn_count, inner.max_turns);
    inner.status = "Running";
    s.clearResetIfIdle();
    s.stepOnce = true;
    s.pauseFlag = false;
    logger.info("commands", "step_conversation");
    this.status("Running", inner.turn_count);
    this.spawnLoopIfNeeded();
    return null;
  }

  pause() {
    const s = this.state;
    s.pauseFlag = true;
    s.stepOnce = false;
    s.inner.status = "Paused";
    this.status("Paused", s.inner.turn_count);
    return null;
  }

  reset() {
    const s = this.state;
    s.bumpStreamEpoch();
    s.setReset();
    s.pauseFlag = true;
    s.stepOnce = false;
    const inner = s.inner;
    inner.messages = [];
    inner.turn_count = 0;
    inner.pending_narration = "";
    // New blank session — never keep a deleted/stale chat id for save_message.
    inner.active_chat_id = "";
    inner.status = "Idle";
    this.status("Idle", 0);
    this.abortAll();
    return null;
  }

  /** Hard stop: end the run, keep transcript. */
  stop() {
    const s = this.state;
    const epoch = s.bumpStreamEpoch();
    logger.info("commands", `stop_conversation epoch=${epoch}`);
    s.pauseFlag = true;
    s.stepOnce = false;
    s.inner.pending_narration = "";
    s.inner.status = "Idle";
    this.status("Idle", s.inner.turn_count);
    this.abortAll();
    return null;
  }

  loadTranscript(messages: Message[], turnCount: number, chatId: string) {
    const s = this.state;
    s.bumpStreamEpoch();
    s.setReset();
    s.pauseFlag = true;
    s.stepOnce = false;
    // Persist loaded messages; a save epoch keeps a stale boot load from
    // overwriting a newer SoT hydrate write.
    if (chatId && s.dbPath) {
      const msgs = structuredClone(messages);
      const saveEpoch = s.bumpTranscriptSaveEpoch(chatId);
      setImmediate(() => {
        try {
          this.withDb((c) => db.saveMessagesIfEpoch(c, chatId, msgs, saveEpoch, s.currentTranscriptSaveEpoch(chatId)));
        } catch (e) {
          logger.warn("db", `load_transcript save failed: ${e}`);
        }
      });
    }
    const inner = s.inner;
    inner.messages = messages;
    inner.turn_count = turnCount;
    inner.status = "Idle";
    inner.pending_narration = "";
    inner.active_chat_id = chatId;
    this.status("Idle", turnCount);
    this.abortAll();
    s.clearResetIfIdle();
    return null;
  }

  updateConfig(a: Args) {
    const inner = this.state.inner;
    inner.ai1_config = normalizeAgent(a.ai1Config as Partial<AiConfig>);
    inner.ai2_config = normalizeAgent(a.ai2Config as Partial<AiConfig>);
    if (a.ai3Config) inner.ai3_config = normalizeAgent(a.ai3Config as Partial<AiConfig>);
    if (typeof a.botCount === "number") inner.bot_count = a.botCount >= 3 ? 3 : 2;
    inner.max_turns = Math.max(1, int(a.maxTurns, "maxTurns"));
    inner.delay_ms = int(a.delayMs, "delayMs");
    if (a.mode === "auto" || a.mode === "step") inner.mode = a.mode as ConversationMode;
    if (typeof a.seedPrompt === "string") inner.seed_prompt = a.seedPrompt;
    return null;
  }

  // ── persistence ───────────────────────────────────────────────────

  private snapshotOf(v: unknown): [Json, string, number] {
    if (!v || typeof v !== "object") throw new Error("snapshot.id required");
    const snap = v as Json;
    if (typeof snap.id !== "string") throw new Error("snapshot.id required");
    const updated = typeof snap.updated_at === "number" && snap.updated_at >= 0 ? Math.floor(snap.updated_at) : Date.now();
    return [snap, snap.id, updated];
  }

  upsertSavedChat(v: unknown) {
    const [snap, chatId, updated] = this.snapshotOf(v);
    const messages = messageList(snap.messages);
    this.withDb((c) => db.upsertSavedChat(c, chatId, updated, JSON.stringify(snap), messages));
    return null;
  }

  upsertSavedChatMeta(v: unknown) {
    const [snap, chatId, updated] = this.snapshotOf(v);
    const copy = { ...snap };
    stripMessagesFromMetaSnapshot(copy);
    this.withDb((c) => db.upsertChatMeta(c, chatId, updated, JSON.stringify(copy)));
    return null;
  }

  deleteSavedChat(chatId: string) {
    // Prune first so an in-flight load_transcript save sees current=0 and skips.
    this.state.clearTranscriptSaveEpoch(chatId);
    this.withDb((c) => db.deleteChat(c, chatId));
    if (this.state.inner.active_chat_id === chatId) this.state.inner.active_chat_id = "";
    return null;
  }

  /** Remove one message (memory + DB); a tip delete rewinds turn_count. */
  deleteMessage(agent: string, turn: number, createdAt: number) {
    const inner = this.state.inner;
    const before = inner.messages.length;
    inner.messages = inner.messages.filter((m) => !(m.agent === agent && m.turn === turn && m.created_at === createdAt));
    const removed = before !== inner.messages.length;
    if (removed) {
      const derived = inner.messages.reduce((n, m) => Math.max(n, m.turn + 1), 0);
      if (derived < inner.turn_count) inner.turn_count = derived;
    }
    const chatId = inner.active_chat_id;
    if (chatId) {
      try {
        this.withDb((c) => db.deleteMessage(c, chatId, agent, turn, createdAt));
      } catch (e) {
        logger.warn("db", `delete_message failed: ${e}`);
      }
    }
    this.emit("message-deleted", { agent, turn, created_at: createdAt });
    if (removed) this.status(inner.status, inner.turn_count);
    return removed;
  }

  // ── loop ──────────────────────────────────────────────────────────

  private spawnLoopIfNeeded() {
    if (this.state.loopActive) return;
    this.state.loopActive = true;
    void this.runConversationLoop()
      .catch((e) => logger.error("commands", `conversation loop crashed: ${e}`))
      .finally(() => {
        this.state.loopActive = false;
      });
  }

  /** Put a consumed one-shot narration back only while the same run is live. */
  restoreNarration(narration: string | null, epochAtStart: number) {
    const s = this.state;
    if (!narration) return;
    if (s.streamEpoch !== epochAtStart || s.resetFlag) return;
    if (s.inner.status === "Idle") return;
    if (!s.inner.pending_narration) s.inner.pending_narration = narration;
  }

  private metricsFor(p: PreparedTurn): TurnMetrics {
    return {
      agent: p.agent,
      turn: p.turn,
      prompt_est_tokens: p.promptEstTokens,
      trimmed: p.trimmed,
      cache_key: p.cacheKey,
      ttft_ms: null,
      stream_duration_ms: null,
      content_chars: 0,
      reasoning_chars: 0,
      prompt_tokens: null,
      cached_tokens: null,
      completion_tokens: null,
      phase_end: "",
    };
  }

  private finishMetrics(m: TurnMetrics, phase: string, outcome?: StreamOutcome) {
    m.phase_end = phase;
    if (outcome) {
      m.ttft_ms = outcome.ttftMs;
      m.stream_duration_ms = outcome.streamDurationMs;
      m.content_chars = [...outcome.content].length;
      m.reasoning_chars = outcome.reasoning ? [...outcome.reasoning].length : 0;
      applyUsageToMetrics(m, outcome.usage);
    }
    logTurnMetrics(m);
    this.emit("harness-metrics", m);
  }

  /** Returns false when the loop should stop entirely. */
  async runOneTurn(): Promise<boolean> {
    const s = this.state;
    if (s.resetFlag) return false;
    const machine = new TurnMachine();
    machine.beginPrepare();

    const epochAtStart = s.streamEpoch;
    const createdAt = Date.now();
    const inner = s.inner;
    const n = inner.pending_narration.trim();
    const narration = n || null;
    if (narration) inner.pending_narration = "";

    let prepared: PreparedTurn;
    try {
      prepared = prepareTurn(inner, narration, createdAt, true);
    } catch (e) {
      // Prepare rejected (e.g. max turns) — put the one-shot note back.
      if (narration && !inner.pending_narration) inner.pending_narration = narration;
      logger.info("harness", `prepare stopped: ${(e as Error).message}`);
      machine.stop();
      return false;
    }

    const metrics = this.metricsFor(prepared);
    const cancel = new StreamCancel(s, epochAtStart);
    const abortTurn = () => this.emit("stream-abort", { agent: prepared.agent, turn: prepared.turn });

    if (cancel.isCancelled()) {
      machine.stop();
      this.restoreNarration(prepared.narration, epochAtStart);
      this.finishMetrics(metrics, "Stopped");
      return false;
    }
    machine.beginStream();

    let outcome: StreamOutcome;
    try {
      outcome = await streamPrepared(prepared, this.emit, cancel);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === STREAM_ABORTED) {
        machine.abortStream();
        this.restoreNarration(prepared.narration, epochAtStart);
        this.finishMetrics(metrics, "Stopped");
        logger.info("commands", `stream aborted agent=${prepared.agent} turn=${prepared.turn}`);
        abortTurn();
        return false;
      }
      machine.fail();
      // Keep narration on API failure so the user can retry the same note.
      this.restoreNarration(prepared.narration, epochAtStart);
      this.finishMetrics(metrics, "Error");
      logger.error("commands", `stream error agent=${prepared.agent} turn=${prepared.turn}: ${msg}`);
      abortTurn();
      this.emit("error", `${prepared.agent} error: ${msg}`);
      s.inner.status = "Paused";
      s.pauseFlag = true;
      this.status("Paused", prepared.turn);
      return true;
    }

    if (cancel.isCancelled()) {
      machine.abortStream();
      this.restoreNarration(prepared.narration, epochAtStart);
      this.finishMetrics(metrics, "Stopped", outcome);
      abortTurn();
      return false;
    }

    machine.beginCommit();
    const msg: Message = {
      agent: prepared.agent,
      role: "assistant",
      content: outcome.content,
      turn: prepared.turn,
      created_at: prepared.createdAt,
    };
    if (outcome.reasoning) msg.reasoning = outcome.reasoning;

    if (prepared.chatId && s.dbPath) {
      const chatId = prepared.chatId;
      setImmediate(() => {
        try {
          this.withDb((c) => db.saveMessage(c, chatId, msg));
        } catch (e) {
          logger.warn("db", `save_message failed: ${e}`);
        }
      });
    }
    s.inner.messages.push(msg);
    s.inner.turn_count += 1;
    this.emit("new-message", msg);
    this.emit("stream-done", { agent: msg.agent, turn: msg.turn });
    this.status(s.inner.status, s.inner.turn_count);
    this.emit("narration-cleared", true);
    machine.toNext();
    this.finishMetrics(metrics, machine.phase, outcome);
    return true;
  }

  async runConversationLoop() {
    const s = this.state;
    for (const m of s.inner.messages) if (m.agent === "seed") this.emit("new-message", m);

    while (true) {
      if (s.resetFlag) {
        s.resetFlag = false;
        break;
      }
      // Wait while paused, unless step_once is set.
      if (s.pauseFlag && !s.stepOnce) {
        await sleep(50);
        if (s.inner.status === "Idle") break;
        continue;
      }
      // Max turns is Auto-only — Step can keep going.
      if (s.inner.mode !== "step" && s.inner.turn_count >= s.inner.max_turns) break;
      if (s.inner.status === "Idle") break;

      const stepMode = s.inner.mode === "step" || s.stepOnce;
      if (!(await this.runOneTurn())) break;

      if (stepMode || s.stepOnce) {
        s.stepOnce = false;
        s.pauseFlag = true;
        // runOneTurn may have flipped status (stop → Idle) while awaiting.
        if ((s.inner.status as AppStatus) !== "Idle") {
          s.inner.status = "Paused";
          this.status("Paused", s.inner.turn_count);
        }
        if (s.inner.mode !== "step" && s.inner.turn_count >= s.inner.max_turns) break;
        continue;
      }

      // Interruptible auto delay.
      const steps = Math.max(1, Math.floor(s.inner.delay_ms / 50));
      if (s.inner.delay_ms > 0) {
        for (let i = 0; i < steps; i++) {
          if (s.pauseFlag || s.resetFlag) break;
          await sleep(50);
        }
      }
    }

    const inner = s.inner;
    if (inner.status !== "Paused") inner.status = "Idle";
    if (inner.mode !== "step" && inner.turn_count >= inner.max_turns) inner.status = "Idle";
    this.status(inner.status, inner.turn_count);
  }
}
