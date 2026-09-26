import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./openaiCompat";
import { PROVIDERS, getProvider } from "./providers";

/**
 * Provider API keys. Desktop keeps them in the OS keychain (via the
 * `secret_*` commands); the browser preview, Android, and desktops without a
 * keychain daemon fall back to localStorage. Everything else in the app reads
 * the in-memory cache, so configs, casts and saved chats never carry keys.
 */

const FALLBACK_KEY = "ai-convoir-provider-keys-v1";
const CHANGED = "provider-keys-changed";

const cache = new Map<string, string>();
/** OAuth-token providers: signed-in account label ("" = signed in, no email). */
const signedIn = new Map<string, string>();
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
        if (p.signIn === "tokens") {
          await refreshSignIn(p.id);
          continue;
        }
        const fromKeychain = await keychainGet(p.id);
        const v = fromKeychain ?? fallback[p.id] ?? "";
        if (v) cache.set(p.id, v);
        // A key saved while the keychain was unavailable moves in once it's back.
        if (!fromKeychain && fallback[p.id] && !keychainDown) {
          await setProviderKey(p.id, fallback[p.id], { silent: true });
        }
      }
      // Anything that pushed config before keys arrived re-pushes now.
      if (cache.size || signedIn.size) window.dispatchEvent(new Event(CHANGED));
    })();
  }
  return loaded;
}

export function getProviderKey(id: string | undefined): string {
  return (id && cache.get(id)) || "";
}

export function hasProviderKey(id: string | undefined): boolean {
  if (getProvider(id)?.signIn === "tokens") return signedIn.has(id!);
  return !!getProviderKey(id);
}

/** Browser sign-in needs the desktop app (loopback callback + keychain). */
export function signInAvailable(): boolean {
  return isTauriRuntime() && !keychainDown;
}

export function signedInAs(id: string): string | null {
  return signedIn.has(id) ? signedIn.get(id)! : null;
}

async function refreshSignIn(id: string): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const s = await invoke<{ signed_in: boolean; email: string }>("oauth_status", {
      provider: id,
    });
    if (s.signed_in) signedIn.set(id, s.email || "");
    else signedIn.delete(id);
  } catch {
    signedIn.delete(id);
  }
}

/**
 * Run a browser sign-in. `open` shows the provider's page; resolves once the
 * browser returns to the app. OpenRouter's sign-in mints a normal key.
 */
export async function signIn(id: string, open: (url: string) => Promise<void>): Promise<void> {
  const { url } = await invoke<{ url: string }>("oauth_begin", { provider: id });
  await open(url);
  await invoke("oauth_wait", { provider: id });
  if (getProvider(id)?.signIn === "tokens") {
    await refreshSignIn(id);
  } else {
    const key = await keychainGet(id);
    if (key) cache.set(id, key);
  }
  window.dispatchEvent(new Event(CHANGED));
}

export async function cancelSignIn(id: string): Promise<void> {
  try {
    await invoke("oauth_cancel", { provider: id });
  } catch {
    /* nothing pending */
  }
}

export async function signOut(id: string): Promise<void> {
  await invoke("oauth_logout", { provider: id });
  signedIn.delete(id);
  window.dispatchEvent(new Event(CHANGED));
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
