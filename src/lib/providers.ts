/**
 * Model providers. Every entry speaks the OpenAI-compatible API (chat
 * completions, plus Responses for muse-spark on OpenCode Go); the backend
 * picks auth headers from the base URL host. Keys live per provider, not per
 * voice, so each voice only chooses a provider + model.
 */

import type { ReasoningEffort } from "../types";

export type ProviderId =
  | "opencode_go"
  | "opencode_zen"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "xai"
  | "gemini"
  | "deepseek"
  | "groq"
  | "mistral"
  | "ollama"
  | "codex"
  | "xai_grok"
  | "custom";

export interface ProviderDef {
  id: ProviderId;
  name: string;
  /** OpenAI-compatible base URL (no trailing slash). Empty for custom. */
  baseUrl: string;
  /** Where to get a key; omitted for keyless/local providers. */
  keyUrl?: string;
  /** Placeholder for the key field. */
  keyHint?: string;
  /** Local servers work without a key. */
  keyOptional?: boolean;
  /** Offered when the live model list can't be fetched. Any id can be typed. */
  models: string[];
  /**
   * Browser sign-in (desktop only). "tokens": the app keeps OAuth tokens and
   * refreshes them; no key field. "key": sign-in mints a normal API key.
   */
  signIn?: "tokens" | "key";
  /** Button label for sign-in, e.g. "Sign in with ChatGPT". */
  signInLabel?: string;
  /** Shown under the provider in settings. */
  note?: string;
  /** Thinking levels the API accepts; defaults to off/low/medium/high. */
  efforts?: ReasoningEffort[];
}

const OPENAI_EFFORTS: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];

export const PROVIDERS: ProviderDef[] = [
  {
    id: "opencode_go",
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    keyUrl: "https://opencode.ai/auth",
    keyHint: "sk-…",
    models: ["muse-spark-1.3-contributor"],
  },
  {
    id: "opencode_zen",
    name: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    keyUrl: "https://opencode.ai/auth",
    keyHint: "sk-…",
    models: [],
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "sk-…",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
    efforts: OPENAI_EFFORTS,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "sk-ant-…",
    models: ["claude-sonnet-5", "claude-opus-5-5", "claude-haiku-4-5"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    keyHint: "sk-or-…",
    models: ["openrouter/auto"],
    efforts: ["none", "minimal", "low", "medium", "high"],
    signIn: "key",
    signInLabel: "Sign in with OpenRouter",
  },
  {
    id: "xai",
    name: "xAI",
    baseUrl: "https://api.x.ai/v1",
    keyUrl: "https://console.x.ai",
    keyHint: "xai-…",
    models: ["grok-4"],
  },
  {
    id: "xai_grok",
    name: "xAI (Grok subscription)",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-4"],
    signIn: "tokens",
    signInLabel: "Sign in with xAI",
    note: "Uses your SuperGrok or X Premium+ plan instead of API credit.",
  },
  {
    id: "codex",
    name: "ChatGPT (Codex sign-in)",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    models: ["gpt-5.5", "gpt-5.4-mini", "gpt-5"],
    efforts: OPENAI_EFFORTS,
    signIn: "tokens",
    signInLabel: "Sign in with ChatGPT",
    note: "Uses your ChatGPT Plus/Pro plan. Unofficial for third-party apps and may break.",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyUrl: "https://aistudio.google.com/apikey",
    keyHint: "AIza…",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    keyUrl: "https://platform.deepseek.com/api_keys",
    keyHint: "sk-…",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyUrl: "https://console.groq.com/keys",
    keyHint: "gsk_…",
    models: ["llama-3.3-70b-versatile"],
  },
  {
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    keyUrl: "https://console.mistral.ai/api-keys",
    models: ["mistral-large-latest", "mistral-small-latest"],
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    keyOptional: true,
    models: [],
  },
  {
    id: "custom",
    name: "Custom endpoint",
    baseUrl: "",
    keyOptional: true,
    models: [],
  },
];

export const DEFAULT_PROVIDER: ProviderId = "opencode_go";

export function getProvider(id: string | undefined | null): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Legacy configs have no provider id; recover it from the base URL. */
export function inferProvider(baseUrl: string | undefined): ProviderId {
  const u = normalize(baseUrl || "");
  if (!u) return DEFAULT_PROVIDER;
  const hit = PROVIDERS.find((p) => p.baseUrl && normalize(p.baseUrl) === u);
  return hit ? hit.id : "custom";
}

/** Base URL a voice should call: the preset's, or its own for custom. */
export function baseUrlFor(provider: string | undefined, ownBase: string): string {
  const p = getProvider(provider);
  if (!p || p.id === "custom") return ownBase.trim();
  return p.baseUrl;
}

export const DEFAULT_EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high"];

/** Thinking levels offered for a provider. */
export function effortsFor(provider: string | undefined): ReasoningEffort[] {
  return getProvider(provider)?.efforts ?? DEFAULT_EFFORTS;
}

export const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Max",
};
