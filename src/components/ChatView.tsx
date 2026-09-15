import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconChevronDown, IconKey, IconReturn, SlashMark } from "./Marks";
import MessageBubble from "./MessageBubble";
import { pulseScrollBusy } from "../lib/scrollBusy";
import type { InnerState, Message } from "../types";

interface Props {
  messages: Message[];
  isThinking: boolean;
  thinkingAgent?: string | null;
  config?: InnerState | null;
  showThoughtsUi?: boolean;
  onStartFirst?: (text: string) => void;
  firstDraft?: string;
  onFirstDraftChange?: (t: string) => void;
  onDeleteMessage?: (agent: string, turn: number, created_at: number) => void;
  hasSavedChats?: boolean;
  needsKey?: boolean;
  onOpenSettings?: () => void;
  agentNames?: string[];
}

const EST_MSG = 168;
const GAP = 28;
const OVERSCAN = 6;
const VIRTUALIZE_AFTER = 16;
const NEAR_PX = 96;

function msgKey(msg: Message, idx: number) {
  return `${msg.agent}-${msg.turn}-${msg.created_at || idx}`;
}

function nearBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_PX;
}

function ChatView({
  messages,
  isThinking,
  thinkingAgent,
  config,
  showThoughtsUi = true,
  onStartFirst,
  firstDraft = "",
  onFirstDraftChange,
  onDeleteMessage,
  hasSavedChats = false,
  needsKey = false,
  onOpenSettings,
  agentNames = ["Ava", "Jules"],
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const heightsRef = useRef(new Map<string, number>());
  const measureRaf = useRef(0);
  const scrollRaf = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const winRef = useRef({ start: 0, end: messages.length });
  const [autoScroll, setAutoScroll] = useState(true);
  const [win, setWin] = useState({ start: 0, end: messages.length });
  const [heightTick, setHeightTick] = useState(0);

  const virtualize = messages.length >= VIRTUALIZE_AFTER;
  const streamingTail = messages[messages.length - 1];
  const streamSig = streamingTail?.streaming
    ? streamingTail.content.length + (streamingTail.reasoning?.length ?? 0)
    : 0;

  const heightOf = useCallback(
    (i: number) => {
      const m = messages[i];
      if (!m) return EST_MSG + GAP;
      return (heightsRef.current.get(msgKey(m, i)) ?? EST_MSG) + GAP;
    },
    [messages, heightTick],
  );

  const prefixes = useMemo(() => {
    const p = new Array<number>(messages.length + 1);
    p[0] = 0;
    for (let i = 0; i < messages.length; i++) p[i + 1] = p[i] + heightOf(i);
    return p;
  }, [messages, heightOf]);

  const applyWin = useCallback((start: number, end: number) => {
    const prev = winRef.current;
    if (prev.start === start && prev.end === end) return;
    const next = { start, end };
    winRef.current = next;
    setWin(next);
  }, []);

  const applyAutoScroll = useCallback((next: boolean) => {
    if (autoScrollRef.current === next) return;
    autoScrollRef.current = next;
    setAutoScroll(next);
  }, []);

  const computeWindow = useCallback(
    (el: HTMLElement, atBottom: boolean) => {
      if (!virtualize) {
        applyWin(0, messages.length);
        return;
      }
      const top = el.scrollTop;
      let lo = 0;
      let hi = messages.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (prefixes[mid] < top) lo = mid + 1;
        else hi = mid;
      }
      const start = Math.max(0, lo - 1 - OVERSCAN);
      const limit = top + el.clientHeight;
      let end = start;
      while (end < messages.length && prefixes[end] < limit) end++;
      end = Math.min(messages.length, end + OVERSCAN);
      if (atBottom) end = messages.length;
      applyWin(start, end);
    },
    [applyWin, messages.length, prefixes, virtualize],
  );

  const onScroll = useCallback(() => {
    pulseScrollBusy();
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      const el = scrollRef.current;
      if (!el) return;
      const atBottom = nearBottom(el);
      applyAutoScroll(atBottom);
      if (virtualize) computeWindow(el, atBottom);
    });
  }, [applyAutoScroll, computeWindow, virtualize]);

  const stickToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (!autoScroll) return;
    stickToBottom(false);
  }, [messages.length, streamSig, isThinking, autoScroll, stickToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!virtualize) {
      applyWin(0, messages.length);
      return;
    }
    if (autoScroll) {
      const visible = Math.ceil(el.clientHeight / EST_MSG) + OVERSCAN * 2;
      applyWin(
        Math.max(0, messages.length - visible),
        messages.length,
      );
      return;
    }
    computeWindow(el, false);
  }, [
    messages.length,
    streamSig,
    autoScroll,
    virtualize,
    applyWin,
    computeWindow,
  ]);

  useEffect(() => {
    return () => {
      if (measureRaf.current) cancelAnimationFrame(measureRaf.current);
      if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    };
  }, []);

  useEffect(() => {
    if (!virtualize) return;
    const root = listRef.current;
    if (!root) return;

    const apply = (el: HTMLElement) => {
      const key = el.dataset.msgKey;
      if (!key) return false;
      const h = Math.round(el.getBoundingClientRect().height);
      if (heightsRef.current.get(key) === h) return false;
      heightsRef.current.set(key, h);
      return el.dataset.streaming !== "1";
    };

    const schedule = () => {
      if (measureRaf.current) return;
      measureRaf.current = requestAnimationFrame(() => {
        measureRaf.current = 0;
        setHeightTick((n) => n + 1);
      });
    };

    const ro = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        if (apply(entry.target as HTMLElement)) changed = true;
      }
      if (changed) schedule();
    });

    const observed = new Set<HTMLElement>();
    const observeAll = () => {
      const next = new Set<HTMLElement>();
      for (const el of root.querySelectorAll<HTMLElement>("[data-msg-key]")) {
        next.add(el);
        if (!observed.has(el)) ro.observe(el);
      }
      for (const el of observed) {
        if (!next.has(el)) ro.unobserve(el);
      }
      observed.clear();
      next.forEach((el) => observed.add(el));
    };
    observeAll();

    const mo = new MutationObserver(observeAll);
    mo.observe(root, { childList: true, subtree: false });

    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, [virtualize]);

  useEffect(() => {
    if (!virtualize || streamingTail?.streaming) return;
    if (measureRaf.current) return;
    measureRaf.current = requestAnimationFrame(() => {
      measureRaf.current = 0;
      setHeightTick((n) => n + 1);
    });
  }, [virtualize, messages.length, streamingTail?.streaming]);

  const jumpLatest = useCallback(() => {
    applyAutoScroll(true);
    requestAnimationFrame(() => stickToBottom(true));
  }, [applyAutoScroll, stickToBottom]);

  const { slice, sliceStart, topPad, bottomPad } = useMemo(() => {
    if (!virtualize) {
      return {
        slice: messages,
        sliceStart: 0,
        topPad: 0,
        bottomPad: 0,
      };
    }
    const end = autoScroll
      ? messages.length
      : Math.min(Math.max(win.end, win.start + 1), messages.length);
    const start = Math.min(win.start, Math.max(0, end - 1));
    return {
      slice: messages.slice(start, end),
      sliceStart: start,
      topPad: prefixes[start] ?? start * (EST_MSG + GAP),
      bottomPad: Math.max(
        0,
        (prefixes[messages.length] ?? 0) - (prefixes[end] ?? 0),
      ),
    };
  }, [messages, win.start, win.end, autoScroll, virtualize, prefixes]);

  if (messages.length === 0) {
    const names = agentNames.filter(Boolean).slice(0, 3);
    const roster =
      names.length === 3
        ? `${names[0]}, ${names[1]}, and ${names[2]}`
        : `${names[0] || "Ava"} and ${names[1] || "Jules"}`;
    return (
      <div className="empty">
        <div className="empty-hero">
          <SlashMark className="empty-logo" size={48} />
          <div className="empty-badge">OpenCode Go</div>
          <h2>Start a thread</h2>
          <p>
            {roster} take turns.{" "}
            {needsKey
              ? "Add your key, then write the first line."
              : "Write the first line and press Begin."}
            {hasSavedChats ? " Saved threads live in Chats." : ""}
          </p>
          <div className="empty-box">
            <textarea
              value={firstDraft}
              onChange={(e) => onFirstDraftChange?.(e.target.value)}
              placeholder="A question, a scene, or an opening line."
              aria-label="First message"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (needsKey) onOpenSettings?.();
                  else onStartFirst?.(firstDraft);
                }
              }}
            />
            <div className="empty-actions">
              <span className="empty-kbd" aria-hidden>
                <kbd>Ctrl</kbd>
                <kbd>Enter</kbd>
              </span>
              {needsKey ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onOpenSettings?.()}
                >
                  <IconKey />
                  Add your key
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!firstDraft.trim()}
                  onClick={() => onStartFirst?.(firstDraft)}
                >
                  Begin
                  <IconReturn />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-wrap">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="chat"
        aria-busy={isThinking || !!streamingTail?.streaming}
      >
        <div className="chat-inner">
          {topPad > 0 && (
            <div
              className="chat-spacer"
              style={{ height: topPad }}
              aria-hidden
            />
          )}
          <div
            ref={listRef}
            className={`chat-list ${virtualize ? "is-virt" : ""}`}
          >
            {slice.map((msg, i) => {
              const idx = sliceStart + i;
              const key = msgKey(msg, idx);
              return (
                <div
                  key={key}
                  data-msg-key={key}
                  data-streaming={msg.streaming ? "1" : "0"}
                >
                  <MessageBubble
                    message={msg}
                    config={config}
                    showThoughtsUi={showThoughtsUi}
                    onDelete={onDeleteMessage}
                    enter={
                      !virtualize || idx >= messages.length - 1
                    }
                  />
                </div>
              );
            })}
            {isThinking && (
              <div className="thinking" role="status">
                <span className="d" />
                <span className="d" style={{ animationDelay: "0.2s" }} />
                <span className="d" style={{ animationDelay: "0.4s" }} />
                {thinkingAgent ? `${thinkingAgent}` : "Writing"}
              </div>
            )}
          </div>
          {bottomPad > 0 && (
            <div
              className="chat-spacer"
              style={{ height: bottomPad }}
              aria-hidden
            />
          )}
          {!autoScroll && (
            <div className="jump-latest-space" aria-hidden />
          )}
        </div>
      </div>
      {!autoScroll && (
        <button type="button" className="jump-latest" onClick={jumpLatest}>
          <IconChevronDown />
          Latest
        </button>
      )}
    </div>
  );
}

export default memo(ChatView);
