mod commands;
mod db;
mod engine;
mod llm;
mod logging;
mod state;

use state::AppState;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = Arc::new(AppState::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .setup(|app| {
            // Set window icon explicitly so dev mode also gets our icon.
            // include_bytes! embeds at compile time, works in dev and prod.
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(img) =
                    tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))
                {
                    let _ = window.set_icon(img);
                }
            }
            // Initialize database path + logging in app data directory
            if let Ok(app_data) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&app_data);
                match logging::init(&app_data) {
                    Ok(path) => {
                        tracing::info!(path = %path.display(), "logging initialized");
                    }
                    Err(e) => {
                        eprintln!("failed to init file logging: {e}");
                    }
                }
                let db_path = app_data.join("conversations.db");
                if let Ok(mut p) = app.state::<Arc<AppState>>().db_path.lock() {
                    *p = db_path.to_string_lossy().to_string();
                }
                tracing::info!(db = %db_path.display(), "app data ready");
            } else {
                eprintln!("app_data_dir unavailable; logging to stderr only");
                let _ = logging::init(std::path::Path::new("."));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_conversation,
            commands::step_conversation,
            commands::pause_conversation,
            commands::stop_conversation,
            commands::reset_conversation,
            commands::load_transcript,
            commands::get_messages,
            commands::get_status,
            commands::get_config,
            commands::update_config,
            commands::fetch_models,
            commands::get_presets,
            commands::export_chat,
            commands::set_narration,
            commands::get_narration,
            commands::set_active_chat,
            commands::delete_messages,
            commands::upsert_saved_chat,
            commands::list_saved_chats,
            commands::get_saved_chat,
            commands::delete_saved_chat,
            commands::frontend_log,
            commands::get_log_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
