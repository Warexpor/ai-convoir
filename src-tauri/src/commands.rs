use crate::db;
use crate::engine::{
    prepare_step, start_action_with_transcript, StartAction, OPENCODE_GO_BASE, OPENCODE_ZEN_BASE,
};
use crate::harness::{
    emit_harness_metrics, log_turn_metrics, prepare_turn, TurnMachine, TurnMetrics, TurnPhase,
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
                    "Step mode — press Next to advance one turn, or switch to Auto and Start"
                        .into(),
                );
            }
            StartAction::ResumeAuto | StartAction::ContinueIdle => {
                let turn = inner.turn_count;
                state_arc.clear_reset_if_idle();
                state_arc.pause_flag.store(false, Ordering::Release);
                state_arc.step_once.store(false, Ordering::Release);
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

    // Fresh start — bump epoch so any lingering in-flight stream cannot commit
    // and cannot restore prepared.narration into this new run (epoch barrier).
    state_arc.bump_stream_epoch();
    state_arc.pause_flag.store(false, Ordering::Release);
    state_arc.clear_reset_if_idle();
    state_arc.step_once.store(false, Ordering::Release);

    {
        let mut inner = state_arc.inner.lock().map_err(|e| e.to_string())?;
        inner.messages.clear();
        inner.turn_count = 0;
        inner.pending_narration.clear();
        if inner.mode == ConversationMode::Step {
            // Step: wait for step_once
            inner.status = AppStatus::Paused;
            state_arc.pause_flag.store(true, Ordering::Release);
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
    // FE applyAbort: clear any in-flight bubble from the previous run.
    let _ = app_handle.emit(
        "stream-abort",
        serde_json::json!({ "agent": "", "turn": 0 }),
    );

    spawn_loop_if_needed(state_arc, app_handle);
    tracing::info!(target: "commands", "start_conversation");
    Ok(())
}

pub(crate) fn inject_seed_if_any(inner: &mut InnerState) {
    let seed = inner.seed_prompt.trim().to_string();
    if seed.is_empty() {
        return;
    }
    if inner.messages.iter().any(|m| m.agent == "seed") {
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

    state_arc.clear_reset_if_idle();
    state_arc.step_once.store(true, Ordering::Release);
    state_arc.pause_flag.store(false, Ordering::Release);

    tracing::info!(target: "commands", "step_conversation");
    let turn = state_arc
        .inner
        .lock()
        .map(|g| g.turn_count)
        .unwrap_or(0);
    let _ = app_handle.emit(
        "status-update",
        serde_json::json!({ "status": "Running", "turn": turn }),
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
    arc.pause_flag.store(true, Ordering::Release);
    arc.step_once.store(false, Ordering::Release);
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
    arc.bump_stream_epoch();
    arc.reset_flag.store(true, Ordering::Release);
    arc.pause_flag.store(true, Ordering::Release);
    arc.step_once.store(false, Ordering::Release);

    let mut inner = arc.inner.lock().map_err(|e| e.to_string())?;
    inner.messages.clear();
    inner.turn_count = 0;
    inner.pending_narration.clear();
    inner.status = AppStatus::Idle;
    let _ = app_handle.emit(
        "status-update",
        serde_json::json!({ "status": "Idle", "turn": 0 }),
    );
    let _ = app_handle.emit(
        "stream-abort",
        serde_json::json!({ "agent": "", "turn": 0 }),
    );
    Ok(())
}

/// Hard stop: end the run, keep transcript (Step/Start can continue).
/// Bumps stream_epoch so in-flight SSE aborts without clearing the transcript.
#[tauri::command]
pub async fn stop_conversation(
    state: tauri::State<'_, Arc<AppState>>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let arc: &Arc<AppState> = &state;
    let epoch = arc.bump_stream_epoch();
    tracing::info!(target: "commands", epoch, "stop_conversation");
    arc.pause_flag.store(true, Ordering::Release);
    arc.step_once.store(false, Ordering::Release);

    {
        let mut inner = arc.inner.lock().map_err(|e| e.to_string())?;
        // Keep messages + turn_count
        inner.pending_narration.clear();
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
    arc.bump_stream_epoch();
    arc.reset_flag.store(true, Ordering::Release);
    arc.pause_flag.store(true, Ordering::Release);
    arc.step_once.store(false, Ordering::Release);

    // Persist loaded messages to DB (async, best-effort; serialized writes).
    // Capture a save epoch so a stale boot load_transcript cannot DELETE+INSERT
    // after a newer SoT hydrate write (last-writer seal).
    if !chat_id.is_empty() {
        let db_path = state_arc
            .db_path
            .lock()
            .ok()
            .map(|g| g.clone())
            .unwrap_or_default();
        if !db_path.is_empty() {
            let msgs = messages.clone();
            let cid = chat_id.clone();
            let save_epoch = state_arc.bump_transcript_save_epoch();
            let save_state = Arc::clone(&state_arc);
            std::thread::spawn(move || {
                let _ = db::with_locked(&db_path, |conn| {
                    let current = save_state
                        .transcript_save_epoch
                        .load(Ordering::Acquire);
                    db::save_messages_if_epoch(conn, &cid, &msgs, save_epoch, current)
                        .map(|_| ())
                });
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
    let _ = app_handle.emit(
        "stream-abort",
        serde_json::json!({ "agent": "", "turn": 0 }),
    );
    // clear reset so future runs work (if no loop was active)
    drop(inner);
    arc.clear_reset_if_idle();
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

/// Writable export directory.
/// Desktop builds prefer `~/Desktop` (else home/cwd). Mobile has no Desktop —
/// use the process temp dir so export_chat does not depend on HOME layout.
pub(crate) fn export_dir() -> PathBuf {
    #[cfg(mobile)]
    {
        return std::env::temp_dir();
    }
    #[cfg(not(mobile))]
    {
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
}

#[tauri::command]
pub fn export_chat(content: String) -> Result<String, String> {
    let dir = export_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let filename = format!("AI-ConvoIR-{}.md", timestamp);
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
    let db_path = state.db_path.lock().map_err(|e| e.to_string())?.clone();
    if db_path.is_empty() {
        return Err("Database not ready".into());
    }
    db::with_locked(&db_path, f)
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
    with_db(arc, |conn| {
        db::upsert_saved_chat(conn, &chat_id, updated_at, &json, &messages)
    })
}

/// List saved chats from SQLite (newest first), each hydrated from the messages
/// table (source of truth). Falls back to empty if DB missing.
/// FE boot (`hydrateChats` → `listSavedChats`) and select (`getChat` from that
/// cache) both depend on this path — raw config_json alone can be stale after
/// incremental `save_message` / `delete_message`.
#[tauri::command]
pub async fn list_saved_chats(
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<serde_json::Value>, String> {
    let arc: &Arc<AppState> = &state;
    with_db(arc, |conn| db::list_hydrated_chats(conn))
}

/// Load one saved chat. Messages table is the transcript source of truth:
/// `save_message` / `delete_message` update rows without rewriting config_json,
/// so a non-empty snapshot can still be stale relative to the table.
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
        db::hydrate_chat_from_meta(conn, &chat_id, &json)
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
/// Returns true if a message was removed from the in-memory transcript.
#[tauri::command]
pub async fn delete_messages(
    state: tauri::State<'_, Arc<AppState>>,
    app_handle: AppHandle,
    agent: String,
    turn: u32,
    created_at: u64,
) -> Result<bool, String> {
    let arc: &Arc<AppState> = &state;

    let removed = {
        let mut inner = arc.inner.lock().map_err(|e| e.to_string())?;
        let before = inner.messages.len();
        inner
            .messages
            .retain(|m| !(m.agent == agent && m.turn == turn && m.created_at == created_at));
        before != inner.messages.len()
    };

    // Remove from DB (best-effort)
    let chat_id = {
        let inner = arc.inner.lock().map_err(|e| e.to_string())?;
        inner.active_chat_id.clone()
    };
    if !chat_id.is_empty() {
        let db_path = arc
            .db_path
            .lock()
            .ok()
            .map(|g| g.clone())
            .unwrap_or_default();
        if !db_path.is_empty() {
            let cid = chat_id.clone();
            let a = agent.clone();
            let _ = std::thread::spawn(move || {
                let _ = db::with_locked(&db_path, |conn| {
                    db::delete_message(conn, &cid, &a, turn, created_at)
                });
            });
        }
    }

    // Notify FE
    let _ = app_handle.emit(
        "message-deleted",
        serde_json::json!({
            "agent": agent,
            "turn": turn,
            "created_at": created_at,
        }),
    );

    Ok(removed)
}

/// Accept a log line from the webview and write it through the Rust logger.
#[tauri::command]
pub fn frontend_log(level: String, message: String, source: Option<String>) -> Result<(), String> {
    crate::logging::write_frontend(&level, &message, source.as_deref());
    Ok(())
}

/// Absolute path to the on-disk log file (if initialized).
#[tauri::command]
pub fn get_log_path() -> Result<Option<String>, String> {
    Ok(crate::logging::log_path().map(|p| p.display().to_string()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}


/// Put a consumed one-shot narration back only when the turn is still live.
/// Epoch barrier: FreshStart/Stop/Reset/Load bump `stream_epoch`, so an in-flight
/// abort must not restore into a newer run (status may already be Running/Paused
/// with `reset_flag` clear). Also skips on reset_flag and Idle as defense-in-depth.
fn restore_narration_unless_reset_or_idle(
    state: &Arc<AppState>,
    narration: &Option<String>,
    epoch_at_start: u64,
) {
    let Some(n) = narration.as_ref() else {
        return;
    };
    if n.is_empty() {
        return;
    }
    if state.stream_epoch.load(Ordering::Acquire) != epoch_at_start {
        return;
    }
    if state.reset_flag.load(Ordering::Acquire) {
        return;
    }
    if let Ok(mut inner) = state.inner.lock() {
        if inner.status == AppStatus::Idle {
            return;
        }
        if inner.pending_narration.is_empty() {
            inner.pending_narration = n.clone();
        }
    }
}

async fn run_one_turn(state: &Arc<AppState>, app_handle: &AppHandle) -> bool {
    // Returns false if should stop loop entirely
    if state.reset_flag.load(Ordering::Acquire) {
        return false;
    }

    let mut machine = TurnMachine::new();
    if let Err(e) = machine.begin_prepare() {
        tracing::warn!(target: "harness", error = %e, "begin_prepare");
        return false;
    }

    let epoch_at_start = state.stream_epoch.load(Ordering::Acquire);
    let created_at = now_ms();

    let prepared = {
        let mut inner = match state.inner.lock() {
            Ok(i) => i,
            Err(_) => return false,
        };
        let narration = {
            let n = inner.pending_narration.trim().to_string();
            if n.is_empty() {
                None
            } else {
                inner.pending_narration.clear();
                Some(n)
            }
        };
        match prepare_turn(&inner, narration.clone(), created_at, true) {
            Ok(p) => p,
            Err(e) => {
                // Prepare rejected (e.g. max turns) — put the one-shot note back.
                if let Some(n) = narration {
                    if inner.pending_narration.is_empty() {
                        inner.pending_narration = n;
                    }
                }
                tracing::info!(target: "harness", error = %e, "prepare stopped");
                machine.stop();
                return false;
            }
        }
    };

    let mut metrics = TurnMetrics {
        agent: prepared.agent.to_string(),
        turn: prepared.turn,
        prompt_est_tokens: prepared.prompt_est_tokens,
        trimmed: prepared.trimmed,
        cache_key: prepared.cache_key.clone(),
        ttft_ms: None,
        stream_duration_ms: None,
        content_chars: 0,
        reasoning_chars: 0,
        prompt_tokens: None,
        cached_tokens: None,
        completion_tokens: None,
        phase_end: String::new(),
    };

    let cancel = llm::StreamCancel {
        reset: &state.reset_flag,
        epoch: &state.stream_epoch,
        epoch_at_start,
    };

    // Epoch may have bumped while we held the prepare lock (stop/reset/load).
    if cancel.is_cancelled() {
        machine.stop();
        restore_narration_unless_reset_or_idle(state, &prepared.narration, epoch_at_start);
        metrics.phase_end = TurnPhase::Stopped.to_string();
        log_turn_metrics(&metrics);
        emit_harness_metrics(app_handle, &metrics);
        return false;
    }

    if let Err(e) = machine.begin_stream() {
        tracing::warn!(target: "harness", error = %e, "begin_stream");
        restore_narration_unless_reset_or_idle(state, &prepared.narration, epoch_at_start);
        return false;
    }

    let result = llm::stream_prepared(&prepared, app_handle, &cancel).await;

    match result {
        Ok(outcome) => {
            if cancel.is_cancelled() {
                machine.abort_stream();
                restore_narration_unless_reset_or_idle(state, &prepared.narration, epoch_at_start);
                metrics.phase_end = TurnPhase::Stopped.to_string();
                metrics.ttft_ms = outcome.ttft_ms;
                metrics.stream_duration_ms = Some(outcome.stream_duration_ms);
                metrics.content_chars = outcome.content.chars().count();
                metrics.reasoning_chars = outcome
                    .reasoning
                    .as_ref()
                    .map(|r| r.chars().count())
                    .unwrap_or(0);
                metrics.apply_usage(&outcome.usage);
                log_turn_metrics(&metrics);
                emit_harness_metrics(app_handle, &metrics);
                // Stream may have emitted start/chunks — FE needs applyAbort.
                let _ = app_handle.emit(
                    "stream-abort",
                    serde_json::json!({ "agent": prepared.agent, "turn": prepared.turn }),
                );
                return false;
            }

            if let Err(e) = machine.begin_commit() {
                tracing::warn!(target: "harness", error = %e, "begin_commit");
                restore_narration_unless_reset_or_idle(state, &prepared.narration, epoch_at_start);
                // Stream may have emitted start/chunks — FE needs applyAbort.
                let _ = app_handle.emit(
                    "stream-abort",
                    serde_json::json!({ "agent": prepared.agent, "turn": prepared.turn }),
                );
                return false;
            }

            metrics.ttft_ms = outcome.ttft_ms;
            metrics.stream_duration_ms = Some(outcome.stream_duration_ms);
            metrics.content_chars = outcome.content.chars().count();
            metrics.reasoning_chars = outcome
                .reasoning
                .as_ref()
                .map(|r| r.chars().count())
                .unwrap_or(0);
            metrics.apply_usage(&outcome.usage);

            let msg = Message {
                agent: prepared.agent.into(),
                role: "assistant".into(),
                content: outcome.content,
                turn: prepared.turn,
                created_at: prepared.created_at,
                reasoning: outcome.reasoning,
            };
            let chat_id = prepared.chat_id.clone();

            let committed = if let Ok(mut inner) = state.inner.lock() {
                if !cancel.is_cancelled() {
                    if !chat_id.is_empty() {
                        let db_path = state
                            .db_path
                            .lock()
                            .ok()
                            .map(|g| g.clone())
                            .unwrap_or_default();
                        if !db_path.is_empty() {
                            let msg_for_db = msg.clone();
                            let cid = chat_id.clone();
                            std::thread::spawn(move || {
                                let _ = db::with_locked(&db_path, |conn| {
                                    db::save_message(conn, &cid, &msg_for_db)
                                });
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
                    let _ = app_handle.emit("narration-cleared", true);

                    let _ = machine.to_next();
                    metrics.phase_end = machine.phase().to_string();
                    true
                } else {
                    machine.abort_stream();
                    metrics.phase_end = TurnPhase::Stopped.to_string();
                    false
                }
            } else {
                machine.abort_stream();
                metrics.phase_end = TurnPhase::Error.to_string();
                false
            };

            if !committed {
                restore_narration_unless_reset_or_idle(state, &prepared.narration, epoch_at_start);
                let _ = app_handle.emit(
                    "stream-abort",
                    serde_json::json!({ "agent": prepared.agent, "turn": prepared.turn }),
                );
            }

            log_turn_metrics(&metrics);
            emit_harness_metrics(app_handle, &metrics);

            if !committed {
                return false;
            }
        }
        Err(e) if e == llm::STREAM_ABORTED => {
            machine.abort_stream();
            restore_narration_unless_reset_or_idle(state, &prepared.narration, epoch_at_start);
            metrics.phase_end = TurnPhase::Stopped.to_string();
            log_turn_metrics(&metrics);
            emit_harness_metrics(app_handle, &metrics);
            tracing::info!(
                target: "commands",
                agent = prepared.agent,
                turn = prepared.turn,
                "stream aborted"
            );
            let _ = app_handle.emit(
                "stream-abort",
                serde_json::json!({ "agent": prepared.agent, "turn": prepared.turn }),
            );
            return false;
        }
        Err(e) => {
            machine.fail();
            // Keep narration on API failure so the user can retry the same note.
            restore_narration_unless_reset_or_idle(state, &prepared.narration, epoch_at_start);
            metrics.phase_end = TurnPhase::Error.to_string();
            log_turn_metrics(&metrics);
            emit_harness_metrics(app_handle, &metrics);
            tracing::error!(
                target: "commands",
                agent = prepared.agent,
                turn = prepared.turn,
                error = %e,
                "stream error"
            );
            let _ = app_handle.emit(
                "stream-abort",
                serde_json::json!({ "agent": prepared.agent, "turn": prepared.turn }),
            );
            let _ = app_handle.emit("error", &format!("{} error: {}", prepared.agent, e));
            if let Ok(mut inner) = state.inner.lock() {
                inner.status = AppStatus::Paused;
            }
            state.pause_flag.store(true, Ordering::Release);
            let _ = app_handle.emit(
                "status-update",
                serde_json::json!({ "status": "Paused", "turn": prepared.turn }),
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
        if state.reset_flag.load(Ordering::Acquire) {
            state.reset_flag.store(false, Ordering::Release);
            break;
        }

        // Wait while paused, unless step_once is set
        if state.pause_flag.load(Ordering::Acquire) && !state.step_once.load(Ordering::Acquire) {
            tokio::time::sleep(Duration::from_millis(50)).await;
            // Exit if idle after pause with no work
            if let Ok(inner) = state.inner.lock() {
                if inner.status == AppStatus::Idle {
                    break;
                }
            }
            continue;
        }

        // Max turns is Auto-only — Step can keep going.
        {
            let Ok(inner) = state.inner.lock() else {
                break;
            };
            if inner.mode != ConversationMode::Step && inner.turn_count >= inner.max_turns {
                break;
            }
            if inner.status == AppStatus::Idle {
                break;
            }
        }

        let step_mode = {
            let Ok(inner) = state.inner.lock() else {
                break;
            };
            inner.mode == ConversationMode::Step || state.step_once.load(Ordering::Acquire)
        };

        let cont = run_one_turn(&state, &app_handle).await;
        if !cont {
            break;
        }

        if step_mode || state.step_once.load(Ordering::Acquire) {
            state.step_once.store(false, Ordering::Release);
            state.pause_flag.store(true, Ordering::Release);
            if let Ok(mut inner) = state.inner.lock() {
                if inner.status != AppStatus::Idle {
                    inner.status = AppStatus::Paused;
                    let _ = app_handle.emit(
                        "status-update",
                        serde_json::json!({ "status": "Paused", "turn": inner.turn_count }),
                    );
                }
            }
            // Stay in loop waiting for next step, or exit if auto-maxed
            let done = {
                let Ok(inner) = state.inner.lock() else {
                    break;
                };
                inner.mode != ConversationMode::Step && inner.turn_count >= inner.max_turns
            };
            if done {
                break;
            }
            continue;
        }

        // Auto delay
        let delay = {
            let Ok(inner) = state.inner.lock() else {
                break;
            };
            inner.delay_ms
        };
        if delay > 0 {
            // Interruptible delay
            let steps = (delay / 50).max(1);
            for _ in 0..steps {
                if state.pause_flag.load(Ordering::Acquire)
                    || state.reset_flag.load(Ordering::Acquire)
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
        // If max turns hit in Auto, force idle
        if inner.mode != ConversationMode::Step && inner.turn_count >= inner.max_turns {
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
        // Desktop path under test: `cargo test --lib` never sets cfg(mobile), so
        // the mobile `temp_dir()` arm is not compiled here — do not fake-assert it.
        // (See export_dir docs: mobile uses temp because there is no Desktop.)
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from);
        if let Some(home) = home {
            assert!(
                dir == home.join("Desktop") || dir == home,
                "export_dir {dir:?} should be Desktop or home on desktop cfg"
            );
        }
    }
}

#[cfg(test)]
mod seed_tests {
    use super::inject_seed_if_any;
    use crate::state::InnerState;

    #[test]
    fn inject_seed_only_once() {
        let mut inner = InnerState::default();
        inner.seed_prompt = "hello there".into();
        inject_seed_if_any(&mut inner);
        inject_seed_if_any(&mut inner);
        let seeds: Vec<_> = inner
            .messages
            .iter()
            .filter(|m| m.agent == "seed")
            .collect();
        assert_eq!(seeds.len(), 1);
        assert_eq!(seeds[0].content, "hello there");
        assert_eq!(seeds[0].role, "user");
    }

    #[test]
    fn inject_seed_skips_blank() {
        let mut inner = InnerState::default();
        inner.seed_prompt = "   ".into();
        inject_seed_if_any(&mut inner);
        assert!(inner.messages.is_empty());
    }
}

#[cfg(test)]
mod epoch_tests {
    use crate::llm::StreamCancel;
    use crate::state::{AppState, Message};
    use std::sync::atomic::Ordering;

    #[test]
    fn bump_stream_epoch_invalidates_inflight_cancel() {
        let state = AppState::new();
        let start = state.stream_epoch.load(Ordering::Relaxed);
        let cancel = StreamCancel {
            reset: &state.reset_flag,
            epoch: &state.stream_epoch,
            epoch_at_start: start,
        };
        assert!(!cancel.is_cancelled());
        state.bump_stream_epoch();
        assert!(cancel.is_cancelled());
    }

    #[test]
    fn clear_reset_if_idle_skips_while_loop_active() {
        let state = AppState::new();
        state.reset_flag.store(true, Ordering::Relaxed);
        state.loop_active.store(true, Ordering::SeqCst);
        state.clear_reset_if_idle();
        assert!(state.reset_flag.load(Ordering::Relaxed));
        state.loop_active.store(false, Ordering::SeqCst);
        state.clear_reset_if_idle();
        assert!(!state.reset_flag.load(Ordering::Relaxed));
    }

    #[test]
    fn delete_identity_matches_stable_created_at() {
        let created = 1_700_000_000_000u64;
        let msg = Message {
            agent: "ai1".into(),
            role: "assistant".into(),
            content: "hi".into(),
            turn: 2,
            created_at: created,
            reasoning: None,
        };
        let mut msgs = vec![msg];
        let before = msgs.len();
        msgs.retain(|m| !(m.agent == "ai1" && m.turn == 2 && m.created_at == created));
        assert_eq!(before - 1, msgs.len());
        // Mismatched stamp (old FE bug) would miss:
        let msg2 = Message {
            agent: "ai1".into(),
            role: "assistant".into(),
            content: "hi".into(),
            turn: 2,
            created_at: created,
            reasoning: None,
        };
        msgs.push(msg2);
        let wrong_stamp = created + 5;
        let len = msgs.len();
        msgs.retain(|m| !(m.agent == "ai1" && m.turn == 2 && m.created_at == wrong_stamp));
        assert_eq!(msgs.len(), len);
    }
}

#[cfg(test)]
mod narration_restore_tests {
    use super::restore_narration_unless_reset_or_idle;
    use crate::state::{AppState, AppStatus};
    use std::sync::atomic::Ordering;
    use std::sync::Arc;

    #[test]
    fn restores_when_running_same_epoch_and_not_reset() {
        let state = Arc::new(AppState::new());
        let epoch = state.stream_epoch.load(Ordering::Acquire);
        {
            let mut inner = state.inner.lock().unwrap();
            inner.status = AppStatus::Running;
            inner.pending_narration.clear();
        }
        restore_narration_unless_reset_or_idle(&state, &Some("director note".into()), epoch);
        let inner = state.inner.lock().unwrap();
        assert_eq!(inner.pending_narration, "director note");
    }

    #[test]
    fn skips_restore_when_reset_flag_set() {
        let state = Arc::new(AppState::new());
        let epoch = state.stream_epoch.load(Ordering::Acquire);
        {
            let mut inner = state.inner.lock().unwrap();
            inner.status = AppStatus::Running;
            inner.pending_narration.clear();
        }
        state.reset_flag.store(true, Ordering::Release);
        restore_narration_unless_reset_or_idle(&state, &Some("stale".into()), epoch);
        let inner = state.inner.lock().unwrap();
        assert!(inner.pending_narration.is_empty());
    }

    #[test]
    fn skips_restore_when_status_idle_after_reset_or_load() {
        let state = Arc::new(AppState::new());
        let epoch = state.stream_epoch.load(Ordering::Acquire);
        {
            let mut inner = state.inner.lock().unwrap();
            inner.status = AppStatus::Idle;
            inner.pending_narration.clear();
        }
        restore_narration_unless_reset_or_idle(&state, &Some("stale".into()), epoch);
        let inner = state.inner.lock().unwrap();
        assert!(inner.pending_narration.is_empty());
    }

    #[test]
    fn fresh_start_clears_pending_narration() {
        let state = Arc::new(AppState::new());
        {
            let mut inner = state.inner.lock().unwrap();
            inner.pending_narration = "keep me?".into();
            inner.status = AppStatus::Idle;
        }
        // Mirror FreshStart / stop / reset clear semantics.
        {
            let mut inner = state.inner.lock().unwrap();
            inner.pending_narration.clear();
        }
        state.bump_stream_epoch();
        let inner = state.inner.lock().unwrap();
        assert!(inner.pending_narration.is_empty());
    }

    /// H1 residual: FreshStart bumps epoch then sets Running/Paused with reset clear.
    /// In-flight abort from the old turn must not restore prepared.narration into the new run.
    #[test]
    fn fresh_start_epoch_bump_blocks_inflight_narration_restore() {
        let state = Arc::new(AppState::new());
        let epoch_at_start = state.stream_epoch.load(Ordering::Acquire);
        {
            let mut inner = state.inner.lock().unwrap();
            // Old turn had consumed this note into prepared.narration.
            inner.pending_narration.clear();
            inner.status = AppStatus::Running;
        }

        // Mirror FreshStart: bump epoch, clear pending, set Running (reset_flag stays false).
        state.bump_stream_epoch();
        {
            let mut inner = state.inner.lock().unwrap();
            inner.messages.clear();
            inner.turn_count = 0;
            inner.pending_narration.clear();
            inner.status = AppStatus::Running;
        }
        state.reset_flag.store(false, Ordering::Release);

        // Old turn abort path restores with its epoch_at_start — must no-op.
        restore_narration_unless_reset_or_idle(
            &state,
            &Some("stale from previous run".into()),
            epoch_at_start,
        );
        {
            let inner = state.inner.lock().unwrap();
            assert!(
                inner.pending_narration.is_empty(),
                "old prepared.narration must not leak into FreshStart run"
            );
            assert_eq!(inner.status, AppStatus::Running);
        }
        assert!(!state.reset_flag.load(Ordering::Acquire));
    }

    #[test]
    fn same_epoch_abort_still_restores_for_retry() {
        let state = Arc::new(AppState::new());
        let epoch_at_start = state.stream_epoch.load(Ordering::Acquire);
        {
            let mut inner = state.inner.lock().unwrap();
            inner.status = AppStatus::Running;
            inner.pending_narration.clear();
        }
        // API failure / abort within the same generation should restore.
        restore_narration_unless_reset_or_idle(
            &state,
            &Some("retry me".into()),
            epoch_at_start,
        );
        let inner = state.inner.lock().unwrap();
        assert_eq!(inner.pending_narration, "retry me");
    }

    #[test]
    fn fresh_start_paused_step_mode_also_blocks_restore() {
        let state = Arc::new(AppState::new());
        let epoch_at_start = state.stream_epoch.load(Ordering::Acquire);
        state.bump_stream_epoch();
        {
            let mut inner = state.inner.lock().unwrap();
            inner.pending_narration.clear();
            // FreshStart in Step mode leaves Paused, not Idle.
            inner.status = AppStatus::Paused;
        }
        restore_narration_unless_reset_or_idle(
            &state,
            &Some("stale step".into()),
            epoch_at_start,
        );
        let inner = state.inner.lock().unwrap();
        assert!(inner.pending_narration.is_empty());
    }
}

#[cfg(test)]
mod cancel_path_tests {
    use crate::llm::StreamCancel;
    use crate::state::AppState;
    use std::sync::atomic::Ordering;

    #[test]
    fn cancel_before_stream_detected_after_prepare() {
        let state = AppState::new();
        let epoch_at_start = state.stream_epoch.load(Ordering::Acquire);
        let cancel = StreamCancel {
            reset: &state.reset_flag,
            epoch: &state.stream_epoch,
            epoch_at_start,
        };
        assert!(!cancel.is_cancelled());
        // stop/reset/load before begin_stream
        state.bump_stream_epoch();
        assert!(cancel.is_cancelled());
    }

    #[test]
    fn cancel_after_stream_via_ok_cancelled_epoch() {
        let state = AppState::new();
        let epoch_at_start = state.stream_epoch.load(Ordering::Acquire);
        let cancel = StreamCancel {
            reset: &state.reset_flag,
            epoch: &state.stream_epoch,
            epoch_at_start,
        };
        // Stream returned Ok but epoch bumped mid-flight (stop).
        state.bump_stream_epoch();
        assert!(cancel.is_cancelled());
    }
}
