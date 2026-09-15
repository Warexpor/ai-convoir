import { createRoot } from "react-dom/client";
import App from "./App";
import { getLogPath, log } from "./lib/log";
import "./index.css";

// StrictMode double-mounts effects in dev; with async Tauri `listen()` that
// historically leaked duplicate stream-chunk handlers (doubled SSE text).
// Listeners now clean up safely either way — keep StrictMode off for Tauri UX.
log.info("frontend boot", "main");
void getLogPath().then((path) => {
  if (path) log.info(`log file: ${path}`, "main");
});

createRoot(document.getElementById("root") as HTMLElement).render(<App />);

