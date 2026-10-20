import { createRoot } from "react-dom/client";
import App from "./App";
import { importLegacyLocalStorage } from "./lib/api";
import { getLogPath, log } from "./lib/log";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/plus-jakarta-sans/wght-italic.css";
import "@fontsource/iceland";
import "@fontsource/atkinson-hyperlegible-mono/400.css";
import "@fontsource/atkinson-hyperlegible-mono/600.css";
import "./index.css";

// StrictMode stays off: it double-mounts effects, and the boot path talks to
// the main process once per mount.
log.info("frontend boot", "main");
void getLogPath().then((path) => {
  if (path) log.info(`log file: ${path}`, "main");
});

// Prefs, voices and casts from the old Tauri build land before anything reads them.
void importLegacyLocalStorage().finally(() => {
  createRoot(document.getElementById("root") as HTMLElement).render(<App />);
});
