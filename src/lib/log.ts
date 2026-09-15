import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./openaiCompat";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

function emitConsole(level: LogLevel, source: string, message: string) {
  const line = `[${source}] ${message}`;
  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "debug":
    case "trace":
      console.debug(line);
      break;
    default:
      console.info(line);
  }
}

function forward(level: LogLevel, message: string, source: string) {
  emitConsole(level, source, message);
  if (!isTauriRuntime()) return;
  void invoke("frontend_log", { level, message, source }).catch(() => {
    /* logger not ready / non-tauri */
  });
}

export const log = {
  trace: (message: string, source = "ui") => forward("trace", message, source),
  debug: (message: string, source = "ui") => forward("debug", message, source),
  info: (message: string, source = "ui") => forward("info", message, source),
  warn: (message: string, source = "ui") => forward("warn", message, source),
  error: (message: string, source = "ui") => forward("error", message, source),
};

/** Path to ~/.local/share/.../ai-conversation.log (platform app data). */
export async function getLogPath(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<string | null>("get_log_path");
  } catch {
    return null;
  }
}
