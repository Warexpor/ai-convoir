import type { AiConfig, InnerState } from "../types";

/**
 * A cast is a saved line-up of voices — names, direction, looks. Threads
 * started inside a cast inherit it; each thread still keeps its own snapshot,
 * so editing a cast later never rewrites old transcripts.
 */
export interface Cast {
  id: string;
  name: string;
  bot_count: number;
  ai1_config: AiConfig;
  ai2_config: AiConfig;
  ai3_config: AiConfig;
  created_at: number;
  updated_at: number;
}

const CASTS_KEY = "ai-convoir-casts-v1";
const ACTIVE_CAST_KEY = "ai-convoir-active-cast";
const LEGACY_CASTS_KEY = "ai-conversation-casts-v1";
const LEGACY_ACTIVE_CAST_KEY = "ai-conversation-active-cast";

function uid(): string {
  return `cast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function notify() {
  window.dispatchEvent(new Event("casts-changed"));
}

/** Keys are shared app-wide; never copy them into a cast. */
function stripKey(c: AiConfig): AiConfig {
  return { ...c, api_key: "" };
}

export function listCasts(): Cast[] {
  try {
    const raw =
      localStorage.getItem(CASTS_KEY) || localStorage.getItem(LEGACY_CASTS_KEY);
    const list = raw ? (JSON.parse(raw) as Cast[]) : [];
    return Array.isArray(list)
      ? list.filter((c) => c && typeof c.id === "string")
      : [];
  } catch {
    return [];
  }
}

function writeCasts(casts: Cast[]) {
  try {
    localStorage.setItem(CASTS_KEY, JSON.stringify(casts));
  } catch {
    /* quota */
  }
  notify();
}

export function getCast(id: string | null | undefined): Cast | undefined {
  if (!id) return undefined;
  return listCasts().find((c) => c.id === id);
}

export function getActiveCastId(): string | null {
  try {
    return (
      localStorage.getItem(ACTIVE_CAST_KEY) ||
      localStorage.getItem(LEGACY_ACTIVE_CAST_KEY)
    );
  } catch {
    return null;
  }
}

export function setActiveCastId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_CAST_KEY, id);
    else {
      localStorage.removeItem(ACTIVE_CAST_KEY);
      localStorage.removeItem(LEGACY_ACTIVE_CAST_KEY);
    }
  } catch {
    /* quota */
  }
}

export function createCast(name: string, from: InnerState): Cast {
  const now = Date.now();
  const cast: Cast = {
    id: uid(),
    name: name.trim() || "Untitled cast",
    bot_count: from.bot_count >= 3 ? 3 : 2,
    ai1_config: stripKey(from.ai1_config),
    ai2_config: stripKey(from.ai2_config),
    ai3_config: stripKey(from.ai3_config),
    created_at: now,
    updated_at: now,
  };
  writeCasts([...listCasts(), cast]);
  return cast;
}

/** Copy the live voices back into a cast (Settings edits flow here). */
export function syncCastFromConfig(id: string, cfg: InnerState) {
  const casts = listCasts();
  const idx = casts.findIndex((c) => c.id === id);
  if (idx < 0) return;
  casts[idx] = {
    ...casts[idx],
    bot_count: cfg.bot_count >= 3 ? 3 : 2,
    ai1_config: stripKey(cfg.ai1_config),
    ai2_config: stripKey(cfg.ai2_config),
    ai3_config: stripKey(cfg.ai3_config),
    updated_at: Date.now(),
  };
  writeCasts(casts);
}

export function renameCast(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  writeCasts(
    listCasts().map((c) =>
      c.id === id ? { ...c, name: trimmed, updated_at: Date.now() } : c,
    ),
  );
}

export function deleteCast(id: string) {
  writeCasts(listCasts().filter((c) => c.id !== id));
  if (getActiveCastId() === id) setActiveCastId(null);
}

/** Apply a cast's voices onto the live config, keeping pacing. */
export function applyCast(cfg: InnerState, cast: Cast): InnerState {
  // Casts saved before multi-provider carry no provider; keep the live model then.
  const voice = (c: AiConfig, live: AiConfig): AiConfig =>
    c.provider
      ? { ...live, ...c, api_key: "" }
      : {
          ...live,
          ...c,
          api_key: "",
          provider: live.provider,
          model: live.model,
          api_base_url: live.api_base_url,
        };
  return {
    ...cfg,
    bot_count: cast.bot_count >= 3 ? 3 : 2,
    ai1_config: voice(cast.ai1_config, cfg.ai1_config),
    ai2_config: voice(cast.ai2_config, cfg.ai2_config),
    ai3_config: voice(cast.ai3_config, cfg.ai3_config),
  };
}

/** First run: make sure there is at least one cast to live in. */
export function ensureDefaultCast(cfg: InnerState): Cast {
  const casts = listCasts();
  const active = getCast(getActiveCastId());
  if (active) return active;
  if (casts.length > 0) {
    setActiveCastId(casts[0].id);
    return casts[0];
  }
  const cast = createCast("Main cast", cfg);
  setActiveCastId(cast.id);
  return cast;
}
