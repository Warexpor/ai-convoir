import type { AiConfig, InnerState } from "../types";
import { MUSE_SPARK_13_CONTRIBUTOR, OPENCODE_GO_BASE } from "../types";
import {
  DEFAULT_PROVIDER,
  baseUrlFor,
  getProvider,
  inferProvider,
} from "./providers";
import { getProviderKey, hasProviderKey } from "./secrets";

const CONFIG_KEY = "ai-convoir-config-v2";
/** Pre-rename keys — still read so browser prefs survive the brand change. */
const LEGACY_CONFIG_KEYS = [
  "ai-conversation-config-v2",
  "ai-conversation-config-v1",
] as const;

export const PREF_KEYS = {
  railOpen: "ai-convoir-rail-open",
  showThoughts: "ai-convoir-show-thoughts",
  zoom: "ai-convoir-zoom",
  fx: "ai-convoir-fx",
  streamMode: "ai-convoir-stream-mode",
} as const;

const LEGACY_PREF_KEYS: Record<keyof typeof PREF_KEYS, string> = {
  railOpen: "ai-conversation-rail-open",
  showThoughts: "ai-conversation-show-thoughts",
  zoom: "ai-conversation-zoom",
  fx: "ai-conversation-fx",
  streamMode: "ai-conversation-stream-mode",
};

/**
 * How replies appear while they are being written.
 * - live: token by token, finished paragraphs render as markdown
 * - paragraph: whole paragraphs drop in as they complete
 * - whole: nothing until the reply is done, then all of it at once
 */
export type StreamMode = "live" | "paragraph" | "whole";

export function readStreamMode(): StreamMode {
  try {
    const v =
      localStorage.getItem(PREF_KEYS.streamMode) ??
      localStorage.getItem(LEGACY_PREF_KEYS.streamMode);
    if (v === "live" || v === "paragraph" || v === "whole") return v;
  } catch {
    /* */
  }
  return "live";
}

export function writeStreamMode(v: StreamMode): void {
  try {
    localStorage.setItem(PREF_KEYS.streamMode, v);
  } catch {
    /* */
  }
}

/**
 * Visual effects budget.
 * - full: living background + glass everywhere
 * - balanced: background breathes on speaker changes, then rests
 * - lite: static background, no backdrop blur (weak GPUs / WebKitGTK)
 */
export type FxLevel = "full" | "balanced" | "lite";

export function readFx(): FxLevel {
  try {
    const v =
      localStorage.getItem(PREF_KEYS.fx) ??
      localStorage.getItem(LEGACY_PREF_KEYS.fx);
    if (v === "full" || v === "balanced" || v === "lite") return v;
  } catch {
    /* */
  }
  return "balanced";
}

export function writeFx(v: FxLevel): void {
  try {
    localStorage.setItem(PREF_KEYS.fx, v);
  } catch {
    /* */
  }
}

function defaultAgent(
  name: string,
  system_prompt: string,
): AiConfig {
  return {
    name,
    system_prompt,
    provider: DEFAULT_PROVIDER,
    model: MUSE_SPARK_13_CONTRIBUTOR,
    api_base_url: OPENCODE_GO_BASE,
    api_key: "",
    temperature: 0.85,
    max_tokens: 2048,
    reasoning_effort: "none",
    response_length: "normal",
  };
}

export function defaultConfig(): InnerState {
  return {
    ai1_config: defaultAgent(
      "Ava",
      "You are Ava — warm, curious, slightly mischievous. Speak naturally in first person when in character.",
    ),
    ai2_config: defaultAgent(
      "Jules",
      "You are Jules — dry humor, observant, pushes back gently. Keep replies chatty and human.",
    ),
    ai3_config: defaultAgent(
      "Rin",
      "You are Rin — quiet, precise, reframes the room when needed.",
    ),
    bot_count: 2,
    messages: [],
    status: "Idle",
    turn_count: 0,
    max_turns: 40,
    delay_ms: 800,
    mode: "step",
    seed_prompt: "",
  };
}

function patchAgent(base: AiConfig, patch?: Partial<AiConfig>): AiConfig {
  const merged = { ...base, ...patch };
  const provider =
    (getProvider(merged.provider) && merged.provider) ||
    inferProvider(merged.api_base_url);
  const model =
    merged.model?.trim() || getProvider(provider)?.models[0] || MUSE_SPARK_13_CONTRIBUTOR;
  return {
    ...merged,
    name: merged.name || base.name || "Agent",
    provider,
    model,
    api_base_url: baseUrlFor(provider, merged.api_base_url || ""),
    // Keys live in the provider key store (lib/secrets), never in config.
    api_key: "",
    reasoning_effort: merged.reasoning_effort || "none",
    response_length: merged.response_length || "normal",
    temperature: merged.temperature ?? 0.85,
    max_tokens: merged.max_tokens ?? 2048,
  };
}

export function normalizeConfig(raw: InnerState): InnerState {
  const fallback = defaultConfig();
  return {
    ...raw,
    ai1_config: patchAgent(fallback.ai1_config, raw.ai1_config),
    ai2_config: patchAgent(fallback.ai2_config, raw.ai2_config),
    ai3_config: patchAgent(fallback.ai3_config, raw.ai3_config),
    bot_count: raw.bot_count >= 3 ? 3 : 2,
    mode: raw.mode === "step" ? "step" : "auto",
    seed_prompt: raw.seed_prompt ?? "",
    max_turns: raw.max_turns || 40,
    delay_ms: raw.delay_ms ?? 800,
  };
}

/**
 * The single key configs carried before keys moved per provider. Read once at
 * boot so existing users keep working after the upgrade.
 */
export function legacyKeyOf(raw: Partial<InnerState> | null | undefined): {
  provider: string;
  key: string;
} | null {
  if (!raw) return null;
  for (const c of [raw.ai1_config, raw.ai2_config, raw.ai3_config]) {
    const key = c?.api_key?.trim();
    if (key) {
      return {
        provider: (getProvider(c?.provider) && c?.provider) || inferProvider(c?.api_base_url),
        key,
      };
    }
  }
  return null;
}

export function loadPersistedConfig(): Partial<InnerState> | null {
  try {
    let s = localStorage.getItem(CONFIG_KEY);
    if (!s) {
      for (const k of LEGACY_CONFIG_KEYS) {
        s = localStorage.getItem(k);
        if (s) break;
      }
    }
    return s ? (JSON.parse(s) as Partial<InnerState>) : null;
  } catch {
    return null;
  }
}

export function persistConfig(cfg: InnerState): void {
  try {
    const { messages: _m, status: _s, turn_count: _t, ...rest } = cfg;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(rest));
  } catch {
    /* quota */
  }
}

export function mergePersisted(
  base: InnerState,
  persisted: Partial<InnerState> | null,
): InnerState {
  if (!persisted) return normalizeConfig(base);
  return normalizeConfig({
    ...base,
    ...persisted,
    messages: base.messages,
    status: base.status,
    turn_count: base.turn_count,
    ai1_config: { ...base.ai1_config, ...persisted.ai1_config },
    ai2_config: { ...base.ai2_config, ...persisted.ai2_config },
    ai3_config: {
      ...base.ai3_config,
      ...(persisted.ai3_config || {}),
    },
  } as InnerState);
}

function prefLegacy(key: string): string | undefined {
  for (const [k, legacy] of Object.entries(LEGACY_PREF_KEYS)) {
    if (PREF_KEYS[k as keyof typeof PREF_KEYS] === key) return legacy;
  }
  return undefined;
}

export function readBoolPref(key: string, fallback: boolean): boolean {
  try {
    let v = localStorage.getItem(key);
    if (v === null) {
      const legacy = prefLegacy(key);
      if (legacy) v = localStorage.getItem(legacy);
    }
    if (v === null) return fallback;
    return v === "1";
  } catch {
    return fallback;
  }
}

export function writeBoolPref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* */
  }
}

export function readZoom(): number {
  try {
    const v =
      localStorage.getItem(PREF_KEYS.zoom) ||
      localStorage.getItem(LEGACY_PREF_KEYS.zoom);
    if (!v) return 1;
    return Math.min(2, Math.max(0.5, Number(v)));
  } catch {
    return 1;
  }
}

export function writeZoom(z: number): void {
  try {
    localStorage.setItem(PREF_KEYS.zoom, String(z));
  } catch {
    /* */
  }
}

function activeVoices(cfg: InnerState): AiConfig[] {
  return cfg.bot_count >= 3
    ? [cfg.ai1_config, cfg.ai2_config, cfg.ai3_config]
    : [cfg.ai1_config, cfg.ai2_config];
}

function voiceReady(c: AiConfig): boolean {
  const p = getProvider(c.provider);
  if (!p) return false;
  if (p.id === "custom" && !c.api_base_url.trim()) return false;
  return !!p.keyOptional || hasProviderKey(p.id);
}

/** True when any speaking voice has no usable credentials. */
export function missingApiKeys(cfg: InnerState): boolean {
  return activeVoices(cfg).some((c) => !voiceReady(c));
}

/** Provider names still missing a key, for prompts like "Add your … key". */
export function missingProviderNames(cfg: InnerState): string[] {
  const names = activeVoices(cfg)
    .filter((c) => !voiceReady(c))
    .map((c) => getProvider(c.provider)?.name || "provider");
  return [...new Set(names)];
}

/** Runtime copy with each voice's key filled in, for the engine only. */
export function withProviderKeys(cfg: InnerState): InnerState {
  const fill = (c: AiConfig): AiConfig => ({ ...c, api_key: getProviderKey(c.provider) });
  return {
    ...cfg,
    ai1_config: fill(cfg.ai1_config),
    ai2_config: fill(cfg.ai2_config),
    ai3_config: fill(cfg.ai3_config),
  };
}
