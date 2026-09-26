import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./openaiCompat";
import { PROVIDERS } from "./providers";

/**
 * Provider API keys. Desktop keeps them in the OS keychain (via the
 * `secret_*` commands); the browser preview, Android, and desktops without a
 * keychain daemon fall back to localStorage. Everything else in the app reads
 * the in-memory cache, so configs, casts and saved chats never carry keys.
 */

const FALLBACK_KEY = "ai-convoir-provider-keys-v1";
const CHANGED = "provider-keys-changed";

const cache = new Map<string, string>();
let loaded: Promise<void> | null = null;
/** Set once the keychain refuses a call; the rest of the session uses the fallback. */
let keychainDown = !isTauriRuntime();

function readFallback(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function writeFallback(id: string, value: string) {
  try {
    const all = readFallback();
    if (value) all[id] = value;
    else delete all[id];
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(all));
  } catch {
    /* quota / private mode */
  }
}

async function keychainGet(id: string): Promise<string | null> {
  if (keychainDown) return null;
  try {
    return (await invoke<string | null>("secret_get", { account: id })) ?? null;
  } catch {
    keychainDown = true;
    return null;
  }
}

/** Load every provider's key once. Safe to call repeatedly. */
export function loadProviderKeys(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      const fallback = readFallback();
      for (const p of PROVIDERS) {
        const fromKeychain = await keychainGet(p.id);
        const v = fromKeychain ?? fallback[p.id] ?? "";
        if (v) cache.set(p.id, v);
        // A key saved while the keychain was unavailable moves in once it's back.
        if (!fromKeychain && fallback[p.id] && !keychainDown) {
          await setProviderKey(p.id, fallback[p.id], { silent: true });
        }
      }
      // Anything that pushed config before keys arrived re-pushes now.
      if (cache.size) window.dispatchEvent(new Event(CHANGED));
    })();
  }
  return loaded;
}

export function getProviderKey(id: string | undefined): string {
  return (id && cache.get(id)) || "";
}

export function hasProviderKey(id: string | undefined): boolean {
  return !!getProviderKey(id);
}

export async function setProviderKey(
  id: string,
  value: string,
  opts: { silent?: boolean } = {},
): Promise<void> {
  const v = value.trim();
  if (v) cache.set(id, v);
  else cache.delete(id);
  let stored = false;
  if (!keychainDown) {
    try {
      await invoke(v ? "secret_set" : "secret_delete", v ? { account: id, value: v } : { account: id });
      stored = true;
    } catch {
      keychainDown = true;
    }
  }
  // Only keep a plaintext copy when the keychain can't hold it.
  writeFallback(id, stored ? "" : v);
  if (!opts.silent) window.dispatchEvent(new Event(CHANGED));
}

/** Where keys end up, for the settings copy. */
export function keyStorageLabel(): string {
  return keychainDown ? "this device's app storage" : "your system keychain";
}

export function onProviderKeysChanged(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}
