import type { AiConfig, InnerState } from "../types";
import { MUSE_SPARK_13_CONTRIBUTOR, OPENCODE_GO_BASE } from "../types";

const CONFIG_KEY = "ai-conversation-config-v2";
const LEGACY_KEY = "ai-conversation-config-v1";

export const PREF_KEYS = {
  railOpen: "ai-conversation-rail-open",
  showThoughts: "ai-conversation-show-thoughts",
  zoom: "ai-conversation-zoom",
} as const;

function defaultAgent(
  name: string,
  system_prompt: string,
): AiConfig {
  return {
    name,
    system_prompt,
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
  return {
    ...merged,
    name: merged.name || base.name || "Agent",
    model: MUSE_SPARK_13_CONTRIBUTOR,
    api_base_url: OPENCODE_GO_BASE,
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
    ai3_config: patchAgent(
      fallback.ai3_config,
      raw.ai3_config ?? undefined,
    ),
    bot_count: raw.bot_count >= 3 ? 3 : 2,
    mode: raw.mode === "step" ? "step" : "auto",
    seed_prompt: raw.seed_prompt ?? "",
    max_turns: raw.max_turns || 40,
    delay_ms: raw.delay_ms ?? 800,
  };
}

export function loadPersistedConfig(): Partial<InnerState> | null {
  try {
    const s =
      localStorage.getItem(CONFIG_KEY) || localStorage.getItem(LEGACY_KEY);
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

export function readBoolPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
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
    const v = localStorage.getItem(PREF_KEYS.zoom);
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

export function missingApiKeys(cfg: InnerState): boolean {
  if (!cfg.ai1_config.api_key || !cfg.ai2_config.api_key) return true;
  if (cfg.bot_count >= 3 && !cfg.ai3_config?.api_key) return true;
  return false;
}
