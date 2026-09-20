import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { IconChevronDown, IconKey, IconReturn, SlashMark } from "./Marks";
import MessageBubble from "./MessageBubble";
import { pulseScrollBusy } from "../lib/scrollBusy";
import {
  EST_MSG,
  GAP,
  OVERSCAN,
  VIRTUALIZE_AFTER,
  bottomPinnedWindow,
  buildPrefixes,
  computeVirtualWindow,
  estimateMessageHeight,
  nearBottom as nearBottomMetrics,
  scrollAnchorDelta,
  slicePads,
} from "../lib/chatVirtual";
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

function msgKey(msg: Message, idx: number) {
  return `${msg.agent}-${msg.turn}-${msg.created_at || idx}`;
}

function nearBottom(el: HTMLElement) {
  return nearBottomMetrics(el.scrollHeight, el.scrollTop, el.clientHeight);
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
  const thoughtsOpenRef = useRef(new Map<string, boolean>());
  const measureRaf = useRef(0);
  const scrollRaf = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const winRef = useRef({ start: 0, end: messages.length });
  const prefixesRef = useRef<number[]>([0]);
  const pendingAnchorRef = useRef<{
    prevPrefixes: number[];
    anchor: number;
    prevTop: number;
    wasAuto: boolean;
  } | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [win, setWin] = useState({ start: 0, end: messages.length });
  const [heightTick, setHeightTick] = useState(0);

  const virtualize = messages.length >= VIRTUALIZE_AFTER;
  const streamingTail = messages[messages.length - 1];
  const streamLive = !!streamingTail?.streaming;
  const streamSig = streamLive
    ? streamingTail.content.length + (streamingTail.reasoning?.length ?? 0)
    : 0;

  const heightOf = useCallback(
    (i: number) => {
      const m = messages[i];
      if (!m) return EST_MSG + GAP;
      const key = msgKey(m, i);
      const measured = heightsRef.current.get(key);
      if (measured != null) return measured + GAP;
      const open = thoughtsOpenRef.current.get(key) === true;
      return estimateMessageHeight(m, open) + GAP;
    },
    [messages, heightTick],
  );

  const prefixes = useMemo(() => {
    const p = buildPrefixes(messages.length, heightOf);
    return p;
  }, [messages, heightOf]);

  useLayoutEffect(() => {
    prefixesRef.current = prefixes;
  }, [prefixes]);

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
    (el: HTMLElement, pinEnd: boolean) => {
      if (!virtualize) {
        applyWin(0, messages.length);
        return;
      }
      const next = computeVirtualWindow({
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        count: messages.length,
        prefixes: prefixesRef.current,
        overscan: OVERSCAN,
        pinEnd,
      });
      applyWin(next.start, next.end);
    },
    [applyWin, messages.length, virtualize],
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

  // Layout phase: avoid one-frame jumps when tokens append at bottom.
  useLayoutEffect(() => {
    if (!autoScrollRef.current) return;
    stickToBottom(false);
  }, [messages.length, streamSig, isThinking, autoScroll, heightTick, stickToBottom]);

  // After measured heights rebuild pads, keep stick OR anchor scrollTop.
  useLayoutEffect(() => {
    const pending = pendingAnchorRef.current;
    if (!pending) return;
    pendingAnchorRef.current = null;
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (pending.wasAuto || autoScrollRef.current) {
      stickToBottom(false);
      return;
    }
    const delta = scrollAnchorDelta(
      pending.prevPrefixes,
      prefixes,
      pending.anchor,
    );
    if (delta !== 0) scroller.scrollTop = pending.prevTop + delta;
  }, [heightTick, prefixes, stickToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!virtualize) {
      applyWin(0, messages.length);
      return;
    }
    if (autoScroll) {
      const pinned = bottomPinnedWindow(messages.length, el.clientHeight);
      applyWin(pinned.start, pinned.end);
      return;
    }
    computeWindow(el, false);
    // Intentionally omit streamSig: token appends must not recompute the
    // window while the user has scrolled up (avoids fighting their position).
  }, [
    messages.length,
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
      if (!key) return "none" as const;
      const open = el.dataset.thoughtsOpen === "1";
      thoughtsOpenRef.current.set(key, open);
      const h = Math.round(el.getBoundingClientRect().height);
      if (heightsRef.current.get(key) === h) return "none" as const;
      heightsRef.current.set(key, h);
      // Streaming rows change every token; keep the map warm but avoid a
      // prefixes rebuild on every SSE chunk (stick uses real scrollHeight).
      if (el.dataset.streaming === "1") return "stream" as const;
      return "stable" as const;
    };

    const schedule = () => {
      if (measureRaf.current) return;
      measureRaf.current = requestAnimationFrame(() => {
        measureRaf.current = 0;
        const el = scrollRef.current;
        pendingAnchorRef.current = {
          prevPrefixes: prefixesRef.current.slice(),
          anchor: winRef.current.start,
          prevTop: el?.scrollTop ?? 0,
          wasAuto: autoScrollRef.current,
        };
        setHeightTick((n) => n + 1);
      });
    };

    const ro = new ResizeObserver((entries) => {
      let stable = false;
      let stream = false;
      for (const entry of entries) {
        const kind = apply(entry.target as HTMLElement);
        if (kind === "stable") stable = true;
        else if (kind === "stream") stream = true;
      }
      if (stable) schedule();
      else if (stream && autoScrollRef.current) {
        // Live bubble grew: stick without rebuilding all row pads.
        stickToBottom(false);
      }
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
  }, [virtualize, stickToBottom]);

  useEffect(() => {
    if (!virtualize || streamLive) return;
    if (measureRaf.current) return;
    measureRaf.current = requestAnimationFrame(() => {
      measureRaf.current = 0;
      setHeightTick((n) => n + 1);
    });
  }, [virtualize, messages.length, streamLive]);

  const jumpLatest = useCallback(() => {
    applyAutoScroll(true);
    requestAnimationFrame(() => stickToBottom(true));
  }, [applyAutoScroll, stickToBottom]);

  const onThoughtsOpenChange = useCallback(
    (key: string, open: boolean) => {
      thoughtsOpenRef.current.set(key, open);
      // Nudge estimate immediately so pads don't lag a full RO cycle badly.
      if (!virtualize) return;
      if (measureRaf.current) return;
      measureRaf.current = requestAnimationFrame(() => {
        measureRaf.current = 0;
        setHeightTick((n) => n + 1);
      });
    },
    [virtualize],
  );

  const { slice, sliceStart, topPad, bottomPad } = useMemo(() => {
    if (!virtualize) {
      return {
        slice: messages,
        sliceStart: 0,
        topPad: 0,
        bottomPad: 0,
      };
    }
    // Stick-to-bottom (and only then) pins the live streaming row + caret.
    // Scrolled-up users keep a normal window so we do not mount the whole tail.
    const end = autoScroll
      ? messages.length
      : Math.min(Math.max(win.end, win.start + 1), messages.length);
    const start = Math.min(win.start, Math.max(0, end - 1));
    const pads = slicePads(messages.length, start, end, prefixes);
    return {
      slice: messages.slice(start, end),
      sliceStart: start,
      topPad: pads.topPad,
      bottomPad: pads.bottomPad,
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
          <SlashMark className="empty-logo" size={56} />
          <h2 className="empty-brand">AI ConvoIR</h2>
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
                  disabled={!firstDraft.trim() && !config?.seed_prompt?.trim()}
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
        aria-busy={isThinking || streamLive}
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
                  data-thoughts-open={
                    thoughtsOpenRef.current.get(key) ? "1" : "0"
                  }
                >
                  <MessageBubble
                    message={msg}
                    config={config}
                    showThoughtsUi={showThoughtsUi}
                    onDelete={onDeleteMessage}
                    enter={idx === messages.length - 1}
                    onThoughtsOpenChange={(open) => {
                      const row = listRef.current?.querySelector(
                        `[data-msg-key="${CSS.escape(key)}"]`,
                      ) as HTMLElement | null;
                      if (row) row.dataset.thoughtsOpen = open ? "1" : "0";
                      onThoughtsOpenChange(key, open);
                    }}
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
