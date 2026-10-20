//! Provider credentials, encrypted with Electron's safeStorage (macOS Keychain,
//! Windows DPAPI, Linux Secret Service / KWallet) and kept in one JSON file in
//! userData. When no OS backend is available every call throws and the
//! frontend falls back to app-local storage, as before.

import { safeStorage } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logging.js";

let storePath = "";
let cache: Record<string, string> | null = null;

export function initSecrets(dir: string) {
  storePath = path.join(dir, "secrets.json");
}

/** Provider ids are short slugs; reject anything else. */
export function validAccount(account: string): boolean {
  return account.length > 0 && account.length <= 64 && /^[A-Za-z0-9_:-]+$/.test(account);
}

function available(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // "basic_text" means Chromium fell back to a hardcoded key: not a keychain.
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") return false;
  return true;
}

function load(): Record<string, string> {
  if (cache) return cache;
  try {
    const v = JSON.parse(fs.readFileSync(storePath, "utf8"));
    cache = v && typeof v === "object" ? v : {};
  } catch {
    cache = {};
  }
  return cache!;
}

function persist(all: Record<string, string>) {
  const tmp = `${storePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
  fs.renameSync(tmp, storePath);
  cache = all;
}

export function get(account: string): string | null {
  if (!available()) throw new Error("keychain unavailable");
  const blob = load()[account];
  if (!blob) return null;
  return safeStorage.decryptString(Buffer.from(blob, "base64"));
}

export function set(account: string, value: string) {
  if (!available()) throw new Error("keychain unavailable");
  const all = { ...load() };
  all[account] = safeStorage.encryptString(value).toString("base64");
  persist(all);
}

export function remove(account: string) {
  if (!available()) throw new Error("keychain unavailable");
  const all = { ...load() };
  if (!(account in all)) return;
  delete all[account];
  persist(all);
}

function secretTool(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("secret-tool", args, { timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

async function secretToolLookup(account: string): Promise<string | null> {
  const out = await secretTool(["lookup", "service", "ai-convoir", "username", account]);
  return out ? out.replace(/\n$/, "") || null : null;
}

/**
 * One-time move of keys the Tauri build left in the Secret Service (keyring
 * crate entries under service `ai-convoir`). Linux only; other platforms
 * re-enter keys once.
 */
export async function migrateLegacyKeychain() {
  if (process.platform !== "linux" || !available()) return;
  const marker = path.join(path.dirname(storePath), ".keychain-migrated");
  if (fs.existsSync(marker)) return;
  const listing = await secretTool(["search", "--all", "service", "ai-convoir"]);
  if (listing === null) return; // no secret-tool / locked collection: retry next launch
  const accounts = [...listing.matchAll(/^attribute\.username = (.+)$/gm)].map((m) => m[1].trim());
  let moved = 0;
  for (const account of new Set(accounts)) {
    if (!validAccount(account)) continue;
    if (load()[account]) continue;
    const v = await secretToolLookup(account);
    if (v) {
      set(account, v);
      moved++;
    }
  }
  fs.writeFileSync(marker, "");
  if (moved) logger.info("secrets", `migrated ${moved} legacy keychain entr${moved === 1 ? "y" : "ies"}`);
}
