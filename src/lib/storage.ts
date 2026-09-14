import type { AiConfig, ConversationMode, InnerState, Message } from "../types";
import * as api from "./api";

const CHATS_KEY = "ai-conversation-chats-v1";
const APIS_KEY = "ai-conversation-apis-v1";
const ACTIVE_CHAT_KEY = "ai-conversation-active-chat";

export interface SavedApi {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  model?: string;
  updated_at: number;
}

export interface SavedChat {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  bot_count: number;
  mode: ConversationMode;
  max_turns: number;
  delay_ms: number;
  seed_prompt: string;
  ai1_config: AiConfig;
  ai2_config: AiConfig;
  ai3_config: AiConfig;
  messages: Message[];
  turn_count: number;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    if (!s) return fallback;
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

function isSavedChat(v: unknown): v is SavedChat {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && Array.isArray(o.messages);
}

export function listChats(): SavedChat[] {
  return readJson<SavedChat[]>(CHATS_KEY, []).sort(
    (a, b) => b.updated_at - a.updated_at,
  );
}

/** Prefer SQLite list when Tauri is available; keep localStorage as cache. */
export async function hydrateChats(): Promise<SavedChat[]> {
  const remote = await api.listSavedChats();
  if (!remote || remote.length === 0) return listChats();
  const chats = remote.filter(isSavedChat);
  if (chats.length === 0) return listChats();
  writeJson(CHATS_KEY, chats.slice(0, 80));
  return chats.sort((a, b) => b.updated_at - a.updated_at);
}

export function getActiveChatId(): string | null {
  return localStorage.getItem(ACTIVE_CHAT_KEY);
}

export function setActiveChatId(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_CHAT_KEY, id);
  else localStorage.removeItem(ACTIVE_CHAT_KEY);
}

export function getChat(id: string): SavedChat | undefined {
  return listChats().find((c) => c.id === id);
}

function titleFromMessages(messages: Message[], seed: string): string {
  const first =
    messages.find((m) => m.agent === "seed")?.content ||
    seed ||
    messages.find((m) => m.content.trim())?.content ||
    "New chat";
  const line = first.replace(/\s+/g, " ").trim();
  return line.length > 42 ? line.slice(0, 42) + "…" : line || "New chat";
}

export function saveChatSnapshot(
  existingId: string | null,
  config: InnerState,
  messages: Message[],
  turnCount: number,
): SavedChat {
  const chats = listChats();
  const now = Date.now();
  const id = existingId || uid();
  const prev = chats.find((c) => c.id === id);
  const cleanMsgs = messages.filter((m) => !m.streaming);
  const chat: SavedChat = {
    id,
    title: prev?.title || titleFromMessages(cleanMsgs, config.seed_prompt),
    created_at: prev?.created_at ?? now,
    updated_at: now,
    bot_count: config.bot_count >= 3 ? 3 : 2,
    mode: config.mode === "step" ? "step" : "auto",
    max_turns: config.max_turns,
    delay_ms: config.delay_ms,
    seed_prompt: config.seed_prompt || "",
    ai1_config: config.ai1_config,
    ai2_config: config.ai2_config,
    ai3_config: config.ai3_config,
    messages: cleanMsgs,
    turn_count: turnCount,
  };
  const next = [chat, ...chats.filter((c) => c.id !== id)];
  writeJson(CHATS_KEY, next.slice(0, 80));
  setActiveChatId(id);
  void api.upsertSavedChat(chat);
  return chat;
}

export function deleteChat(id: string) {
  writeJson(
    CHATS_KEY,
    listChats().filter((c) => c.id !== id),
  );
  if (getActiveChatId() === id) setActiveChatId(null);
  void api.deleteSavedChat(id);
}

export function renameChat(id: string, title: string) {
  const chats = listChats().map((c) =>
    c.id === id
      ? { ...c, title: title.trim() || c.title, updated_at: Date.now() }
      : c,
  );
  writeJson(CHATS_KEY, chats);
  const updated = chats.find((c) => c.id === id);
  if (updated) void api.upsertSavedChat(updated);
}

export function listApis(): SavedApi[] {
  return readJson<SavedApi[]>(APIS_KEY, []).sort(
    (a, b) => b.updated_at - a.updated_at,
  );
}

export function saveApi(partial: {
  id?: string;
  name: string;
  base_url: string;
  api_key: string;
  model?: string;
}): SavedApi {
  const apis = listApis();
  const id = partial.id || uid();
  const apiRow: SavedApi = {
    id,
    name: partial.name.trim() || "API",
    base_url: partial.base_url.trim(),
    api_key: partial.api_key,
    model: partial.model,
    updated_at: Date.now(),
  };
  writeJson(
    APIS_KEY,
    [apiRow, ...apis.filter((a) => a.id !== id)].slice(0, 40),
  );
  return apiRow;
}

export function deleteApi(id: string) {
  writeJson(
    APIS_KEY,
    listApis().filter((a) => a.id !== id),
  );
}
