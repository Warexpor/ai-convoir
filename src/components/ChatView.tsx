import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconChevronDown, IconKey, IconReturn, IconSpark } from "./Marks";
import MessageBubble from "./MessageBubble";
import { pulseScrollBusy } from "../lib/scrollBusy";
import type { InnerState, Message } from "../types";
import {
  activeAgentIds,
  agentAccent,
  agentConfig,
  agentLabel,
} from "../types";
import VoiceAvatar from "./VoiceAvatar";

interface Props {
  messages: Message[];
  isThinking: boolean;
  thinkingAgent?: string | null;
  thinkingAgentId?: string | null;
  config?: InnerState | null;
  showThoughtsUi?: boolean;
  onStartFirst?: (text: string) => void;
  firstDraft?: string;
  onFirstDraftChange?: (t: string) => void;
  onDeleteMessage?: (agent: string, turn: number, created_at: number) => void;
  hasSavedChats?: boolean;
  needsKey?: boolean;
  onOpenSettings?: () => void;
}

const STARTERS: { label: string; text: string }[] = [
  {
    label: "Diner at 3am",
    text: "Two friends wake up in a diner at 3am. The jukebox only plays songs that already happened.",
  },
  {
    label: "Lobby critics",
    text: "Two theater critics argue in the lobby about a play that has not started.",
  },
  {
    label: "Night train",
    text: "A quiet night train. Two strangers share a window and a secret.",
  },
  {
    label: "Ship's AI",
    text: "The ship's AI has to explain to the crew why it quietly changed course six days ago.",
  },
  {
    label: "Hard debate",
    text: "Settle it properly: is a hot dog a sandwich? Open with your strongest argument.",
  },
];

function firstSentence(prompt: string) {
  const clean = prompt.replace(/^You are [^—–-]+[—–-]\s*/i, "").trim();
  const cut = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  return cut.length > 72 ? `${cut.slice(0, 70).trimEnd()}…` : cut;
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
  thinkingAgentId,
  config,
  showThoughtsUi = true,
  onStartFirst,
  firstDraft = "",
  onFirstDraftChange,
  onDeleteMessage,
  hasSavedChats = false,
  needsKey = false,
  onOpenSettings,
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
    const ids = activeAgentIds(config ?? null);
    const begin = () => {
      if (needsKey) onOpenSettings?.();
      else if (firstDraft.trim()) onStartFirst?.(firstDraft);
    };
    return (
      <div className="empty">
        <div className="empty-hero">
          <p className="kicker">
            <span className="kicker-dot" />
            OpenCode Go · Muse Spark 1.3
          </p>
          <h1 className="empty-title">
            Set the scene.
            <span>They&rsquo;ll take it from there.</span>
          </h1>

          <ul className="lineup" aria-label="Cast">
            {ids.map((id, i) => {
              const name = agentLabel(id, config);
              const bio = config
                ? firstSentence(
                    config[`${id}_config` as "ai1_config"].system_prompt,
                  )
                : "";
              return (
                <li
                  key={id}
                  className="lineup-card"
                  style={{
                    ["--voice" as string]: agentAccent(id, config),
                    ["--i" as string]: i,
                  }}
                >
                  <VoiceAvatar
                    className="lineup-avatar"
                    name={name}
                    icon={agentConfig(id, config)?.icon}
                    color={agentAccent(id, config)}
                  />
                  <span className="lineup-text">
                    <strong>{name}</strong>
                    {bio && <span>{bio}</span>}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="stage-box">
            <textarea
              value={firstDraft}
              onChange={(e) => onFirstDraftChange?.(e.target.value)}
              placeholder="A question, a scene, an argument, a first line…"
              aria-label="First message"
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  begin();
                }
              }}
            />
            <div className="stage-box-foot">
              <span className="hint-kbd" aria-hidden>
                <kbd>Ctrl</kbd>
                <kbd>Enter</kbd>
                <span>to begin</span>
              </span>
              {needsKey ? (
                <button
                  type="button"
                  className="btn btn-go"
                  onClick={() => onOpenSettings?.()}
                >
                  <IconKey />
                  Add your key
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-go"
                  disabled={!firstDraft.trim()}
                  onClick={begin}
                >
                  Begin
                  <IconReturn />
                </button>
              )}
            </div>
          </div>

          <div className="starters" aria-label="Starter scenes">
            {STARTERS.map((st) => (
              <button
                key={st.label}
                type="button"
                className={`starter${firstDraft === st.text ? " on" : ""}`}
                onClick={() => onFirstDraftChange?.(st.text)}
                title={st.text}
              >
                <IconSpark />
                {st.label}
              </button>
            ))}
          </div>

          {hasSavedChats && (
            <p className="empty-foot">
              Older threads live in the sidebar · <kbd>B</kbd>
            </p>
          )}
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
              <div
                className="thinking"
                role="status"
                style={
                  thinkingAgentId
                    ? { ["--voice" as string]: agentAccent(thinkingAgentId, config) }
                    : undefined
                }
              >
                <span className="thinking-bars" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  <strong>{thinkingAgent ?? "Someone"}</strong> is finding the
                  words
                </span>
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
          Jump to latest
        </button>
      )}
    </div>
  );
}

export default memo(ChatView);
