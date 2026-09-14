export const MUSE_SPARK_13_CONTRIBUTOR = "muse-spark-1.3-contributor";
export const APP_USER_AGENT = "ai-conversation/2.0";

export function usesResponsesApi(model: string): boolean {
  return model.startsWith("muse-spark");
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** In Vite preview, proxy OpenCode Go so the browser is not blocked by CORS. */
export function resolveApiBase(url: string): string {
  const u = normalizeBaseUrl(url);
  if (!isTauriRuntime()) {
    if (u.endsWith("/zen/go/v1") || u.includes("opencode.ai/zen/go")) {
      return "/opencode-go";
    }
    if (u.endsWith("/zen/v1") || u.includes("opencode.ai/zen/v1")) {
      return "/opencode-zen";
    }
  }
  return u;
}

export function chatCompletionsUrl(base: string): string {
  return `${normalizeBaseUrl(base)}/chat/completions`;
}

export function responsesUrl(base: string): string {
  return `${normalizeBaseUrl(base)}/responses`;
}

export function modelsUrl(base: string): string {
  return `${normalizeBaseUrl(base)}/models`;
}
