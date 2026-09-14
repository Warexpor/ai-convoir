import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppStatus,
  Message,
  StatusPayload,
  StreamChunk,
  StreamStart,
} from "../types";
import { isTauri } from "../lib/api";

type FailedTurn = { agent: string; turn: number } | null;

interface StreamBridgeOptions {
  onError: (message: string) => void;
  onNarrationCleared: () => void;
  turnRef: MutableRefObject<number>;
  initialMessages?: Message[];
  initialTurnCount?: number;
}

/**
 * Owns Tauri event subscriptions and merges SSE into the message list.
 * Always unsubscribes on cleanup (StrictMode-safe).
 */
export function useStreamBridge({
  onError,
  onNarrationCleared,
  turnRef,
  initialMessages = [],
  initialTurnCount = 0,
}: StreamBridgeOptions) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [status, setStatus] = useState<AppStatus>("Idle");
  const [turnCount, setTurnCount] = useState(initialTurnCount);
  const [isThinking, setIsThinking] = useState(false);
  const lastFailed = useRef<FailedTurn>(null);
  const lastMsgTime = useRef(Date.now());
  const streamBuf = useRef(new Map<string, string>());
  const streamReasonBuf = useRef(new Map<string, string>());
  const streamRaf = useRef<number | null>(null);

  useEffect(() => {
    if (status !== "Running") {
      setIsThinking(false);
      return;
    }
    const id = setInterval(() => {
      if (Date.now() - lastMsgTime.current > 1200) setIsThinking(true);
    }, 300);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    const unsubs: UnlistenFn[] = [];

    const flushStreamBuf = () => {
      streamRaf.current = null;
      const snap = new Map(streamBuf.current);
      const rsnap = new Map(streamReasonBuf.current);
      if (snap.size === 0 && rsnap.size === 0) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.streaming) return m;
          const k = `${m.agent}:${m.turn}`;
          const content = snap.get(k);
          const reasoning = rsnap.get(k);
          let next = m;
          if (content !== undefined) next = { ...next, content };
          if (reasoning !== undefined)
            next = { ...next, reasoning: reasoning || null };
          return next;
        }),
      );
    };

    const bind = async () => {
      const list = await Promise.all([
        listen<Message>("new-message", (event) => {
          const m = event.payload;
          const k = `${m.agent}:${m.turn}`;
          if (streamRaf.current != null) {
            cancelAnimationFrame(streamRaf.current);
            streamRaf.current = null;
          }
          const streamed = streamBuf.current.get(k) || "";
          const streamedReason = streamReasonBuf.current.get(k) || "";
          streamBuf.current.delete(k);
          streamReasonBuf.current.delete(k);
          setMessages((prev) => {
            const idx = prev.findIndex(
              (x) => x.agent === m.agent && x.turn === m.turn,
            );
            const prevContent = idx >= 0 ? prev[idx].content || "" : streamed;
            const prevReason =
              idx >= 0
                ? prev[idx].reasoning || streamedReason
                : streamedReason;
            const finalContent =
              m.content && m.content.length >= prevContent.length
                ? m.content
                : prevContent.length >= (m.content?.length || 0)
                  ? prevContent
                  : m.content || prevContent;
            const finalReason =
              (m.reasoning &&
              m.reasoning.length >= (prevReason?.length || 0)
                ? m.reasoning
                : prevReason) || null;
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = {
                ...m,
                content: finalContent,
                reasoning: finalReason || undefined,
                streaming: false,
                created_at: next[idx].created_at || m.created_at,
              };
              return next;
            }
            return [
              ...prev,
              {
                ...m,
                content: finalContent,
                reasoning: finalReason || undefined,
                streaming: false,
              },
            ];
          });
          lastMsgTime.current = Date.now();
          setIsThinking(false);
        }),
        listen<StatusPayload>("status-update", (e) => {
          setStatus(e.payload.status as AppStatus);
          setTurnCount(e.payload.turn);
        }),
        listen<string>("error", (e) => {
          onError(e.payload);
          const match = e.payload.match(/^(ai[123])\s+error:/);
          lastFailed.current = match
            ? { agent: match[1], turn: turnRef.current }
            : null;
        }),
        listen<StreamStart>("stream-start", (e) => {
          const { agent, turn } = e.payload;
          setIsThinking(false);
          lastMsgTime.current = Date.now();
          streamBuf.current.set(`${agent}:${turn}`, "");
          streamReasonBuf.current.set(`${agent}:${turn}`, "");
          setMessages((prev) => {
            if (
              prev.some(
                (m) => m.streaming && m.agent === agent && m.turn === turn,
              )
            )
              return prev;
            return [
              ...prev.filter((m) => !(m.streaming && m.agent === agent)),
              {
                agent,
                role: "assistant",
                content: "",
                reasoning: "",
                turn,
                created_at: Date.now(),
                streaming: true,
              },
            ];
          });
        }),
        listen<StreamChunk>("stream-chunk", (e) => {
          const { agent, turn, delta, kind } = e.payload;
          if (!delta) return;
          lastMsgTime.current = Date.now();
          const k = `${agent}:${turn}`;
          if (kind === "reasoning") {
            streamReasonBuf.current.set(
              k,
              (streamReasonBuf.current.get(k) || "") + delta,
            );
          } else {
            streamBuf.current.set(
              k,
              (streamBuf.current.get(k) || "") + delta,
            );
          }
          if (streamRaf.current == null) {
            streamRaf.current = requestAnimationFrame(flushStreamBuf);
          }
        }),
        listen("stream-abort", () => {
          streamBuf.current.clear();
          streamReasonBuf.current.clear();
          if (streamRaf.current != null) {
            cancelAnimationFrame(streamRaf.current);
            streamRaf.current = null;
          }
          setMessages((prev) => prev.filter((m) => !m.streaming));
        }),
        listen("narration-cleared", () => onNarrationCleared()),
        listen("stream-done", () => {
          if (streamRaf.current != null) {
            cancelAnimationFrame(streamRaf.current);
            streamRaf.current = null;
          }
          flushStreamBuf();
        }),
      ]);

      if (cancelled) {
        list.forEach((u) => u());
        return;
      }
      unsubs.push(...list);
    };

    void bind();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
      if (streamRaf.current != null) {
        cancelAnimationFrame(streamRaf.current);
        streamRaf.current = null;
      }
    };
  }, [onError, onNarrationCleared, turnRef]);

  const clearFailed = () => {
    lastFailed.current = null;
  };

  return {
    messages,
    setMessages,
    status,
    setStatus,
    turnCount,
    setTurnCount,
    isThinking,
    setIsThinking,
    lastFailed,
    clearFailed,
  };
}
