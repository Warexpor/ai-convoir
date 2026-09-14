use crate::db;
use crate::engine::{
    next_speaker, prepare_step, start_action_with_transcript, trim_messages_for_context,
    StartAction, OPENCODE_GO_BASE, OPENCODE_ZEN_BASE,
};
use crate::llm;
use crate::state::{AiConfig, AppState, AppStatus, ConversationMode, InnerState, Message};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub fn get_presets() -> serde_json::Value {
    serde_json::json!([
        {
            "id": "opencode_zen",
            "name": "OpenCode Zen",
            "base_url": OPENCODE_ZEN_BASE,
        },
        {
            "id": "opencode_go",
            "name": "OpenCode Go",
            "base_url": OPENCODE_GO_BASE,
        },
        {
            "id": "openai",
            "name": "OpenAI",
            "base_url": "https://api.openai.com/v1",
        },
    ])
}

#[tauri::command]
pub async fn fetch_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    if base_url.trim().is_empty() {
        return Err("Base URL is required".into());
    }
    llm::fetch_models(&base_url, &api_key).await
}

#[tauri::command]
pub async fn start_conversation(
    state: tauri::State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let arc: &Arc<AppState> = &state;
    let state_arc = Arc::clone(arc);

    {
        let mut inner = state_arc.inner.lock().map_err(|e| e.to_string())?;
        let msg_count = inner.messages.len();
        match start_action_with_transcript(&inner.status, &inner.mode, msg_count) {
            StartAction::RejectAlreadyRunning => {
                return Err("Conversation is already running".into());
            }
            StartAction::RejectStepPaused => {
                return Err(
                    "Step mode — press Step to advance one turn, or switch to Auto and Start"
                        .into(),
                );
            }
            StartAction::ResumeAuto | StartAction::ContinueIdle => {
                let turn = inner.turn_count;
                state_arc.reset_flag.store(false, Ordering::Relaxed);
                state_arc.pause_flag.store(false, Ordering::Relaxed);
                state_arc.step_once.store(false, Ordering::Relaxed);
                inner.status = AppStatus::Running;
                drop(inner);
                let _ = app_handle.emit(
                    "status-update",
                    serde_json::json!({ "status": "Running", "turn": turn }),
                );
                spawn_loop_if_needed(state_arc, app_handle);
                return Ok(());
            }
            StartAction::FreshStart => {
                // fall through — clear and begin
            }
        }
    }

    // Fresh start
    state_arc.pause_flag.store(false, Ordering::Relaxed);
    state_arc.reset_flag.store(false, Ordering::Relaxed);
    state_arc.step_once.store(false, Ordering::Relaxed);

    {
        let mut inner = state_arc.inner.lock().map_err(|e| e.to_string())?;
        inner.messages.clear();
        inner.turn_count = 0;
        if inner.mode == ConversationMode::Step {
            // Step: wait for step_once
            inner.status = AppStatus::Paused;
            state_arc.pause_flag.store(true, Ordering::Relaxed);
        } else {
            inner.status = AppStatus::Running;
        }
        inject_seed_if_any(&mut inner);
    }

    let status_emit = {
        let inner = state_arc.inner.lock().map_err(|e| e.to_string())?;
        serde_json::json!({ "status": format!("{:?}", inner.status), "turn": inner.turn_count })
    };
    let _ = app_handle.emit("status-update", status_emit);

    spawn_loop_if_needed(state_arc, app_handle);
    Ok(())
}

fn inject_seed_if_any(inner: &mut InnerState) {
    let seed = inner.seed_prompt.trim().to_string();
    if seed.is_empty() {
        return;
    }
    let msg = Message {
        agent: "seed".into(),
        role: "user".into(),
        content: seed,
        turn: 0,
        created_at: now_ms(),
        reasoning: None,
    };
    inner.messages.push(msg);
}

fn spawn_loop_if_needed(state_arc: Arc<AppState>, app_handle: AppHandle) {
    // Only one loop at a time
    if state_arc
        .loop_active
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    tauri::async_runtime::spawn(async move {
        run_conversation_loop(state_arc.clone(), app_handle).await;
        state_arc.loop_active.store(false, Ordering::SeqCst);
    });
}

/// Advance one bot turn (works in step mode; also usable mid-auto as single step).
#[tauri::command]
pub async fn step_conversation(
    state: tauri::State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let arc: &Arc<AppState> = &state;
    let state_arc = Arc::clone(arc);

    {
        let mut inner = state_arc.inner.lock().map_err(|e| e.to_string())?;
        if inner.status == AppStatus::Idle && inner.messages.is_empty() {
            // first step starts the conversation
            inner.turn_count = 0;
            inject_seed_if_any(&mut inner);
        }
        // Never overwrite conversation mode — step_once alone drives a single turn.
        let mode = prepare_step(inner.mode.clone(), inner.turn_count, inner.max_turns)?;
        debug_assert_eq!(mode, inner.mode);
        let _ = mode;
        inner.status = AppStatus::Running;
    }

    state_arc.reset_flag.store(false, Ordering::Relaxed);
    state_arc.step_once.store(true, Ordering::Relaxed);
    state_arc.pause_flag.store(false, Ordering::Relaxed);

    let _ = app_handle.emit(
        "status-update",
        serde_json::json!({ "status": "Running", "turn": state_arc.inner.lock().unwrap().turn_count }),
    );

    // Always spawn — loop exits when idle; multiple loops are ok if they exit on idle
    spawn_loop_if_needed(state_arc, app_handle);
    Ok(())
}

#[tauri::command]
pub async fn pause_conversation(
    state: tauri::State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let arc: &Arc<AppState> = &state;
    arc.pause_flag.store(true, Ordering::Relaxed);
    arc.step_once.store(false, Ordering::Relaxed);
    let mut inner = arc.inner.lock().map_err(|e| e.to_string())?;
    inner.status = AppStatus::Paused;
    let _ = app_handle.emit(
        "status-update",
        serde_json::json!({ "status": "Paused", "turn": inner.turn_count }),
    );
    Ok(())
}

#[tauri::command]
pub async fn reset_conversation(
    state: tauri::State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let arc: &Arc<AppState> = &state;
    arc.reset_flag.store(true, Ordering::Relaxed);
    arc.pause_flag.store(true, Ordering::Relaxed);
    arc.step_once.store(false, Ordering::Relaxed);

    let mut inner = arc.inner.lock().map_err(|e| e.to_string())?;
    inner.messages.clear();
    inner.turn_count = 0;
    inner.pending_narration.clear();
    inner.status = AppStatus::Idle;
    let _ = app_handle.emit(
        "status-update",
        serde_json::json!({ "status": "Idle", "turn": 0 }),
    );
    Ok(())
}

/// Hard stop: end the run, keep transcript (Step/Start can continue).
/// Uses Idle + pause so the loop exits cleanly — does **not** set reset_flag
/// (that raced Step/Start by blocking spawn while loop_active was still true).
#[tauri::command]
pub async fn stop_conversation(
    state: tauri::State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let arc: &Arc<AppState> = &state;
    arc.pause_flag.store(true, Ordering::Relaxed);
    arc.step_once.store(false, Ordering::Relaxed);

    {
        let mut inner = arc.inner.lock().map_err(|e| e.to_string())?;
        // Keep messages + turn_count
        inner.status = AppStatus::Idle;
        let turn = inner.turn_count;
        let _ = app_handle.emit(
            "status-update",
            serde_json::json!({ "status": "Idle", "turn": turn }),
        );
    }
    let _ = app_handle.emit(
        "stream-abort",
        serde_json::json!({ "agent": "", "turn": 0 }),
    );
    Ok(())
}

/// Restore a saved transcript so agents continue with full context.
#[tauri::command]
pub async fn load_transcript(
    state: tauri::State<'_, Arc<AppState>>,
    app_handle: AppHandle,
    messages: Vec<Message>,
    turn_count: u32,
    chat_id: String,
) -> Result<(), String> {
    let arc: &Arc<AppState> = &state;
    let state_arc = Arc::clone(arc);
    arc.reset_flag.store(true, Ordering::Relaxed);
    arc.pause_flag.store(true, Ordering::Relaxed);
    arc.step_once.store(false, Ordering::Relaxed);

    // Persist loaded messages to DB (async, best-effort)
    if !chat_id.is_empty() {
        let db_path = state_arc.db_path.lock().ok().map(|g| g.clone()).unwrap_or_default();
        if !db_path.is_empty() {
            let msgs = messages.clone();
            let cid = chat_id.clone();
            std::thread::spawn(move || {
                if let Ok(conn) = db::open(&db_path) {
                    let _ = db::save_messages(&conn, &cid, &msgs);
                }
            });
        }
    }

    let mut inner = arc.inner.lock().map_err(|e| e.to_string())?;
    inner.messages = messages;
    inner.turn_count = turn_count;
    inner.status = AppStatus::Idle;
    inner.pending_narration.clear();
    inner.active_chat_id = chat_id;
    let _ = app_handle.emit(
        "status-update",
        serde_json::json!({ "status": "Idle", "turn": turn_count }),
    );
    // clear reset so future runs work (if no loop was active)
    drop(inner);
    if !arc.loop_active.load(Ordering::SeqCst) {
        arc.reset_flag.store(false, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_messages(state: tauri::State<'_, Arc<AppState>>) -> Result<Vec<Message>, String> {
    let arc: &Arc<AppState> = &state;
    let inner = arc.inner.lock().map_err(|e| e.to_string())?;
    Ok(inner.messages.clone())
}

#[tauri::command]
pub async fn get_status(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(AppStatus, u32), String> {
    let arc: &Arc<AppState> = &state;
    let inner = arc.inner.lock().map_err(|e| e.to_string())?;
    Ok((inner.status.clone(), inner.turn_count))
}

#[tauri::command]
pub async fn get_config(state: tauri::State<'_, Arc<AppState>>) -> Result<InnerState, String> {
    let arc: &Arc<AppState> = &state;
    let inner = arc.inner.lock().map_err(|e| e.to_string())?;
    Ok(inner.clone())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri command surface; keep flat for FE invoke
pub async fn update_config(
    state: tauri::State<'_, Arc<AppState>>,
    ai1_config: AiConfig,
    ai2_config: AiConfig,
    ai3_config: Option<AiConfig>,
    bot_count: Option<u8>,
    max_turns: u32,
    delay_ms: u64,
    mode: Option<ConversationMode>,
    seed_prompt: Option<String>,
) -> Result<(), String> {
    let arc: &Arc<AppState> = &state;
    let mut inner = arc.inner.lock().map_err(|e| e.to_string())?;
    inner.ai1_config = ai1_config;
    inner.ai2_config = ai2_config;
    if let Some(c) = ai3_config {
        inner.ai3_config = c;
    }
    if let Some(n) = bot_count {
        inner.bot_count = if n >= 3 { 3 } else { 2 };
    }
    inner.max_turns = max_turns.max(1);
    inner.delay_ms = delay_ms;
    if let Some(m) = mode {
        inner.mode = m;
    }
    if let Some(s) = seed_prompt {
        inner.seed_prompt = s;
    }
    Ok(())
}

/// Home-relative Desktop if it exists, otherwise the home directory (or cwd).
pub(crate) fn export_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));
    let desktop = home.join("Desktop");
    if desktop.is_dir() {
        desktop
    } else {
        home
    }
}

#[tauri::command]
pub fn export_chat(content: String) -> Result<String, String> {
    let dir = export_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let filename = format!("AI-Conversation-{}.md", timestamp);
    let path = dir.join(filename);
    std::fs::write(&path, &content).map_err(|e| format!("Failed to save file: {}", e))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Set which chat the current session belongs to (matches frontend chat ID).
#[tauri::command]
pub async fn set_active_chat(
    state: tauri::State<'_, Arc<AppState>>,
    chat_id: String,
) -> Result<(), String> {
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    inner.active_chat_id = chat_id;
    Ok(())
}

/// Set a one-shot director note for the next agent reply.
#[tauri::command]
pub async fn set_narration(
    state: tauri::State<'_, Arc<AppState>>,
    text: String,
) -> Result<(), String> {
    let arc: &Arc<AppState> = &state;
    let mut inner = arc.inner.lock().map_err(|e| e.to_string())?;
    inner.pending_narration = text;
    Ok(())
}

#[tauri::command]
pub async fn get_narration(state: tauri::State<'_, Arc<AppState>>) -> Result<String, String> {
    let arc: &Arc<AppState> = &state;
    let inner = arc.inner.lock().map_err(|e| e.to_string())?;
    Ok(inner.pending_narration.clone())
}

fn with_db<T>(
    state: &Arc<AppState>,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let db_path = state
        .db_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    if db_path.is_empty() {
        return Err("Database not ready".into());
    }
    let conn = db::open(&db_path)?;
    f(&conn)
}

/// Persist a full saved-chat JSON snapshot (sidebar + transcript).
#[tauri::command]
pub async fn upsert_saved_chat(
    state: tauri::State<'_, Arc<AppState>>,
    snapshot: serde_json::Value,
) -> Result<(), String> {
    let chat_id = snapshot
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "snapshot.id required".to_string())?
        .to_string();
    let updated_at = snapshot
        .get("updated_at")
        .and_then(|v| v.as_u64())
        .unwrap_or_else(now_ms);
    let messages: Vec<Message> = snapshot
        .get("messages")
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let json = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
    let arc: &Arc<AppState> = &state;
    with_db(arc, |conn| db::upsert_saved_chat(conn, &chat_id, updated_at, &json, &messages))
}

/// List saved chats from SQLite (newest first). Falls back to empty if DB missing.
#[tauri::command]
pub async fn list_saved_chats(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<serde_json::Value>, String> {
    let arc: &Arc<AppState> = &state;
    with_db(arc, |conn| {
        let metas = db::list_chat_metas(conn)?;
        let mut out = Vec::with_capacity(metas.len());
        for (_id, _updated, json) in metas {
            if json.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<serde_json::Value>(&json) {
                Ok(v) => out.push(v),
                Err(_) => continue,
            }
        }
        Ok(out)
    })
}

/// Load one saved chat; if snapshot messages are empty, fill from the messages table.
#[tauri::command]
pub async fn get_saved_chat(
    state: tauri::State<'_, Arc<AppState>>,
    chat_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let arc: &Arc<AppState> = &state;
    with_db(arc, |conn| {
        let Some((_updated, json)) = db::get_chat_meta(conn, &chat_id)? else {
            return Ok(None);
        };
        if json.trim().is_empty() {
            return Ok(None);
        }
        let mut value: serde_json::Value =
            serde_json::from_str(&json).map_err(|e| e.to_string())?;
        let empty_msgs = value
            .get("messages")
            .and_then(|m| m.as_array())
            .map(|a| a.is_empty())
            .unwrap_or(true);
        if empty_msgs {
            let msgs = db::load_messages(conn, &chat_id)?;
            value["messages"] = serde_json::to_value(msgs).map_err(|e| e.to_string())?;
        }
        Ok(Some(value))
    })
}

/// Delete a saved chat from SQLite.
#[tauri::command]
pub async fn delete_saved_chat(
    state: tauri::State<'_, Arc<AppState>>,
    chat_id: String,
) -> Result<(), String> {
    let arc: &Arc<AppState> = &state;
    with_db(arc, |conn| db::delete_chat(conn, &chat_id))
}

/// Delete a single message from the current chat by agent + turn + created_at.
/// Removes from both in-memory state and SQLite DB.
#[tauri::command]
pub async fn delete_messages(
    state: tauri::State<'_, Arc<AppState>>,
    app_handle: AppHandle,
    agent: String,
    turn: u32,
    created_at: u64,
) -> Result<(), String> {
    let arc: &Arc<AppState> = &state;

    // Remove from in-memory state
    {
        let mut inner = arc.inner.lock().map_err(|e| e.to_string())?;
        inner.messages.retain(|m| {
            !(m.agent == agent && m.turn == turn && m.created_at == created_at)
        });
    }

    // Remove from DB (best-effort)
    let chat_id = {
        let inner = arc.inner.lock().map_err(|e| e.to_string())?;
        inner.active_chat_id.clone()
    };
    if !chat_id.is_empty() {
        let db_path = arc.db_path.lock().ok().map(|g| g.clone()).unwrap_or_default();
        if !db_path.is_empty() {
            let cid = chat_id.clone();
            let a = agent.clone();
            let _ = std::thread::spawn(move || {
                if let Ok(conn) = db::open(&db_path) {
                    let _ = db::delete_message(&conn, &cid, &a, turn, created_at);
                }
            });
        }
    }

    // Notify FE
    let _ = app_handle.emit("message-deleted", serde_json::json!({
        "agent": agent,
        "turn": turn,
        "created_at": created_at,
    }));

    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

async fn run_one_turn(state: &Arc<AppState>, app_handle: &AppHandle) -> bool {
    // Returns false if should stop loop entirely
    if state.reset_flag.load(Ordering::Relaxed) {
        return false;
    }

    let (bot_count, turn_count, max_turns, config, messages, narration, chat_id) = {
        let mut inner = match state.inner.lock() {
            Ok(i) => i,
            Err(_) => return false,
        };
        if inner.turn_count >= inner.max_turns {
            return false;
        }
        let agent = next_speaker(inner.bot_count, inner.turn_count);
        let cfg = inner.config_for_agent(agent).clone();
        let narration = {
            let n = inner.pending_narration.trim().to_string();
            if n.is_empty() {
                None
            } else {
                // consume one-shot
                inner.pending_narration.clear();
                Some(n)
            }
        };
        // Build context: trim messages to fit within model's context window
        let all_msgs = inner.messages.clone();
        let active_configs: Vec<&AiConfig> = match inner.bot_count {
            3 => vec![&inner.ai1_config, &inner.ai2_config, &inner.ai3_config],
            _ => vec![&inner.ai1_config, &inner.ai2_config],
        };
        let context_msgs =
            trim_messages_for_context(&active_configs, &inner.seed_prompt, &all_msgs);
        (
            inner.bot_count,
            inner.turn_count,
            inner.max_turns,
            cfg,
            context_msgs, // ← only send what fits in context window
            narration,
            inner.active_chat_id.clone(),
        )
    };

    if turn_count >= max_turns {
        return false;
    }

    let agent = next_speaker(bot_count, turn_count);
    let narr_ref = narration.as_deref();

    // Prefer SSE streaming; falls back to non-stream if empty
    let result = llm::stream_llm(
        &config,
        agent,
        &messages,
        narr_ref,
        turn_count,
        app_handle,
        if chat_id.is_empty() {
            "ai-conversation"
        } else {
            chat_id.as_str()
        },
    )
    .await;

    match result {
        Ok((content, reasoning)) => {
            let msg = Message {
                agent: agent.into(),
                role: "assistant".into(),
                content,
                turn: turn_count,
                created_at: now_ms(),
                reasoning,
            };
            if state.reset_flag.load(Ordering::Relaxed) {
                return false;
            }
            if let Ok(mut inner) = state.inner.lock() {
                if !state.reset_flag.load(Ordering::Relaxed) {
                    // Persist to database (non-blocking, best-effort)
                    if !chat_id.is_empty() {
                        let db_path = state.db_path.lock().ok().map(|g| g.clone()).unwrap_or_default();
                        if !db_path.is_empty() {
                            let msg_for_db = msg.clone();
                            let cid = chat_id.clone();
                            std::thread::spawn(move || {
                                if let Ok(conn) = db::open(&db_path) {
                                    let _ = db::save_message(&conn, &cid, &msg_for_db);
                                }
                            });
                        }
                    }

                    inner.messages.push(msg.clone());
                    inner.turn_count += 1;
                    let _ = app_handle.emit("new-message", &msg);
                    let _ = app_handle.emit(
                        "stream-done",
                        serde_json::json!({
                            "agent": msg.agent,
                            "turn": msg.turn,
                        }),
                    );
                    let _ = app_handle.emit(
                        "status-update",
                        serde_json::json!({
                            "status": format!("{:?}", inner.status),
                            "turn": inner.turn_count,
                        }),
                    );
                    // clear narration on frontend
                    let _ = app_handle.emit("narration-cleared", true);
                }
            }
        }
        Err(e) => {
            let _ = app_handle.emit(
                "stream-abort",
                serde_json::json!({ "agent": agent, "turn": turn_count }),
            );
            let _ = app_handle.emit("error", &format!("{} error: {}", agent, e));
            if let Ok(mut inner) = state.inner.lock() {
                inner.status = AppStatus::Paused;
            }
            state.pause_flag.store(true, Ordering::Relaxed);
            let _ = app_handle.emit(
                "status-update",
                serde_json::json!({ "status": "Paused", "turn": turn_count }),
            );
            return true;
        }
    }

    true
}

async fn run_conversation_loop(state: Arc<AppState>, app_handle: AppHandle) {
    // Emit any seed message already present
    {
        if let Ok(inner) = state.inner.lock() {
            for m in &inner.messages {
                if m.agent == "seed" {
                    let _ = app_handle.emit("new-message", m);
                }
            }
        }
    }

    loop {
        if state.reset_flag.load(Ordering::Relaxed) {
            state.reset_flag.store(false, Ordering::Relaxed);
            break;
        }

        // Wait while paused, unless step_once is set
        if state.pause_flag.load(Ordering::Relaxed) && !state.step_once.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_millis(50)).await;
            // Exit if idle after pause with no work
            if let Ok(inner) = state.inner.lock() {
                if inner.status == AppStatus::Idle {
                    break;
                }
            }
            continue;
        }

        // Max turns?
        {
            let inner = state.inner.lock().unwrap();
            if inner.turn_count >= inner.max_turns {
                break;
            }
            if inner.status == AppStatus::Idle {
                break;
            }
        }

        let step_mode = {
            let inner = state.inner.lock().unwrap();
            inner.mode == ConversationMode::Step || state.step_once.load(Ordering::Relaxed)
        };

        let cont = run_one_turn(&state, &app_handle).await;
        if !cont {
            break;
        }

        if step_mode || state.step_once.load(Ordering::Relaxed) {
            state.step_once.store(false, Ordering::Relaxed);
            state.pause_flag.store(true, Ordering::Relaxed);
            if let Ok(mut inner) = state.inner.lock() {
                if inner.status != AppStatus::Idle {
                    inner.status = AppStatus::Paused;
                    let _ = app_handle.emit(
                        "status-update",
                        serde_json::json!({ "status": "Paused", "turn": inner.turn_count }),
                    );
                }
            }
            // Stay in loop waiting for next step, or exit if maxed
            let done = {
                let inner = state.inner.lock().unwrap();
                inner.turn_count >= inner.max_turns
            };
            if done {
                break;
            }
            continue;
        }

        // Auto delay
        let delay = {
            let inner = state.inner.lock().unwrap();
            inner.delay_ms
        };
        if delay > 0 {
            // Interruptible delay
            let steps = (delay / 50).max(1);
            for _ in 0..steps {
                if state.pause_flag.load(Ordering::Relaxed)
                    || state.reset_flag.load(Ordering::Relaxed)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    }

    if let Ok(mut inner) = state.inner.lock() {
        if inner.status != AppStatus::Paused {
            inner.status = AppStatus::Idle;
        }
        // If max turns hit, force idle
        if inner.turn_count >= inner.max_turns {
            inner.status = AppStatus::Idle;
        }
        let _ = app_handle.emit(
            "status-update",
            serde_json::json!({
                "status": format!("{:?}", inner.status),
                "turn": inner.turn_count,
            }),
        );
    }
}

#[cfg(test)]
mod export_tests {
    use super::export_dir;
    use std::path::PathBuf;

    #[test]
    fn export_dir_follows_home_or_userprofile() {
        let dir = export_dir();
        assert!(!dir.as_os_str().is_empty());
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from);
        if let Some(home) = home {
            assert!(
                dir == home.join("Desktop") || dir == home,
                "export_dir {dir:?} should be Desktop or home {home:?}"
            );
        }
    }
}
