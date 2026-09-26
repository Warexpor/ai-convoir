#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // NVIDIA + Wayland: WebKitGTK's GPU (DMA-BUF) renderer dies with
    // "Error 71 (Protocol error)" under explicit sync. Turning explicit
    // sync off keeps the GPU path; the usual workaround
    // (WEBKIT_DISABLE_DMABUF_RENDERER) falls back to CPU copies, which
    // stutters and breaks the WebGL stage.
    #[cfg(target_os = "linux")]
    if std::env::var_os("__NV_DISABLE_EXPLICIT_SYNC").is_none() {
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }
    ai_convoir_lib::run()
}
