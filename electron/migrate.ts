//! One-time carry-over from the Tauri build: its SQLite chats and (Linux
//! WebKitGTK) localStorage, so voices, casts and prefs survive the switch.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "./logging.js";

const TAURI_ID = "com.aiconvoir.app";

/** Tauri's app_data_dir for this identifier on each desktop OS. */
function tauriDataDir(): string {
  const home = os.homedir();
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), TAURI_ID);
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", TAURI_ID);
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), TAURI_ID);
}

export function migrateLegacyDb(userData: string) {
  const target = path.join(userData, "conversations.db");
  const source = path.join(tauriDataDir(), "conversations.db");
  if (fs.existsSync(target) || !fs.existsSync(source)) return;
  try {
    // Open + checkpoint through SQLite so WAL pages land in the copy.
    const src = new DatabaseSync(source);
    src.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    src.close();
    logger.info("migrate", `copied legacy chats from ${source}`);
  } catch (e) {
    logger.warn("migrate", `legacy chat copy failed: ${e}`);
    fs.rmSync(target, { force: true });
  }
}

/**
 * Key/value pairs from the Tauri webview's localStorage, returned once (a
 * marker file blocks repeats). Only WebKitGTK's SQLite store is readable;
 * other platforms return {} and keep their defaults.
 */
export function migrateLegacyLocalStorage(userData: string): Record<string, string> {
  const marker = path.join(userData, ".localstorage-migrated");
  if (fs.existsSync(marker)) return {};
  const out: Record<string, string> = {};
  const file = path.join(tauriDataDir(), "localstorage", "tauri_localhost_0.localstorage");
  if (process.platform === "linux" && fs.existsSync(file)) {
    try {
      const ls = new DatabaseSync(file);
      const rows = ls.prepare("SELECT key, value FROM ItemTable").all() as { key: string; value: Uint8Array | string }[];
      for (const { key, value } of rows) {
        // WebKit stores values as UTF-16LE blobs.
        out[key] = typeof value === "string" ? value : Buffer.from(value).toString("utf16le");
      }
      ls.close();
      logger.info("migrate", `read ${rows.length} legacy localStorage keys`);
    } catch (e) {
      logger.warn("migrate", `legacy localStorage read failed: ${e}`);
    }
  }
  fs.writeFileSync(marker, "");
  return out;
}
