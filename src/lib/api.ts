import { invoke } from "@tauri-apps/api/core";
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
import { isTauriRuntime } from "./openaiCompat";

/** True when running inside the Tauri webview (vs Vite browser preview). */
export function isTauri(): boolean {
  return isTauriRuntime();
}

async function tryInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T | null> {
  if (!isTauri()) return null;
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
  if (!isTauri()) return getEngineMessages();
  return (await tryInvoke<Message[]>("get_messages")) ?? [];
}

export async function getStatus(): Promise<[AppStatus, number]> {
  if (!isTauri()) return getEngineStatus();
  return (await tryInvoke<[AppStatus, number]>("get_status")) ?? ["Idle", 0];
}

export async function getConfig(): Promise<InnerState | null> {
  return tryInvoke<InnerState>("get_config");
}

export async function updateConfig(cfg: InnerState): Promise<void> {
  if (!isTauri()) {
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
  if (!isTauri()) {
    await engineStart();
    return;
  }
  await invoke("start_conversation");
}

export async function stepConversation(): Promise<void> {
  if (!isTauri()) {
    await engineStep();
    return;
  }
  await invoke("step_conversation");
}

export async function pauseConversation(): Promise<void> {
  if (!isTauri()) {
    await enginePause();
    return;
  }
  await invokeCmd("pause_conversation");
}

export async function stopConversation(): Promise<void> {
  if (!isTauri()) {
    await engineStop();
    return;
  }
  await invokeCmd("stop_conversation");
}

export async function resetConversation(): Promise<void> {
  if (!isTauri()) {
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
  if (!isTauri()) {
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
  if (!isTauri()) {
    setEngineSession(chatId);
    return;
  }
  await invokeCmd("set_active_chat", { chatId });
}

export async function setNarration(text: string): Promise<void> {
  if (!isTauri()) {
    await engineSetNarration(text);
    return;
  }
  await invokeCmd("set_narration", { text });
}

export async function exportChat(content: string): Promise<string> {
  if (!isTauri()) {
    const name = `conversation-${new Date().toISOString().slice(0, 10)}.md`;
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return name;
  }
  return invoke<string>("export_chat", { content });
}

export async function deleteMessage(args: {
  agent: string;
  turn: number;
  created_at: number;
}): Promise<boolean> {
  if (!isTauri()) {
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
  if (!isTauri()) return engineFetchModels(args.baseUrl, args.apiKey);
  return invokeCmd<string[]>("fetch_models", args);
}

export async function upsertSavedChat(snapshot: unknown): Promise<void> {
  if (!isTauri()) return;
  await invokeCmd("upsert_saved_chat", { snapshot });
}

export async function listSavedChats(): Promise<unknown[] | null> {
  return tryInvoke<unknown[]>("list_saved_chats");
}

export async function deleteSavedChat(chatId: string): Promise<void> {
  if (!isTauri()) return;
  await invokeCmd("delete_saved_chat", { chatId });
}

export type { AiConfig, ConversationMode };
