import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationMode, InnerState, Message } from "../types";
import * as api from "../lib/api";
import { log } from "../lib/log";
import {
  defaultConfig,
  loadPersistedConfig,
  mergePersisted,
  legacyKeyOf,
  missingApiKeys,
  missingProviderNames,
  normalizeConfig,
  persistConfig,
} from "../lib/config";
import {
  clearCastIdFromChats,
  deleteChat,
  getActiveChatId,
  getChat,
  hydrateChats,
  loadChat,
  listChats,
  saveChatSnapshot,
  setActiveChatId,
  type SavedChat,
} from "../lib/storage";
import {
  applyCast,
  createCast,
  deleteCast,
  ensureDefaultCast,
  getActiveCastId,
  getCast,
  listCasts,
  renameCast,
  setActiveCastId as persistActiveCastId,
  syncCastFromConfig,
  type Cast,
} from "../lib/casts";
import { agentLabel } from "../types";
import {
  hasProviderKey,
  loadProviderKeys,
  onProviderKeysChanged,
  setProviderKey,
} from "../lib/secrets";
import { useStreamBridge } from "./useStreamBridge";
import { useToast } from "./useToast";

const SKIP_RESUME_KEY = "ai-convoir-skip-resume";
const LEGACY_SKIP_RESUME_KEY = "ai-conversation-skip-resume";

function pickResumeChat(): SavedChat | undefined {
  if (typeof localStorage !== "undefined" && (localStorage.getItem(SKIP_RESUME_KEY) || localStorage.getItem(LEGACY_SKIP_RESUME_KEY))) {
    return undefined;
  }
  const aid = getActiveChatId();
  const byId = aid ? getChat(aid) : undefined;
  if (byId && byId.messages.length > 0) return byId;
  return listChats().find((c) => c.messages.length > 0);
}

/** Overlay SavedChat fields onto a config base (boot resume / hydrate re-seed). */
function configFromSavedChat(base: InnerState, chat: SavedChat): InnerState {
  return {
    ...base,
    ai1_config: chat.ai1_config,
    ai2_config: chat.ai2_config,
    ai3_config: chat.ai3_config,
    bot_count: chat.bot_count,
    messages: chat.messages,
    turn_count: chat.turn_count,
    max_turns: chat.max_turns,
    delay_ms: chat.delay_ms,
    mode: chat.mode,
    seed_prompt: chat.seed_prompt,
  };
}

/**
 * Prefer bootResume.current when it is a newer snapshot of the same chat id
 * as `captured` (hydrate re-seed replaces the ref after pickResumeChat).
 */
function freshestResume(
  captured: SavedChat | undefined,
  current: SavedChat | undefined,
): SavedChat | undefined {
  if (!captured) return undefined;
  if (current && current.id === captured.id && current !== captured) return current;
  return captured;
}

export function useConversationApp() {
  const bootResume = useRef(pickResumeChat());
  /** Chat id hydrate intends to / has SoT re-seeded; boot must not loadTranscript over it. */
  const hydrateSeededChatId = useRef<string | null>(null);
  const toast = useToast();
  const turnRef = useRef(0);
  const [narration, setNarration] = useState("");
  const onNarrationCleared = useCallback(() => setNarration(""), []);
  const onStreamError = useCallback(
    (msg: string) => {
      log.error(msg, "stream");
      toast.show(msg, 9000);
    },
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
  const [casts, setCasts] = useState<Cast[]>(() => listCasts());
  const [activeCastId, setActiveCastIdState] = useState<string | null>(
    () => bootResume.current?.cast_id ?? getActiveCastId(),
  );
  const castIdRef = useRef(activeCastId);
  castIdRef.current = activeCastId;
  const skipAutosaveUntil = useRef(0);
  const messagesRef = useRef(stream.messages);
  const configRef = useRef(config);
  const chatIdRef = useRef(activeChatId);
  messagesRef.current = stream.messages;
  configRef.current = config;
  chatIdRef.current = activeChatId;

  // Key edits change readiness and the engine's runtime keys, not the config.
  const [, setKeysTick] = useState(0);
  useEffect(
    () =>
      onProviderKeysChanged(() => {
        setKeysTick((n) => n + 1);
        const cfg = configRef.current;
        if (cfg) void api.updateConfig(cfg).catch(() => {});
      }),
    [],
  );

  const pushConfig = useCallback(async (cfg: InnerState) => {
    const n = normalizeConfig(cfg);
    await api.updateConfig(n);
    setConfig(n);
    persistConfig(n);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await hydrateChats();
      if (cancelled) return;
      setChats(list);

      // pickResumeChat() read localStorage before this hydrate; re-seed the
      // open / resume transcript from SoT (get_saved_chat) so table wins.
      const skip =
        typeof localStorage !== "undefined" &&
        !!(
          localStorage.getItem(SKIP_RESUME_KEY) ||
          localStorage.getItem(LEGACY_SKIP_RESUME_KEY)
        );
      if (skip) return;

      const targetId =
        chatIdRef.current ??
        bootResume.current?.id ??
        getActiveChatId();
      if (!targetId) return;
      if (messagesRef.current.some((m) => m.streaming)) return;

      // Mark BEFORE loadChat await: boot must not pass hydrateSeededChatId and
      // start stale loadTranscript while we are still fetching SoT. Clear if we
      // abandon so boot can still resume from LS.
      const clearPendingSeed = (id: string) => {
        if (hydrateSeededChatId.current === id) hydrateSeededChatId.current = null;
      };
      hydrateSeededChatId.current = targetId;

      const chat = await loadChat(targetId);
      if (cancelled || !chat) {
        clearPendingSeed(targetId);
        return;
      }
      // Help in-flight boot() pick SoT if it still reads bootResume.current.
      bootResume.current = chat;
      if (chatIdRef.current && chatIdRef.current !== targetId) {
        clearPendingSeed(targetId);
        return;
      }
      // Streaming: keep mark so boot also skips stale LS over a live stream.
      if (messagesRef.current.some((m) => m.streaming)) return;

      // Don't clobber a live engine transcript that already grew past snapshot.
      // Empty SoT still wins (clears stale LS); only skip when SoT is non-empty
      // and live is strictly longer (in-session engine ahead). Keep the early
      // mark so boot also skips loading a shorter LS over longer live.
      const live = messagesRef.current.filter((m) => !m.streaming);
      if (chat.messages.length > 0 && live.length > chat.messages.length) return;

      skipAutosaveUntil.current = Date.now() + 2500;
      // Keep / refresh mark (already set early) for boot's skip + post-await recheck.
      hydrateSeededChatId.current = chat.id;
      setActiveChatId(chat.id);
      setActiveChatIdState(chat.id);
      chatIdRef.current = chat.id;
      stream.setMessages(chat.messages);
      stream.setTurnCount(chat.turn_count);
      setFirstDraft(chat.seed_prompt || "");
      setChats(listChats());
      // Refresh engine config from SoT (mirror select-chat) so a stale boot
      // pushConfig that already ran — or still will — does not leave LS merge.
      const base = configRef.current ?? defaultConfig();
      try {
        await pushConfig(configFromSavedChat({ ...base, status: "Idle" }, chat));
      } catch {
        /* web / no tauri */
      }
      if (cancelled) return;
      try {
        await api.loadTranscript({
          messages: chat.messages,
          turnCount: chat.turn_count,
          chatId: chat.id,
        });
      } catch {
        /* web / no tauri */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Boot-time hydrate once; stream setters / pushConfig are stable here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshChats = useCallback(() => setChats(listChats()), []);

  const selectCast = useCallback((id: string | null) => {
    persistActiveCastId(id);
    castIdRef.current = id;
    setActiveCastIdState(id);
  }, []);

  useEffect(() => {
    const onChange = () => setCasts(listCasts());
    window.addEventListener("casts-changed", onChange);
    return () => window.removeEventListener("casts-changed", onChange);
  }, []);

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
      castIdRef.current,
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
          loadProviderKeys(),
        ]);
        if (cancelled) return;

        // One-time upgrade: the single per-voice key moves into the provider
        // key store before normalizeConfig strips keys from config.
        const legacy = legacyKeyOf(cfg) ?? legacyKeyOf(loadPersistedConfig());
        if (legacy && !hasProviderKey(legacy.provider)) {
          await setProviderKey(legacy.provider, legacy.key, { silent: true });
        }

        // Capture after first await; hydrate may already have swapped SoT in.
        let resume = msgs.length > 0 ? undefined : bootResume.current;
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

        // Re-read before merge/pushConfig: hydrate re-seed may have replaced
        // bootResume during the getMessages window with a fresher SoT snap.
        resume = freshestResume(resume, bootResume.current);

        let merged = normalizeConfig(cfg ?? defaultConfig());
        merged = mergePersisted(merged, loadPersistedConfig());
        if (resume) {
          merged = configFromSavedChat(merged, resume);
        }
        const fallbackCast = ensureDefaultCast(merged);
        const resumeCast = resume ? getCast(resume.cast_id) : undefined;
        selectCast(
          resume
            ? (resumeCast?.id ?? null)
            : (getCast(castIdRef.current)?.id ?? fallbackCast.id),
        );
        if (cfg || resume) await pushConfig(merged);
        else {
          setConfig(merged);
          await api.updateConfig(merged);
          // Rewrites any legacy copy that still carried the key.
          if (legacy) persistConfig(merged);
        }
        if (cancelled) return;

        // After pushConfig await: hydrate may have re-seeded SoT. Never
        // loadTranscript a resume older than bootResume.current for same id;
        // if hydrate already seeded that id, skip boot transcript load entirely.
        resume = freshestResume(resume, bootResume.current);
        if (!resume) {
          const skipped =
            typeof localStorage !== "undefined" &&
            !!(localStorage.getItem(SKIP_RESUME_KEY) || localStorage.getItem(LEGACY_SKIP_RESUME_KEY));
          setFirstDraft(skipped ? "" : merged.seed_prompt || "");
        } else if (hydrateSeededChatId.current === resume.id) {
          // Re-seed won: UI+engine already on SoT. If our pushConfig used a
          // stale capture, refresh config from the freshest snapshot.
          const seeded = bootResume.current;
          if (seeded && seeded.id === resume.id) {
            try {
              await pushConfig(
                configFromSavedChat({ ...merged, status: "Idle" }, seeded),
              );
            } catch {
              /* web / no tauri */
            }
          }
        } else {
          if (messagesRef.current.some((m) => m.streaming)) return;
          const live = messagesRef.current.filter((m) => !m.streaming);
          // Mirror hydrate ahead-guard: don't clobber a longer live transcript.
          if (resume.messages.length > 0 && live.length > resume.messages.length) {
            return;
          }
          // Final gate before firing: hydrate may have marked during pushConfig.
          if (hydrateSeededChatId.current === resume.id) {
            const seeded = bootResume.current;
            if (seeded && seeded.id === resume.id) {
              try {
                await pushConfig(
                  configFromSavedChat({ ...merged, status: "Idle" }, seeded),
                );
              } catch {
                /* web / no tauri */
              }
            }
            return;
          }
          const bootLoadId = resume.id;
          try {
            await api.loadTranscript({
              messages: resume.messages,
              turnCount: resume.turn_count,
              chatId: bootLoadId,
            });
          } catch {
            /* web / no tauri */
          }
          // After await: hydrate may have SoT-loaded meanwhile. Ignore stale
          // engine write by re-applying freshest SoT (also bumps BE save epoch).
          if (hydrateSeededChatId.current === bootLoadId) {
            const sot = bootResume.current;
            if (sot && sot.id === bootLoadId) {
              try {
                await api.loadTranscript({
                  messages: sot.messages,
                  turnCount: sot.turn_count,
                  chatId: sot.id,
                });
              } catch {
                /* web / no tauri */
              }
              stream.setMessages(sot.messages);
              stream.setTurnCount(sot.turn_count);
            }
          }
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
      log.info("stop requested", "session");
      await api.stopConversation();
      stream.setStatus("Idle");
      stream.setIsThinking(false);
      stream.setMessages((prev) => prev.filter((m) => !m.streaming));
      autoSave();
    } catch (e) {
      log.error(String(e), "session");
      toast.show(String(e));
    }
  }, [
    autoSave,
    stream.setStatus,
    stream.setIsThinking,
    stream.setMessages,
    toast,
  ]);

  const handleReset = useCallback(async (castId?: string) => {
    try {
      const msgs = messagesRef.current.filter((m) => !m.streaming);
      if (msgs.length > 0) autoSave();
      // A new thread always lives in a cast: the one asked for, else the
      // active one, else the first. Its voices become the live config.
      const cast =
        getCast(castId) ?? getCast(castIdRef.current) ?? listCasts()[0];
      if (cast) {
        selectCast(cast.id);
        const cfg = configRef.current;
        if (cfg) await pushConfig(applyCast(cfg, cast));
      }
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
      setFirstDraft(configRef.current?.seed_prompt || "");
      setActiveChatId(null);
      setActiveChatIdState(null);
      chatIdRef.current = null;
      refreshChats();
    } catch (e) {
      toast.show(String(e));
    }
  }, [
    autoSave,
    pushConfig,
    refreshChats,
    selectCast,
    stream.setMessages,
    stream.setTurnCount,
    stream.setStatus,
    toast,
  ]);

  /** Settings saves also update the active cast, so future threads inherit. */
  const handleSaveSettings = useCallback(
    async (cfg: InnerState) => {
      await pushConfig(cfg);
      if (castIdRef.current) syncCastFromConfig(castIdRef.current, cfg);
    },
    [pushConfig],
  );

  const handleCreateCast = useCallback(
    async (name: string) => {
      const cfg = configRef.current;
      if (!cfg) return;
      const cast = createCast(name, cfg);
      await handleReset(cast.id);
      toast.show(`New cast “${cast.name}”. Tweak the voices in Voices.`, 3200);
      return cast;
    },
    [handleReset, toast],
  );

  const handleRenameCast = useCallback((id: string, name: string) => {
    renameCast(id, name);
  }, []);

  const handleDeleteCast = useCallback(
    (id: string) => {
      deleteCast(id);
      clearCastIdFromChats(id);
      if (castIdRef.current === id) selectCast(listCasts()[0]?.id ?? null);
      refreshChats();
      toast.show("Cast deleted. Its threads moved to Unsorted.", 2600);
    },
    [refreshChats, selectCast, toast],
  );

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
      const outcome = await api.exportChat(md);
      switch (outcome.kind) {
        case "shared":
          toast.show("Shared chat", 4000);
          break;
        case "share-dismissed":
          // User closed the share sheet — no false "Exported to …" toast.
          break;
        case "downloaded":
          toast.show(`Downloaded ${outcome.name}`, 5000);
          break;
        case "saved":
          toast.show(`Exported to ${outcome.path}`, 5000);
          break;
      }
    } catch (e) {
      toast.show(`Export failed: ${e}`);
    }
  }, [stream.messages, config, toast]);

  const handleDeleteMessage = useCallback(
    async (agent: string, turn: number, created_at: number) => {
      try {
        const removed = await api.deleteMessage({ agent, turn, created_at });
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
        if (!removed) {
          toast.show("Message was already gone on the server.", 2800);
        }
      } catch (e) {
        toast.show(`Delete failed: ${e}`);
      }
    },
    [stream.setMessages, toast],
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
  }, [stream.lastFailed, stream.clearFailed, toast]);

  const handleSaveChat = useCallback(() => {
    autoSave();
    toast.show("Chat saved.", 1500);
  }, [autoSave, toast]);

  const handleSelectChat = useCallback(
    async (id: string) => {
      const chat = await loadChat(id);
      if (!chat) return;
      const current = messagesRef.current.filter((m) => !m.streaming);
      if (current.length > 0 && chatIdRef.current !== id) autoSave();
      try {
        localStorage.removeItem(SKIP_RESUME_KEY);
        localStorage.removeItem(LEGACY_SKIP_RESUME_KEY);
      } catch {
        /* quota */
      }
      setActiveChatId(chat.id);
      setActiveChatIdState(chat.id);
      chatIdRef.current = chat.id;
      selectCast(getCast(chat.cast_id)?.id ?? null);
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
    [
      autoSave,
      pushConfig,
      selectCast,
      stream.setMessages,
      stream.setTurnCount,
      stream.setStatus,
      toast,
    ],
  );

  const handleDeleteChat = useCallback(
    async (id: string) => {
      skipAutosaveUntil.current = Date.now() + 2500;
      const wasActive = activeChatId === id || chatIdRef.current === id;
      if (wasActive) {
        await api.stopConversation().catch(() => undefined);
      }
      deleteChat(id);
      if (wasActive) {
        setActiveChatIdState(null);
        chatIdRef.current = null;
        setActiveChatId(null);
        void api.setActiveChat("");
        stream.setMessages([]);
        stream.setTurnCount(0);
        stream.setStatus("Idle");
        setNarration("");
        setFirstDraft(configRef.current?.seed_prompt || "");
        // reset also clears BE active_chat_id; setActiveChat("") covers the
        // window before reset lands so prepare cannot capture the deleted id.
        void api.resetConversation();
      }
      refreshChats();
      toast.show("Chat deleted.", 1800);
    },
    [
      activeChatId,
      refreshChats,
      stream.setMessages,
      stream.setTurnCount,
      stream.setStatus,
      toast,
    ],
  );

  const handleStartFirst = useCallback(
    async (text: string) => {
      if (!config) return;
      const trimmed = text.trim();
      if (!trimmed) {
        toast.show("Write a first line.", 2200);
        return;
      }
      setFirstDraft(trimmed);
      try {
        localStorage.removeItem(SKIP_RESUME_KEY);
        localStorage.removeItem(LEGACY_SKIP_RESUME_KEY);
      } catch {
        /* quota */
      }
      if (missingApiKeys(config)) {
        const names = missingProviderNames(config);
        toast.show(
          `Add your ${names.join(" and ") || "provider"} key in Settings, then press Begin.`,
          6000,
        );
        return { needSettings: true as const };
      }
      // Inject the opening line for this run only — do not persist it as
      // Settings → Default first line.
      try {
        await api.updateConfig({ ...config, seed_prompt: trimmed });
        if (config.mode === "step") await api.stepConversation();
        else await api.startConversation();
      } catch (e) {
        toast.show(String(e));
      } finally {
        try {
          await api.updateConfig(config);
        } catch {
          /* restore is best-effort */
        }
      }
      return { needSettings: false as const };
    },
    [config, toast],
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
    casts,
    activeCastId,
    handleSaveSettings,
    handleCreateCast,
    handleRenameCast,
    handleDeleteCast,
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
