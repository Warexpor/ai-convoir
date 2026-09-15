use std::fs::OpenOptions;
use std::path::PathBuf;
use std::sync::OnceLock;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn log_path() -> Option<&'static PathBuf> {
    LOG_PATH.get()
}

/// Init stderr + rotating-ish append file under app data. Safe to call once.
pub fn init(app_data: &std::path::Path) -> Result<PathBuf, String> {
    let path = app_data.join("ai-conversation.log");
    let _ = std::fs::create_dir_all(app_data);

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open log file: {e}"))?;

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("ai_conversation=info,ai_conversation_lib=info,warn"));

    let stderr_layer = fmt::layer()
        .with_writer(std::io::stderr)
        .with_target(true)
        .with_ansi(true);

    let file_layer = fmt::layer()
        .with_writer(file)
        .with_target(true)
        .with_ansi(false);

    // Ignore double-init in tests / hot reload.
    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(stderr_layer)
        .with(file_layer)
        .try_init();

    let _ = LOG_PATH.set(path.clone());
    Ok(path)
}

pub fn write_frontend(level: &str, message: &str, source: Option<&str>) {
    let src = source.unwrap_or("ui");
    match level.to_ascii_lowercase().as_str() {
        "error" => tracing::error!(target: "frontend", "{src}: {message}"),
        "warn" | "warning" => tracing::warn!(target: "frontend", "{src}: {message}"),
        "debug" => tracing::debug!(target: "frontend", "{src}: {message}"),
        "trace" => tracing::trace!(target: "frontend", "{src}: {message}"),
        _ => tracing::info!(target: "frontend", "{src}: {message}"),
    }
}
