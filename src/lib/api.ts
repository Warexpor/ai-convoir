import type {
  AiConfig,
  AppStatus,
  ConversationMode,
  InnerState,
  Message,
} from "../types";
import {
  engineDeleteMessage,
  engineFetchModels,
  engineLoadTranscript,
  enginePause,
  engineReset,
  engineSetNarration,
  engineStart,
  engineStep,
  engineStop,
  getEngineMessages,
  getEngineStatus,
  setEngineConfig,
  setEngineSession,
} from "./browserEngine";
import { invoke, isDesktopRuntime } from "./ipc";
import { withProviderKeys } from "./config";

/** True when running inside the Electron app (vs Vite browser preview). */
export function isDesktop(): boolean {
  return isDesktopRuntime();
}

async function tryInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isDesktop()) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

/** Mutations must surface IPC failures instead of looking like they succeeded. */
async function invokeCmd<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(cmd, args);
}

export async function getMessages(): Promise<Message[]> {
  if (!isDesktop()) return getEngineMessages();
  return (await tryInvoke<Message[]>("get_messages")) ?? [];
}

export async function getStatus(): Promise<[AppStatus, number]> {
  if (!isDesktop()) return getEngineStatus();
  return (await tryInvoke<[AppStatus, number]>("get_status")) ?? ["Idle", 0];
}

export async function getConfig(): Promise<InnerState | null> {
  return tryInvoke<InnerState>("get_config");
}

/** Sends the config to the engine with provider keys filled in at the last moment. */
export async function updateConfig(config: InnerState): Promise<void> {
  const cfg = withProviderKeys(config);
  if (!isDesktop()) {
    setEngineConfig(cfg);
    return;
  }
  await invokeCmd("update_config", {
    ai1Config: cfg.ai1_config,
    ai2Config: cfg.ai2_config,
    ai3Config: cfg.ai3_config,
    botCount: cfg.bot_count,
    maxTurns: cfg.max_turns,
    delayMs: cfg.delay_ms,
    mode: cfg.mode,
    seedPrompt: cfg.seed_prompt,
  });
}

export async function startConversation(): Promise<void> {
  if (!isDesktop()) {
    await engineStart();
    return;
  }
  await invoke("start_conversation");
}

export async function stepConversation(): Promise<void> {
  if (!isDesktop()) {
    await engineStep();
    return;
  }
  await invoke("step_conversation");
}

export async function pauseConversation(): Promise<void> {
  if (!isDesktop()) {
    await enginePause();
    return;
  }
  await invokeCmd("pause_conversation");
}

export async function stopConversation(): Promise<void> {
  if (!isDesktop()) {
    await engineStop();
    return;
  }
  await invokeCmd("stop_conversation");
}

export async function resetConversation(): Promise<void> {
  if (!isDesktop()) {
    await engineReset();
    return;
  }
  await invokeCmd("reset_conversation");
}

export async function loadTranscript(args: {
  messages: Message[];
  turnCount: number;
  chatId: string;
}): Promise<void> {
  if (!isDesktop()) {
    await engineLoadTranscript(args.messages, args.turnCount, args.chatId);
    return;
  }
  await invokeCmd("load_transcript", {
    messages: args.messages,
    turnCount: args.turnCount,
    chatId: args.chatId,
  });
}

export async function setActiveChat(chatId: string): Promise<void> {
  if (!isDesktop()) {
    setEngineSession(chatId);
    return;
  }
  await invokeCmd("set_active_chat", { chatId });
}

export async function setNarration(text: string): Promise<void> {
  if (!isDesktop()) {
    await engineSetNarration(text);
    return;
  }
  await invokeCmd("set_narration", { text });
}

/** How export finished: browser download (preview) or a file on disk (desktop). */
export type ExportOutcome =
  | { kind: "downloaded"; name: string }
  | { kind: "saved"; path: string };

export async function exportChat(content: string): Promise<ExportOutcome> {
  const name = `AI-ConvoIR-${new Date().toISOString().slice(0, 10)}.md`;

  if (!isDesktop()) {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return { kind: "downloaded", name };
  }
  const path = await invoke<string>("export_chat", { content });
  return { kind: "saved", path };
}

export async function deleteMessage(args: {
  agent: string;
  turn: number;
  created_at: number;
}): Promise<boolean> {
  if (!isDesktop()) {
    return engineDeleteMessage(args.agent, args.turn, args.created_at);
  }
  return invokeCmd<boolean>("delete_messages", {
    agent: args.agent,
    turn: args.turn,
    createdAt: args.created_at,
  });
}

export async function fetchModels(args: {
  baseUrl: string;
  apiKey: string;
}): Promise<string[]> {
  if (!isDesktop()) return engineFetchModels(args.baseUrl, args.apiKey);
  return invokeCmd<string[]>("fetch_models", args);
}

export async function upsertSavedChat(snapshot: unknown): Promise<void> {
  if (!isDesktop()) return;
  await invokeCmd("upsert_saved_chat", { snapshot });
}

/** Meta-only (title/config) — does not replace the messages table. */
export async function upsertSavedChatMeta(snapshot: unknown): Promise<void> {
  if (!isDesktop()) return;
  await invokeCmd("upsert_saved_chat_meta", { snapshot });
}

export async function listSavedChats(): Promise<unknown[] | null> {
  return tryInvoke<unknown[]>("list_saved_chats");
}

/** One chat hydrated from the messages table (SoT). Null in the browser preview / on miss. */
export async function getSavedChat(chatId: string): Promise<unknown | null> {
  return tryInvoke<unknown | null>("get_saved_chat", { chatId });
}

export async function deleteSavedChat(chatId: string): Promise<void> {
  if (!isDesktop()) return;
  await invokeCmd("delete_saved_chat", { chatId });
}

export type { AiConfig, ConversationMode };

/** Open an http(s) link in the user's browser. */
export async function openExternal(url: string): Promise<void> {
  if (isDesktop()) {
    try {
      await invoke("open_external", { url });
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(url, "_blank", "noopener");
}

/** One-time import of the Tauri build's localStorage (desktop only). */
export async function importLegacyLocalStorage(): Promise<void> {
  if (!isDesktop()) return;
  try {
    const items = await invoke<Record<string, string>>("legacy_local_storage");
    for (const [k, v] of Object.entries(items ?? {})) {
      if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    }
  } catch {
    /* nothing to import */
  }
}
