import { DatabaseSync } from "node:sqlite";
import type { Message } from "./state.js";
import { logger } from "./logging.js";

type Json = Record<string, unknown>;

let conn: DatabaseSync | null = null;
let connPath = "";

/**
 * One process-wide connection. node:sqlite is synchronous on the main thread,
 * so writes are serialized for free — no explicit write lock needed.
 */
export function open(path: string): DatabaseSync {
  if (conn && connPath === path) return conn;
  conn?.close();
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000");
  try {
    const row = db.prepare("PRAGMA journal_mode = WAL").get() as { journal_mode?: string } | undefined;
    logger.info("db", `sqlite journal_mode=${row?.journal_mode ?? "unknown"}`);
  } catch (e) {
    logger.warn("db", `sqlite journal_mode WAL failed: ${e}`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT    NOT NULL,
      agent   TEXT    NOT NULL,
      role    TEXT    NOT NULL,
      content TEXT    NOT NULL,
      turn    INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      reasoning TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_msgs_chat_turn ON messages(chat_id, turn, id);
    CREATE TABLE IF NOT EXISTS chat_meta (
      chat_id  TEXT PRIMARY KEY,
      updated_at INTEGER NOT NULL DEFAULT 0,
      config_json TEXT
    );
  `);
  try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_msgs_identity ON messages(chat_id, agent, turn, created_at)");
  } catch (e) {
    logger.warn("db", `idx_msgs_identity not created: ${e}`);
  }
  conn = db;
  connPath = path;
  return db;
}

export function close() {
  conn?.close();
  conn = null;
  connPath = "";
}

function tx<T>(db: DatabaseSync, f: () => T): T {
  db.exec("BEGIN");
  try {
    const out = f();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function insertMessage(db: DatabaseSync, chatId: string, m: Message) {
  db.prepare(
    `INSERT INTO messages (chat_id, agent, role, content, turn, created_at, reasoning)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(chatId, m.agent, m.role, m.content, m.turn, m.created_at, m.reasoning ?? null);
}

function metaExists(db: DatabaseSync, chatId: string): boolean {
  return !!db.prepare("SELECT 1 FROM chat_meta WHERE chat_id = ?").get(chatId);
}

function metaUpdatedAt(db: DatabaseSync, chatId: string): number | null {
  const row = db.prepare("SELECT updated_at FROM chat_meta WHERE chat_id = ?").get(chatId) as
    | { updated_at: number }
    | undefined;
  return row ? Number(row.updated_at) : null;
}

/**
 * Save one message (upsert-by-identity). No-ops when chat_meta is missing so a
 * late commit after delete_saved_chat cannot resurrect orphan rows.
 */
export function saveMessage(db: DatabaseSync, chatId: string, msg: Message) {
  if (!metaExists(db, chatId)) return;
  tx(db, () => {
    db.prepare("DELETE FROM messages WHERE chat_id = ? AND agent = ? AND turn = ? AND created_at = ?").run(
      chatId,
      msg.agent,
      msg.turn,
      msg.created_at,
    );
    insertMessage(db, chatId, msg);
  });
}

/** Keep the last message per (agent, turn, created_at) so the unique index can't fail. */
export function dedupeMessagesByIdentity(msgs: Message[]): Message[] {
  const out: Message[] = [];
  const index = new Map<string, number>();
  for (const m of msgs) {
    const key = `${m.agent}\0${m.turn}\0${m.created_at}`;
    const i = index.get(key);
    if (i !== undefined) out[i] = m;
    else {
      index.set(key, out.length);
      out.push(m);
    }
  }
  return out;
}

export function saveMessages(db: DatabaseSync, chatId: string, msgs: Message[]) {
  const rows = dedupeMessagesByIdentity(msgs);
  tx(db, () => {
    db.prepare("DELETE FROM messages WHERE chat_id = ?").run(chatId);
    for (const m of rows) insertMessage(db, chatId, m);
  });
}

/** Replace messages only while `scheduled` is still the current save generation. */
export function saveMessagesIfEpoch(
  db: DatabaseSync,
  chatId: string,
  msgs: Message[],
  scheduled: number,
  current: number,
): boolean {
  if (scheduled !== current) return false;
  saveMessages(db, chatId, msgs);
  return true;
}

export function loadMessages(db: DatabaseSync, chatId: string): Message[] {
  const rows = db
    .prepare(
      "SELECT agent, role, content, turn, created_at, reasoning FROM messages WHERE chat_id = ? ORDER BY id",
    )
    .all(chatId) as unknown as Message[];
  return rows.map((r) => {
    const m: Message = {
      agent: r.agent,
      role: r.role,
      content: r.content,
      turn: Number(r.turn),
      created_at: Number(r.created_at),
    };
    if (r.reasoning != null) m.reasoning = r.reasoning;
    return m;
  });
}

/** Overwrite snapshot.messages from the table (SoT); derive turn_count = max(turn)+1. */
export function hydrateSnapshotMessages(snapshot: Json, messages: Message[]) {
  snapshot.messages = messages;
  snapshot.turn_count = messages.reduce((n, m) => Math.max(n, m.turn + 1), 0);
}

export function hydrateChatFromMeta(db: DatabaseSync, chatId: string, configJson: string): Json | null {
  if (!configJson.trim()) return null;
  const value = JSON.parse(configJson) as Json;
  hydrateSnapshotMessages(value, loadMessages(db, chatId));
  return value;
}

/** Meta-only persist (never touches messages). Monotonic on updated_at. */
export function upsertChatMeta(db: DatabaseSync, chatId: string, updatedAt: number, configJson: string) {
  const prev = metaUpdatedAt(db, chatId);
  if (prev !== null && updatedAt < prev) return;
  db.prepare("INSERT OR REPLACE INTO chat_meta (chat_id, updated_at, config_json) VALUES (?, ?, ?)").run(
    chatId,
    updatedAt,
    configJson,
  );
}

export function listHydratedChats(db: DatabaseSync): Json[] {
  const metas = db
    .prepare("SELECT chat_id, updated_at, COALESCE(config_json, '') AS config_json FROM chat_meta ORDER BY updated_at DESC")
    .all() as { chat_id: string; config_json: string }[];
  const out: Json[] = [];
  for (const { chat_id, config_json } of metas) {
    let v: Json | null;
    try {
      v = hydrateChatFromMeta(db, chat_id, config_json);
    } catch (e) {
      // Corrupt JSON rows are skipped; real DB failures still surface.
      if (e instanceof SyntaxError) continue;
      throw e;
    }
    if (v) out.push(v);
  }
  return out;
}

export function getChatMeta(db: DatabaseSync, chatId: string): string | null {
  const row = db.prepare("SELECT COALESCE(config_json, '') AS config_json FROM chat_meta WHERE chat_id = ?").get(
    chatId,
  ) as { config_json: string } | undefined;
  return row ? row.config_json : null;
}

export function deleteMessage(db: DatabaseSync, chatId: string, agent: string, turn: number, createdAt: number) {
  db.prepare("DELETE FROM messages WHERE chat_id = ? AND agent = ? AND turn = ? AND created_at = ?").run(
    chatId,
    agent,
    turn,
    createdAt,
  );
}

export function deleteChat(db: DatabaseSync, chatId: string) {
  tx(db, () => {
    db.prepare("DELETE FROM messages WHERE chat_id = ?").run(chatId);
    db.prepare("DELETE FROM chat_meta WHERE chat_id = ?").run(chatId);
  });
}

/** Full snapshot + message rows in one transaction. Stale (older) snapshots are no-ops. */
export function upsertSavedChat(
  db: DatabaseSync,
  chatId: string,
  updatedAt: number,
  snapshotJson: string,
  messages: Message[],
) {
  const rows = dedupeMessagesByIdentity(messages);
  tx(db, () => {
    const prev = metaUpdatedAt(db, chatId);
    if (prev !== null && updatedAt < prev) return;
    db.prepare("INSERT OR REPLACE INTO chat_meta (chat_id, updated_at, config_json) VALUES (?, ?, ?)").run(
      chatId,
      updatedAt,
      snapshotJson,
    );
    db.prepare("DELETE FROM messages WHERE chat_id = ?").run(chatId);
    for (const m of rows) insertMessage(db, chatId, m);
  });
}
