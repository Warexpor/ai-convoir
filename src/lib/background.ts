/**
 * Stage background: one of the built-in shaders, or the user's own image.
 * Preferences live in localStorage; the image itself lives in IndexedDB
 * (it can be megabytes, localStorage is ~5MB total and synchronous).
 */

export type ShaderPreset = "nocturne" | "veil" | "contour" | "monolith";

export const SHADER_PRESETS: { id: ShaderPreset; label: string; hint: string }[] = [
  { id: "nocturne", label: "Nocturne", hint: "Drifting smoke, lit by whoever is talking." },
  { id: "veil", label: "Veil", hint: "Tall curtains of light that sway behind the voices." },
  { id: "contour", label: "Contour", hint: "A slow topographic map, brighter where a voice glows." },
  { id: "monolith", label: "Monolith", hint: "Near-black with one wide fall of light and film grain." },
];

export interface BackgroundPrefs {
  kind: "shader" | "image";
  preset: ShaderPreset;
  /** Black overlay on the image, 0–0.9. */
  dim: number;
  /** Image blur in CSS px. */
  blur: number;
  /** Render the image in greyscale. */
  mono: boolean;
}

export const DEFAULT_BACKGROUND: BackgroundPrefs = {
  kind: "shader",
  preset: "nocturne",
  dim: 0.55,
  blur: 0,
  mono: true,
};

const PREF_KEY = "ai-conversation-background";

export function readBackground(): BackgroundPrefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return DEFAULT_BACKGROUND;
    const v = JSON.parse(raw) as Partial<BackgroundPrefs>;
    const preset = SHADER_PRESETS.some((p) => p.id === v.preset)
      ? (v.preset as ShaderPreset)
      : DEFAULT_BACKGROUND.preset;
    return {
      kind: v.kind === "image" ? "image" : "shader",
      preset,
      dim: clamp(Number(v.dim ?? DEFAULT_BACKGROUND.dim), 0, 0.9),
      blur: clamp(Number(v.blur ?? DEFAULT_BACKGROUND.blur), 0, 32),
      mono: v.mono ?? DEFAULT_BACKGROUND.mono,
    };
  } catch {
    return DEFAULT_BACKGROUND;
  }
}

export function writeBackground(v: BackgroundPrefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(v));
  } catch {
    /* */
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

// ── image store ──────────────────────────────────────────────

const DB_NAME = "ai-conversation-bg";
const STORE = "images";
const KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadImage(): Promise<Blob | null> {
  try {
    return (await tx<Blob | undefined>("readonly", (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function clearImage(): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(KEY));
  } catch {
    /* */
  }
}

/** Longest edge kept for a background; anything larger is wasted memory. */
const MAX_EDGE = 2560;

/** Downscale and re-encode, then store. Returns the stored blob. */
export async function saveImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("That file is not an image.");
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read the image.");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode the image."))),
      "image/jpeg",
      0.88,
    ),
  );
  await tx("readwrite", (s) => s.put(blob, KEY));
  return blob;
}
