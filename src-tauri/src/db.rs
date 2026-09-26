use crate::state::Message;
use rusqlite::{params, Connection};

/// Open (or create) the conversations database at `path`.
pub fn open(path: &str) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| format!("DB open: {}", e))?;

    // Concurrent save_message threads + UI upserts: wait instead of SQLITE_BUSY.
    conn.pragma_update(None, "busy_timeout", 5000i64)
        .map_err(|e| format!("DB busy_timeout: {}", e))?;
    // WAL allows readers during writers (best-effort; ignore if unsupported).
    let _ = conn.pragma_update(None, "journal_mode", "WAL");

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

    Ok(conn)
}

/// Save one message to the database.
pub fn save_message(conn: &Connection, chat_id: &str, msg: &Message) -> Result<(), String> {
    conn.execute(
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
    Ok(())
}

/// Replace all messages for a chat in one transaction (used when switching chats).
/// Clears existing rows first so reloads do not duplicate the transcript.
pub fn save_messages(
    conn: &Connection,
    chat_id: &str,
    msgs: &[Message],
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM messages WHERE chat_id = ?1", params![chat_id])
        .map_err(|e| format!("DB save_messages clear: {}", e))?;
    for m in msgs {
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

/// Persist chat metadata (keeps the chat alive in the sidebar even after restart).
#[allow(dead_code)] // available for meta-only updates; full snapshots use upsert_saved_chat
pub fn upsert_chat_meta(
    conn: &Connection,
    chat_id: &str,
    updated_at: u64,
    config_json: &str,
) -> Result<(), String> {
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
pub fn upsert_saved_chat(
    conn: &Connection,
    chat_id: &str,
    updated_at: u64,
    snapshot_json: &str,
    messages: &[Message],
) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR REPLACE INTO chat_meta (chat_id, updated_at, config_json)
         VALUES (?1, ?2, ?3)",
        params![chat_id, updated_at, snapshot_json],
    )
    .map_err(|e| format!("DB upsert_saved_chat meta: {}", e))?;
    tx.execute("DELETE FROM messages WHERE chat_id = ?1", params![chat_id])
        .map_err(|e| format!("DB upsert_saved_chat clear: {}", e))?;
    for m in messages {
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
}
