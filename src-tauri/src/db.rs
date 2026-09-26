use crate::state::Message;
use rusqlite::{params, Connection};
use std::sync::{Mutex, OnceLock};

/// Serialize all DB open+write paths so save_message cannot race upsert/clear.
fn write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Open DB under the process write lock and run `f`.
pub fn with_locked<T>(
    path: &str,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = write_lock()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let conn = open(path)?;
    f(&conn)
}

/// Open (or create) the conversations database at `path`.
pub fn open(path: &str) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| format!("DB open: {}", e))?;

    // Concurrent save_message threads + UI upserts: wait instead of SQLITE_BUSY.
    conn.pragma_update(None, "busy_timeout", 5000i64)
        .map_err(|e| format!("DB busy_timeout: {}", e))?;
    // WAL allows readers during writers (best-effort; log result).
    match conn.pragma_update(None, "journal_mode", "WAL") {
        Ok(()) => {
            let mode: String = conn
                .pragma_query_value(None, "journal_mode", |row| row.get(0))
                .unwrap_or_else(|_| "unknown".into());
            tracing::info!(target: "db", journal_mode = %mode, "sqlite journal_mode");
        }
        Err(e) => {
            tracing::warn!(target: "db", error = %e, "sqlite journal_mode WAL failed");
        }
    }

    conn.execute_batch(
        "
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
        CREATE INDEX IF NOT EXISTS idx_msgs_chat_turn
            ON messages(chat_id, turn, id);

        CREATE TABLE IF NOT EXISTS chat_meta (
            chat_id  TEXT PRIMARY KEY,
            updated_at INTEGER NOT NULL DEFAULT 0,
            config_json TEXT
        );
        ",
    )
    .map_err(|e| format!("DB init: {}", e))?;

    // Identity unique index enables upsert-by-identity; best-effort if legacy dupes exist.
    if let Err(e) = conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_msgs_identity
         ON messages(chat_id, agent, turn, created_at);",
    ) {
        tracing::warn!(target: "db", error = %e, "idx_msgs_identity not created");
    }

    Ok(conn)
}

/// Save one message (upsert-by-identity) so races with snapshot upserts do not dupe rows.
pub fn save_message(conn: &Connection, chat_id: &str, msg: &Message) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM messages WHERE chat_id = ?1 AND agent = ?2 AND turn = ?3 AND created_at = ?4",
        params![chat_id, msg.agent, msg.turn, msg.created_at],
    )
    .map_err(|e| format!("DB save_message clear: {}", e))?;
    tx.execute(
        "INSERT INTO messages (chat_id, agent, role, content, turn, created_at, reasoning)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            chat_id,
            msg.agent,
            msg.role,
            msg.content,
            msg.turn,
            msg.created_at,
            msg.reasoning,
        ],
    )
    .map_err(|e| format!("DB save_message: {}", e))?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Replace all messages for a chat in one transaction (used when switching chats).
/// Clears existing rows first so reloads do not duplicate the transcript.
/// Keep last message per (agent, turn, created_at) so UNIQUE idx_msgs_identity cannot fail
/// on accidental FE duplicate rows in one snapshot.
fn dedupe_messages_by_identity(msgs: &[Message]) -> Vec<Message> {
    let mut out: Vec<Message> = Vec::with_capacity(msgs.len());
    let mut index: std::collections::HashMap<(String, u32, u64), usize> =
        std::collections::HashMap::new();
    for m in msgs {
        let key = (m.agent.clone(), m.turn, m.created_at);
        if let Some(&i) = index.get(&key) {
            out[i] = m.clone();
        } else {
            index.insert(key, out.len());
            out.push(m.clone());
        }
    }
    out
}

pub fn save_messages(
    conn: &Connection,
    chat_id: &str,
    msgs: &[Message],
) -> Result<(), String> {
    let msgs = dedupe_messages_by_identity(msgs);
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM messages WHERE chat_id = ?1", params![chat_id])
        .map_err(|e| format!("DB save_messages clear: {}", e))?;
    for m in &msgs {
        tx.execute(
            "INSERT INTO messages (chat_id, agent, role, content, turn, created_at, reasoning)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![chat_id, m.agent, m.role, m.content, m.turn, m.created_at, m.reasoning],
        )
        .map_err(|e| format!("DB save_messages: {}", e))?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Replace messages only when `scheduled_epoch` is still the current transcript-save
/// generation. Used by load_transcript's detached writer so a stale boot save cannot
/// DELETE+INSERT over a newer SoT hydrate write.
pub fn save_messages_if_epoch(
    conn: &Connection,
    chat_id: &str,
    msgs: &[Message],
    scheduled_epoch: u64,
    current_epoch: u64,
) -> Result<bool, String> {
    if scheduled_epoch != current_epoch {
        return Ok(false);
    }
    save_messages(conn, chat_id, msgs)?;
    Ok(true)
}

/// Load ALL messages for a chat, ordered by insertion.
pub fn load_messages(conn: &Connection, chat_id: &str) -> Result<Vec<Message>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT agent, role, content, turn, created_at, reasoning
             FROM messages
             WHERE chat_id = ?1
             ORDER BY id",
        )
        .map_err(|e| format!("DB load_messages prepare: {}", e))?;

    let msgs = stmt
        .query_map(params![chat_id], |row| {
            Ok(Message {
                agent: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                turn: row.get(3)?,
                created_at: row.get(4)?,
                reasoning: row.get(5)?,
            })
        })
        .map_err(|e| format!("DB load_messages query: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("DB load_messages collect: {}", e))?;

    Ok(msgs)
}

/// Overwrite `snapshot.messages` from the messages table (source of truth).
/// Derive `turn_count` as max(turn)+1 from those rows so:
/// - `save_message` (no config_json rewrite) cannot leave the counter lagging
/// - tip deletes that rewind in-memory turn_count also rehydrate correctly
///   instead of keeping a stale high snapshot counter.
pub fn hydrate_snapshot_messages(
    snapshot: &mut serde_json::Value,
    messages: &[Message],
) -> Result<(), String> {
    snapshot["messages"] =
        serde_json::to_value(messages).map_err(|e| format!("hydrate messages: {e}"))?;
    let derived = messages
        .iter()
        .map(|m| m.turn.saturating_add(1))
        .max()
        .unwrap_or(0);
    snapshot["turn_count"] = serde_json::json!(derived);
    Ok(())
}

/// Parse a chat_meta `config_json` blob and overwrite `.messages` from the table.
/// Returns `None` for empty / whitespace-only JSON (same skip rule as list/get commands).
pub fn hydrate_chat_from_meta(
    conn: &Connection,
    chat_id: &str,
    config_json: &str,
) -> Result<Option<serde_json::Value>, String> {
    if config_json.trim().is_empty() {
        return Ok(None);
    }
    let mut value: serde_json::Value =
        serde_json::from_str(config_json).map_err(|e| e.to_string())?;
    let msgs = load_messages(conn, chat_id)?;
    hydrate_snapshot_messages(&mut value, &msgs)?;
    Ok(Some(value))
}

/// Persist chat metadata only (sidebar title / config). Does **not** touch the
/// messages table — rename and similar edits must use this so a lagging FE
/// snapshot cannot DELETE+INSERT over turns already written by `save_message`.
/// Monotonic on `updated_at` (same rule as `upsert_saved_chat`).
pub fn upsert_chat_meta(
    conn: &Connection,
    chat_id: &str,
    updated_at: u64,
    config_json: &str,
) -> Result<(), String> {
    let existing: Option<u64> = match conn.query_row(
        "SELECT updated_at FROM chat_meta WHERE chat_id = ?1",
        params![chat_id],
        |row| row.get(0),
    ) {
        Ok(v) => Some(v),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(e) => return Err(format!("DB upsert_chat_meta read: {}", e)),
    };
    if let Some(prev) = existing {
        if updated_at < prev {
            return Ok(());
        }
    }
    conn.execute(
        "INSERT OR REPLACE INTO chat_meta (chat_id, updated_at, config_json)
         VALUES (?1, ?2, ?3)",
        params![chat_id, updated_at, config_json],
    )
    .map_err(|e| format!("DB upsert_chat_meta: {}", e))?;
    Ok(())
}

/// List chat metadata rows newest-first. `config_json` is the full saved-chat snapshot.
pub fn list_chat_metas(conn: &Connection) -> Result<Vec<(String, u64, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT chat_id, updated_at, COALESCE(config_json, '')
             FROM chat_meta
             ORDER BY updated_at DESC",
        )
        .map_err(|e| format!("DB list_chat_metas prepare: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)? as u64,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("DB list_chat_metas query: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("DB list_chat_metas collect: {}", e))?;

    Ok(rows)
}

/// List saved-chat snapshots newest-first, each hydrated from the messages table.
/// Messages table is the transcript source of truth (`save_message` / `delete_message`
/// update rows without rewriting config_json).
pub fn list_hydrated_chats(conn: &Connection) -> Result<Vec<serde_json::Value>, String> {
    let metas = list_chat_metas(conn)?;
    let mut out = Vec::with_capacity(metas.len());
    for (id, _updated, json) in metas {
        match hydrate_chat_from_meta(conn, &id, &json) {
            Ok(Some(v)) => out.push(v),
            Ok(None) => continue,
            // Corrupt JSON rows are skipped (historical list_saved_chats behavior).
            Err(e) if !e.starts_with("DB ") && !e.starts_with("hydrate messages:") => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(out)
}

/// Load one chat metadata JSON blob.
pub fn get_chat_meta(conn: &Connection, chat_id: &str) -> Result<Option<(u64, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT updated_at, COALESCE(config_json, '') FROM chat_meta WHERE chat_id = ?1",
        )
        .map_err(|e| format!("DB get_chat_meta prepare: {}", e))?;

    let mut rows = stmt
        .query(params![chat_id])
        .map_err(|e| format!("DB get_chat_meta query: {}", e))?;

    match rows.next().map_err(|e| format!("DB get_chat_meta next: {}", e))? {
        Some(row) => Ok(Some((
            row.get::<_, i64>(0).map_err(|e| e.to_string())? as u64,
            row.get::<_, String>(1).map_err(|e| e.to_string())?,
        ))),
        None => Ok(None),
    }
}

/// Delete a single message identified by chat_id + agent + turn + created_at.
pub fn delete_message(
    conn: &Connection,
    chat_id: &str,
    agent: &str,
    turn: u32,
    created_at: u64,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM messages WHERE chat_id = ?1 AND agent = ?2 AND turn = ?3 AND created_at = ?4",
        params![chat_id, agent, turn, created_at],
    )
    .map_err(|e| format!("DB delete_message: {}", e))?;
    Ok(())
}

/// Delete all messages for a chat and its metadata (single transaction).
pub fn delete_chat(conn: &Connection, chat_id: &str) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM messages WHERE chat_id = ?1", params![chat_id])
        .map_err(|e| format!("DB delete_chat messages: {}", e))?;
    tx.execute("DELETE FROM chat_meta WHERE chat_id = ?1", params![chat_id])
        .map_err(|e| format!("DB delete_chat meta: {}", e))?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Write a full saved-chat snapshot (JSON) and replace its message rows
/// in one transaction (meta + messages stay consistent on failure).
///
/// Monotonic on `updated_at`: a stale FE snapshot (older timestamp) is a no-op
/// so concurrent `void upsertSavedChat` calls cannot wipe newer turns.
pub fn upsert_saved_chat(
    conn: &Connection,
    chat_id: &str,
    updated_at: u64,
    snapshot_json: &str,
    messages: &[Message],
) -> Result<(), String> {
    let messages = dedupe_messages_by_identity(messages);
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let existing: Option<u64> = match tx.query_row(
        "SELECT updated_at FROM chat_meta WHERE chat_id = ?1",
        params![chat_id],
        |row| row.get(0),
    ) {
        Ok(v) => Some(v),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(e) => return Err(format!("DB upsert_saved_chat read: {}", e)),
    };
    if let Some(prev) = existing {
        if updated_at < prev {
            // Leave the newer snapshot intact; do not DELETE messages.
            return Ok(());
        }
    }
    tx.execute(
        "INSERT OR REPLACE INTO chat_meta (chat_id, updated_at, config_json)
         VALUES (?1, ?2, ?3)",
        params![chat_id, updated_at, snapshot_json],
    )
    .map_err(|e| format!("DB upsert_saved_chat meta: {}", e))?;
    tx.execute("DELETE FROM messages WHERE chat_id = ?1", params![chat_id])
        .map_err(|e| format!("DB upsert_saved_chat clear: {}", e))?;
    for m in &messages {
        tx.execute(
            "INSERT INTO messages (chat_id, agent, role, content, turn, created_at, reasoning)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                chat_id,
                m.agent,
                m.role,
                m.content,
                m.turn,
                m.created_at,
                m.reasoning
            ],
        )
        .map_err(|e| format!("DB upsert_saved_chat message: {}", e))?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Message;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_db_path(label: &str) -> String {
        let mut path = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        path.push(format!("ai-convoir-db-test-{label}-{nanos}.db"));
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn open_sets_busy_timeout() {
        let path = tmp_db_path("busy");
        let conn = open(&path).unwrap();
        let v: i64 = conn
            .pragma_query_value(None, "busy_timeout", |row| row.get(0))
            .unwrap();
        assert!(v >= 5000, "busy_timeout={v}");
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn open_enables_wal_journal_mode() {
        let path = tmp_db_path("wal");
        let conn = open(&path).unwrap();
        let mode: String = conn
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn save_message_upserts_by_identity() {
        let path = tmp_db_path("upsert-msg");
        let conn = open(&path).unwrap();
        let msg = Message {
            agent: "ai1".into(),
            role: "assistant".into(),
            content: "v1".into(),
            turn: 1,
            created_at: 42,
            reasoning: None,
        };
        save_message(&conn, "c1", &msg).unwrap();
        let mut msg2 = msg.clone();
        msg2.content = "v2".into();
        save_message(&conn, "c1", &msg2).unwrap();
        let loaded = load_messages(&conn, "c1").unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].content, "v2");
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn with_locked_serializes_writes() {
        let path = tmp_db_path("locked");
        with_locked(&path, |conn| {
            let msg = Message {
                agent: "ai1".into(),
                role: "assistant".into(),
                content: "hi".into(),
                turn: 0,
                created_at: 1,
                reasoning: None,
            };
            save_message(conn, "c1", &msg)
        })
        .unwrap();
        let n = with_locked(&path, |conn| Ok(load_messages(conn, "c1")?.len())).unwrap();
        assert_eq!(n, 1);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn upsert_saved_chat_roundtrip() {
        let path = tmp_db_path("upsert");
        let conn = open(&path).unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let msgs = vec![Message {
            agent: "ai1".into(),
            role: "assistant".into(),
            content: "hi".into(),
            turn: 0,
            created_at: now,
            reasoning: None,
        }];
        upsert_saved_chat(&conn, "c1", now, r#"{"id":"c1"}"#, &msgs).unwrap();
        let loaded = load_messages(&conn, "c1").unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].content, "hi");
        delete_chat(&conn, "c1").unwrap();
        assert!(load_messages(&conn, "c1").unwrap().is_empty());
        assert!(get_chat_meta(&conn, "c1").unwrap().is_none());
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn save_messages_dedupes_identity_keeping_last() {
        let path = tmp_db_path("dedupe");
        let conn = open(&path).unwrap();
        let msgs = vec![
            Message {
                agent: "ai1".into(),
                role: "assistant".into(),
                content: "first".into(),
                turn: 1,
                created_at: 9,
                reasoning: None,
            },
            Message {
                agent: "ai1".into(),
                role: "assistant".into(),
                content: "second".into(),
                turn: 1,
                created_at: 9,
                reasoning: Some("r".into()),
            },
        ];
        save_messages(&conn, "c1", &msgs).unwrap();
        let loaded = load_messages(&conn, "c1").unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].content, "second");
        assert_eq!(loaded[0].reasoning.as_deref(), Some("r"));
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn save_messages_if_epoch_skips_stale_then_applies_current() {
        let path = tmp_db_path("save-epoch");
        let conn = open(&path).unwrap();
        let stale = vec![Message {
            agent: "ai1".into(),
            role: "assistant".into(),
            content: "stale-ls".into(),
            turn: 0,
            created_at: 1,
            reasoning: None,
        }];
        let sot = vec![Message {
            agent: "ai1".into(),
            role: "assistant".into(),
            content: "sot".into(),
            turn: 1,
            created_at: 2,
            reasoning: None,
        }];
        // Stale boot schedule (epoch 1) after hydrate bumped to 2 → skip.
        assert_eq!(
            save_messages_if_epoch(&conn, "c1", &stale, 1, 2).unwrap(),
            false
        );
        assert!(load_messages(&conn, "c1").unwrap().is_empty());
        // Current SoT schedule writes.
        assert_eq!(
            save_messages_if_epoch(&conn, "c1", &sot, 2, 2).unwrap(),
            true
        );
        let loaded = load_messages(&conn, "c1").unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].content, "sot");
        // Later stale attempt still skipped; SoT remains.
        assert_eq!(
            save_messages_if_epoch(&conn, "c1", &stale, 1, 2).unwrap(),
            false
        );
        assert_eq!(load_messages(&conn, "c1").unwrap()[0].content, "sot");
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn upsert_saved_chat_dedupes_identity_keeping_last() {
        let path = tmp_db_path("upsert-dedupe");
        let conn = open(&path).unwrap();
        let msgs = vec![
            Message {
                agent: "ai1".into(),
                role: "assistant".into(),
                content: "old".into(),
                turn: 2,
                created_at: 11,
                reasoning: None,
            },
            Message {
                agent: "ai1".into(),
                role: "assistant".into(),
                content: "new".into(),
                turn: 2,
                created_at: 11,
                reasoning: Some("r2".into()),
            },
            Message {
                agent: "ai2".into(),
                role: "assistant".into(),
                content: "other".into(),
                turn: 2,
                created_at: 12,
                reasoning: None,
            },
        ];
        upsert_saved_chat(&conn, "c1", 99, r#"{"id":"c1"}"#, &msgs).unwrap();
        let loaded = load_messages(&conn, "c1").unwrap();
        assert_eq!(loaded.len(), 2);
        let ai1 = loaded.iter().find(|m| m.agent == "ai1").unwrap();
        assert_eq!(ai1.content, "new");
        assert_eq!(ai1.reasoning.as_deref(), Some("r2"));
        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn upsert_saved_chat_skips_stale_updated_at() {
        let path = tmp_db_path("upsert-stale");
        let conn = open(&path).unwrap();
        let newer = vec![Message {
            agent: "ai1".into(),
            role: "assistant".into(),
            content: "turn-2".into(),
            turn: 2,
            created_at: 200,
            reasoning: None,
        }];
        upsert_saved_chat(&conn, "c1", 200, r#"{"id":"c1","n":2}"#, &newer).unwrap();

        let older = vec![Message {
            agent: "ai1".into(),
            role: "assistant".into(),
            content: "turn-1-stale".into(),
            turn: 1,
            created_at: 100,
            reasoning: None,
        }];
        // Stale FE snapshot must not wipe the newer turn.
        upsert_saved_chat(&conn, "c1", 100, r#"{"id":"c1","n":1}"#, &older).unwrap();

        let loaded = load_messages(&conn, "c1").unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].content, "turn-2");
        let (_u, json) = get_chat_meta(&conn, "c1").unwrap().unwrap();
        assert!(json.contains(r#""n":2"#), "meta json={json}");

        // Equal updated_at still replaces (same-ms last write wins).
        let same_ts = vec![Message {
            agent: "ai1".into(),
            role: "assistant".into(),
            content: "same-ts".into(),
            turn: 2,
            created_at: 200,
            reasoning: None,
        }];
        upsert_saved_chat(&conn, "c1", 200, r#"{"id":"c1","n":2b}"#, &same_ts).unwrap();
        let loaded = load_messages(&conn, "c1").unwrap();
        assert_eq!(loaded[0].content, "same-ts");

        // Newer timestamp still applies.
        let newest = vec![Message {
            agent: "ai1".into(),
            role: "assistant".into(),
            content: "turn-3".into(),
            turn: 3,
            created_at: 300,
            reasoning: None,
        }];
        upsert_saved_chat(&conn, "c1", 300, r#"{"id":"c1","n":3}"#, &newest).unwrap();
        let loaded = load_messages(&conn, "c1").unwrap();
        assert_eq!(loaded[0].content, "turn-3");

        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn hydrate_snapshot_prefers_messages_table() {
        let path = tmp_db_path("hydrate");
        let conn = open(&path).unwrap();
        // Stale snapshot JSON claims only turn-1.
        upsert_saved_chat(
            &conn,
            "c1",
            100,
            r#"{"id":"c1","messages":[{"agent":"ai1","role":"assistant","content":"stale","turn":1,"created_at":1}]}"#,
            &[Message {
                agent: "ai1".into(),
                role: "assistant".into(),
                content: "stale".into(),
                turn: 1,
                created_at: 1,
                reasoning: None,
            }],
        )
        .unwrap();
        // Incremental commit writes a newer turn without rewriting config_json.
        save_message(
            &conn,
            "c1",
            &Message {
                agent: "ai2".into(),
                role: "assistant".into(),
                content: "fresh-turn".into(),
                turn: 2,
                created_at: 2,
                reasoning: None,
            },
        )
        .unwrap();
        // delete_message also diverges snapshot vs table.
        delete_message(&conn, "c1", "ai1", 1, 1).unwrap();

        let (_u, json) = get_chat_meta(&conn, "c1").unwrap().unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&json).unwrap();
        // Stale snapshot still has the deleted message.
        assert_eq!(value["messages"].as_array().unwrap().len(), 1);
        assert_eq!(value["messages"][0]["content"], "stale");

        let msgs = load_messages(&conn, "c1").unwrap();
        hydrate_snapshot_messages(&mut value, &msgs).unwrap();
        let arr = value["messages"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["content"], "fresh-turn");
        assert_eq!(arr[0]["agent"], "ai2");
        // config_json had no turn_count; bump from max(turn)+1 on table rows.
        assert_eq!(value["turn_count"], 3);

        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn hydrate_snapshot_bumps_stale_turn_count() {
        let mut value = serde_json::json!({
            "id": "c1",
            "turn_count": 1,
            "messages": []
        });
        let msgs = vec![
            Message {
                agent: "ai1".into(),
                role: "assistant".into(),
                content: "a".into(),
                turn: 0,
                created_at: 1,
                reasoning: None,
            },
            Message {
                agent: "ai2".into(),
                role: "assistant".into(),
                content: "b".into(),
                turn: 1,
                created_at: 2,
                reasoning: None,
            },
        ];
        hydrate_snapshot_messages(&mut value, &msgs).unwrap();
        assert_eq!(value["turn_count"], 2);
        // After tip delete, snapshot counter may still be high — messages table wins.
        value["turn_count"] = serde_json::json!(9);
        hydrate_snapshot_messages(&mut value, &msgs).unwrap();
        assert_eq!(value["turn_count"], 2);
        // Empty transcript → turn_count 0.
        hydrate_snapshot_messages(&mut value, &[]).unwrap();
        assert_eq!(value["turn_count"], 0);
        assert_eq!(value["messages"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn list_hydrated_chats_prefers_messages_table() {
        let path = tmp_db_path("list-hydrate");
        let conn = open(&path).unwrap();
        // Snapshot JSON is stale (claims only turn-1 "stale").
        upsert_saved_chat(
            &conn,
            "c1",
            100,
            r#"{"id":"c1","updated_at":100,"messages":[{"agent":"ai1","role":"assistant","content":"stale","turn":1,"created_at":1}]}"#,
            &[Message {
                agent: "ai1".into(),
                role: "assistant".into(),
                content: "stale".into(),
                turn: 1,
                created_at: 1,
                reasoning: None,
            }],
        )
        .unwrap();
        save_message(
            &conn,
            "c1",
            &Message {
                agent: "ai2".into(),
                role: "assistant".into(),
                content: "fresh-turn".into(),
                turn: 2,
                created_at: 2,
                reasoning: None,
            },
        )
        .unwrap();
        delete_message(&conn, "c1", "ai1", 1, 1).unwrap();

        // Raw meta still has stale messages.
        let (_u, raw) = get_chat_meta(&conn, "c1").unwrap().unwrap();
        let raw_v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(raw_v["messages"][0]["content"], "stale");

        // List path (what FE boot/select uses) must hydrate.
        let listed = list_hydrated_chats(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        let arr = listed[0]["messages"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["content"], "fresh-turn");
        assert_eq!(arr[0]["agent"], "ai2");

        // get path shares the same helper.
        let one = hydrate_chat_from_meta(&conn, "c1", &raw).unwrap().unwrap();
        assert_eq!(one["messages"][0]["content"], "fresh-turn");

        drop(conn);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn upsert_chat_meta_preserves_messages_table() {
        let path = tmp_db_path("meta-only");
        let conn = open(&path).unwrap();
        let msgs = vec![
            Message {
                agent: "ai1".into(),
                role: "assistant".into(),
                content: "keep-me".into(),
                turn: 0,
                created_at: 1,
                reasoning: None,
            },
            Message {
                agent: "ai2".into(),
                role: "assistant".into(),
                content: "also-keep".into(),
                turn: 1,
                created_at: 2,
                reasoning: None,
            },
        ];
        upsert_saved_chat(
            &conn,
            "c1",
            100,
            r#"{"id":"c1","title":"Old","messages":[]}"#,
            &msgs,
        )
        .unwrap();

        // Rename-style meta write with empty/stale messages in JSON must not wipe SoT.
        upsert_chat_meta(
            &conn,
            "c1",
            200,
            r#"{"id":"c1","title":"Renamed","updated_at":200,"messages":[]}"#,
        )
        .unwrap();

        let loaded = load_messages(&conn, "c1").unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].content, "keep-me");
        assert_eq!(loaded[1].content, "also-keep");
        let (u, json) = get_chat_meta(&conn, "c1").unwrap().unwrap();
        assert_eq!(u, 200);
        assert!(json.contains("Renamed"), "json={json}");

        // Stale meta timestamp is a no-op.
        upsert_chat_meta(
            &conn,
            "c1",
            150,
            r#"{"id":"c1","title":"Stale","updated_at":150}"#,
        )
        .unwrap();
        let (u, json) = get_chat_meta(&conn, "c1").unwrap().unwrap();
        assert_eq!(u, 200);
        assert!(json.contains("Renamed"), "json={json}");

        drop(conn);
        let _ = std::fs::remove_file(&path);
    }
}
