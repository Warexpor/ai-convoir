import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationMode, InnerState, Message } from "../types";
import * as api from "../lib/api";
import {
  defaultConfig,
  loadPersistedConfig,
  mergePersisted,
  missingApiKeys,
  normalizeConfig,
  persistConfig,
} from "../lib/config";
import {
  deleteChat,
  getActiveChatId,
  getChat,
  hydrateChats,
  listChats,
  saveChatSnapshot,
  setActiveChatId,
  type SavedChat,
} from "../lib/storage";
import { agentLabel } from "../types";
import { useStreamBridge } from "./useStreamBridge";
import { useToast } from "./useToast";

const SKIP_RESUME_KEY = "ai-conversation-skip-resume";

function pickResumeChat(): SavedChat | undefined {
  if (typeof localStorage !== "undefined" && localStorage.getItem(SKIP_RESUME_KEY)) {
    return undefined;
  }
  const aid = getActiveChatId();
  const byId = aid ? getChat(aid) : undefined;
  if (byId && byId.messages.length > 0) return byId;
  return listChats().find((c) => c.messages.length > 0);
}

export function useConversationApp() {
  const bootResume = useRef(pickResumeChat());
  const toast = useToast();
  const turnRef = useRef(0);
  const [narration, setNarration] = useState("");
  const onNarrationCleared = useCallback(() => setNarration(""), []);
  const onStreamError = useCallback(
    (msg: string) => toast.show(msg, 9000),
    [toast],
  );

  const stream = useStreamBridge({
    onError: onStreamError,
    onNarrationCleared,
    turnRef,
    initialMessages: bootResume.current?.messages ?? [],
    initialTurnCount: bootResume.current?.turn_count ?? 0,
  });
  turnRef.current = stream.turnCount;

  const [config, setConfig] = useState<InnerState | null>(null);
  const [firstDraft, setFirstDraft] = useState(
    () => bootResume.current?.seed_prompt || "",
  );
  const [chats, setChats] = useState<SavedChat[]>(() => listChats());
  const [activeChatId, setActiveChatIdState] = useState<string | null>(
    () => bootResume.current?.id ?? getActiveChatId(),
  );
  const skipAutosaveUntil = useRef(0);
  const messagesRef = useRef(stream.messages);
  const configRef = useRef(config);
  const chatIdRef = useRef(activeChatId);
  messagesRef.current = stream.messages;
  configRef.current = config;
  chatIdRef.current = activeChatId;

  useEffect(() => {
    let cancelled = false;
    void hydrateChats().then((list) => {
      if (!cancelled) setChats(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pushConfig = useCallback(async (cfg: InnerState) => {
    const n = normalizeConfig(cfg);
    await api.updateConfig(n);
    setConfig(n);
    persistConfig(n);
  }, []);

  const refreshChats = useCallback(() => setChats(listChats()), []);

  const autoSave = useCallback(() => {
    if (Date.now() < skipAutosaveUntil.current) return;
    const cfg = configRef.current;
    if (!cfg) return;
    const msgs = messagesRef.current.filter((m) => !m.streaming);
    if (msgs.length === 0 && !cfg.seed_prompt) return;
    const saved = saveChatSnapshot(
      chatIdRef.current,
      cfg,
      msgs,
      turnRef.current,
    );
    setActiveChatIdState(saved.id);
    chatIdRef.current = saved.id;
    void api.setActiveChat(saved.id);
    refreshChats();
  }, [refreshChats]);

  useEffect(() => {
    if (!stream.messages.length || stream.messages.some((m) => m.streaming))
      return;
    const t = setTimeout(autoSave, 600);
    return () => clearTimeout(t);
  }, [stream.messages, stream.turnCount, autoSave]);

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      try {
        const [msgs, statusData, cfg] = await Promise.all([
          api.getMessages(),
          api.getStatus(),
          api.getConfig(),
        ]);
        if (cancelled) return;

        const resume = msgs.length > 0 ? undefined : bootResume.current;
        if (msgs.length > 0) {
          stream.setMessages(msgs);
          stream.setTurnCount(statusData[1]);
        } else if (resume) {
          // Messages already initialized from bootResume; keep them.
          setActiveChatId(resume.id);
          setActiveChatIdState(resume.id);
          chatIdRef.current = resume.id;
        } else {
          stream.setMessages([]);
          stream.setTurnCount(statusData[1]);
        }
        stream.setStatus(statusData[0]);

        let merged = normalizeConfig(cfg ?? defaultConfig());
        merged = mergePersisted(merged, loadPersistedConfig());
        if (resume) {
          merged = {
            ...merged,
            ai1_config: resume.ai1_config,
            ai2_config: resume.ai2_config,
            ai3_config: resume.ai3_config,
            bot_count: resume.bot_count,
            messages: resume.messages,
            turn_count: resume.turn_count,
            max_turns: resume.max_turns,
            delay_ms: resume.delay_ms,
            mode: resume.mode,
            seed_prompt: resume.seed_prompt,
          };
        }
        if (cfg || resume) await pushConfig(merged);
        else setConfig(merged);
        if (cancelled) return;
        if (!resume) {
          const skipped =
            typeof localStorage !== "undefined" &&
            !!localStorage.getItem(SKIP_RESUME_KEY);
          setFirstDraft(skipped ? "" : merged.seed_prompt || "");
        }

        if (resume) {
          await api.loadTranscript({
            messages: resume.messages,
            turnCount: resume.turn_count,
            chatId: resume.id,
          });
        }
      } catch {
        if (cancelled) return;
        const fallback = mergePersisted(
          defaultConfig(),
          loadPersistedConfig(),
        );
        setConfig(fallback);
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
    // Boot once on mount; stream setters are stable enough for this remaster pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushConfig]);

  const handleToggle = useCallback(async () => {
    try {
      toast.clear();
      if (stream.status === "Running") await api.pauseConversation();
      else {
        if (narration.trim()) await api.setNarration(narration.trim());
        await api.startConversation();
      }
    } catch (e) {
      toast.show(String(e));
    }
  }, [stream.status, narration, toast]);

  const handleStep = useCallback(async () => {
    try {
      toast.clear();
      if (narration.trim()) await api.setNarration(narration.trim());
      await api.stepConversation();
    } catch (e) {
      toast.show(String(e));
    }
  }, [narration, toast]);

  const handleStop = useCallback(async () => {
    try {
      await api.stopConversation();
      stream.setStatus("Idle");
      stream.setIsThinking(false);
      stream.setMessages((prev) => prev.filter((m) => !m.streaming));
      autoSave();
    } catch (e) {
      toast.show(String(e));
    }
  }, [autoSave, stream, toast]);

  const handleReset = useCallback(async () => {
    try {
      skipAutosaveUntil.current = Date.now() + 2500;
      await api.resetConversation();
      void api.setActiveChat("");
      try {
        localStorage.setItem(SKIP_RESUME_KEY, "1");
      } catch {
        /* quota */
      }
      stream.setMessages([]);
      stream.setTurnCount(0);
      stream.setStatus("Idle");
      setNarration("");
      setFirstDraft("");
      setActiveChatId(null);
      setActiveChatIdState(null);
      chatIdRef.current = null;
      refreshChats();
    } catch (e) {
      toast.show(String(e));
    }
  }, [refreshChats, stream, toast]);

  const handleModeChange = useCallback(
    async (mode: ConversationMode) => {
      if (!config) return;
      await pushConfig({ ...config, mode });
    },
    [config, pushConfig],
  );

  const handleNarrationCommit = useCallback(async (text: string) => {
    setNarration(text);
    await api.setNarration(text);
  }, []);

  const handleExport = useCallback(async () => {
    if (!stream.messages.length) {
      toast.show("Nothing to export.", 2000);
      return;
    }
    const lines = stream.messages
      .filter((m) => !m.streaming)
      .map((m) => `### ${agentLabel(m.agent, config)}\n\n${m.content}\n`);
    const md = `# Chat\n\n${new Date().toISOString()}\n\n${lines.join("\n")}`;
    try {
      const path = await api.exportChat(md);
      toast.show(`Exported to ${path}`, 5000);
    } catch (e) {
      toast.show(`Export failed: ${e}`);
    }
  }, [stream.messages, config, toast]);

  const handleDeleteMessage = useCallback(
    async (agent: string, turn: number, created_at: number) => {
      try {
        await api.deleteMessage({ agent, turn, created_at });
        stream.setMessages((prev) =>
          prev.filter(
            (m) =>
              !(
                m.agent === agent &&
                m.turn === turn &&
                m.created_at === created_at
              ),
          ),
        );
      } catch (e) {
        toast.show(`Delete failed: ${e}`);
      }
    },
    [stream, toast],
  );

  const handleRetry = useCallback(async () => {
    if (!stream.lastFailed.current) return;
    stream.clearFailed();
    toast.clear();
    try {
      await api.stepConversation();
    } catch (e) {
      toast.show(String(e), 8000);
    }
  }, [stream, toast]);

  const handleSaveChat = useCallback(() => {
    autoSave();
    toast.show("Chat saved.", 1500);
  }, [autoSave, toast]);

  const handleSelectChat = useCallback(
    async (id: string) => {
      const chat = getChat(id);
      if (!chat) return;
      try {
        localStorage.removeItem(SKIP_RESUME_KEY);
      } catch {
        /* quota */
      }
      setActiveChatId(chat.id);
      setActiveChatIdState(chat.id);
      chatIdRef.current = chat.id;
      try {
        await api.stopConversation().catch(() => undefined);
        const cfg: InnerState = {
          ai1_config: chat.ai1_config,
          ai2_config: chat.ai2_config,
          ai3_config: chat.ai3_config,
          bot_count: chat.bot_count,
          messages: chat.messages,
          status: "Idle",
          turn_count: chat.turn_count,
          max_turns: chat.max_turns,
          delay_ms: chat.delay_ms,
          mode: chat.mode,
          seed_prompt: chat.seed_prompt,
        };
        await pushConfig(cfg);
        await api.loadTranscript({
          messages: chat.messages,
          turnCount: chat.turn_count,
          chatId: chat.id,
        });
        stream.setMessages(chat.messages);
        stream.setTurnCount(chat.turn_count);
        setFirstDraft(chat.seed_prompt || "");
        setActiveChatId(chat.id);
        setActiveChatIdState(chat.id);
        chatIdRef.current = chat.id;
        stream.setStatus("Idle");
        setNarration("");
      } catch (e) {
        toast.show(String(e));
      }
    },
    [pushConfig, stream, toast],
  );

  const handleDeleteChat = useCallback(
    (id: string) => {
      skipAutosaveUntil.current = Date.now() + 2500;
      deleteChat(id);
      if (activeChatId === id || chatIdRef.current === id) {
        setActiveChatIdState(null);
        chatIdRef.current = null;
        setActiveChatId(null);
        stream.setMessages([]);
        stream.setTurnCount(0);
        stream.setStatus("Idle");
        setNarration("");
        void api.resetConversation();
      }
      refreshChats();
      toast.show("Chat deleted.", 1800);
    },
    [activeChatId, refreshChats, stream, toast],
  );

  const handleStartFirst = useCallback(
    async (text: string) => {
      if (!config) return;
      const trimmed = text.trim();
      if (!trimmed) {
        toast.show("Write a first line.", 2200);
        return;
      }
      const next = { ...config, seed_prompt: trimmed };
      setFirstDraft(trimmed);
      try {
        localStorage.removeItem(SKIP_RESUME_KEY);
      } catch {
        /* quota */
      }
      await pushConfig(next);
      if (missingApiKeys(next)) {
        toast.show(
          "Add API keys for every active agent in Settings, then Step or Start.",
          6000,
        );
        return { needSettings: true as const };
      }
      try {
        if (next.mode === "step") await api.stepConversation();
        else await api.startConversation();
      } catch (e) {
        toast.show(String(e));
      }
      return { needSettings: false as const };
    },
    [config, pushConfig, toast],
  );

  return {
    toast,
    stream,
    config,
    pushConfig,
    firstDraft,
    setFirstDraft,
    narration,
    setNarration,
    chats,
    activeChatId,
    refreshChats,
    handleToggle,
    handleStep,
    handleStop,
    handleReset,
    handleModeChange,
    handleNarrationCommit,
    handleExport,
    handleDeleteMessage,
    handleRetry,
    handleSaveChat,
    handleSelectChat,
    handleDeleteChat,
    handleStartFirst,
  };
}

export type ConversationApp = ReturnType<typeof useConversationApp>;

/** Helper for message setters typing in consumers. */
export type SetMessages = (updater: Message[] | ((prev: Message[]) => Message[])) => void;
