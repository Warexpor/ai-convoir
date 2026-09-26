import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconChevron, IconChevronDown, IconKey, IconReturn } from "./Marks";
import MessageBubble from "./MessageBubble";
import { pulseScrollBusy } from "../lib/scrollBusy";
import type { AiConfig, InnerState, Message } from "../types";
import type { StreamMode } from "../lib/config";
import {
  activeAgentIds,
  agentAccent,
  agentConfig,
  agentLabel,
} from "../types";
import VoiceAvatar from "./VoiceAvatar";
import { EFFORT_LABELS } from "../lib/providers";

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
  /** Open the Voices panel on one voice. */
  onEditVoice?: (id: string) => void;
  streamMode?: StreamMode;
}

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

/** "OpenAI · gpt-5 / Anthropic · claude-sonnet-5" for the voices on stage. */
function voiceModelLine(v: AiConfig | null | undefined): string {
  if (!v) return "";
  const effort = v.reasoning_effort && v.reasoning_effort !== "none"
    ? ` · ${EFFORT_LABELS[v.reasoning_effort].toLowerCase()}`
    : "";
  return `${v.model || "no model"}${effort}`;
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
  onEditVoice,
  streamMode = "live",
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

  // A "scene" is one thread. Messages already present when a scene opens
  // cascade in together; only lines that arrive afterwards get the
  // per-message entrance.
  const sceneKey = messages[0] ? msgKey(messages[0], 0) : "";
  const sceneRef = useRef<{ key: string; seen: Set<string> }>({
    key: "",
    seen: new Set(),
  });
  if (sceneRef.current.key !== sceneKey) {
    sceneRef.current = {
      key: sceneKey,
      seen: new Set(messages.map((m, i) => msgKey(m, i))),
    };
  }
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

  const lastTopRef = useRef(0);
  const onScroll = useCallback(() => {
    pulseScrollBusy();
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      const el = scrollRef.current;
      if (!el) return;
      const atBottom = nearBottom(el);
      // Only an upward scroll lets go of the bottom. Content that grew
      // between the scroll and this frame (a reply landing whole) must not
      // read as the reader scrolling away.
      const top = el.scrollTop;
      const up = top < lastTopRef.current - 2;
      lastTopRef.current = top;
      if (atBottom || up) applyAutoScroll(atBottom);
      if (virtualize) computeWindow(el, atBottom);
    });
  }, [applyAutoScroll, computeWindow, virtualize]);

  const stickToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, []);

  // Tokens landing in the streaming bubble are followed by the
  // ResizeObserver below, after layout. Pinning here on every flush forced
  // a synchronous layout right after each commit.
  useEffect(() => {
    if (!autoScroll) return;
    stickToBottom(false);
  }, [messages.length, isThinking, autoScroll, stickToBottom]);

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

  // Once a new line has finished entering, treat it as seen so it does not
  // replay when the virtual list remounts it after a scroll.
  useEffect(() => {
    const id = window.setTimeout(() => {
      messages.forEach((m, i) => sceneRef.current.seen.add(msgKey(m, i)));
    }, 900);
    return () => window.clearTimeout(id);
  }, [messages.length]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !sceneKey || sceneRef.current.seen.size < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rows = Array.from(list.children).slice(-7) as HTMLElement[];
    const anims = rows.map((el, i) =>
      el.animate(
        [
          { opacity: 0, transform: "translate3d(0, 18px, 0) scale(0.985)" },
          { opacity: 1, transform: "none" },
        ],
        {
          duration: 560,
          delay: i * 45,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "backwards",
        },
      ),
    );
    return () => anims.forEach((a) => a.cancel());
  }, [sceneKey]);

  // Content can grow without a new message (fonts landing, thoughts
  // expanding, markdown settling). Stay pinned while following.
  useEffect(() => {
    const el = scrollRef.current;
    const inner = el?.firstElementChild;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => {
      if (autoScrollRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [messages.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <h1 className="empty-title">
            Set the scene.
            <span>They&rsquo;ll take it from there.</span>
          </h1>

          <ul className="lineup" aria-label="Cast">
            {ids.map((id, i) => {
              const name = agentLabel(id, config);
              const cfg = agentConfig(id, config);
              const bio = cfg ? firstSentence(cfg.system_prompt) : "";
              return (
                <li
                  key={id}
                  style={{
                    ["--voice" as string]: agentAccent(id, config),
                    ["--i" as string]: i,
                  }}
                >
                  <button
                    type="button"
                    className="lineup-card"
                    onClick={() => onEditVoice?.(id)}
                    title={`Edit ${name}`}
                  >
                    <VoiceAvatar
                      className="lineup-avatar"
                      name={name}
                      icon={cfg?.icon}
                      color={agentAccent(id, config)}
                    />
                    <span className="lineup-text">
                      <strong>{name}</strong>
                      {bio && <span>{bio}</span>}
                      <span className="lineup-model">{voiceModelLine(cfg)}</span>
                    </span>
                    <IconChevron />
                  </button>
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


          {hasSavedChats && (
            <p className="empty-foot">
              Older threads live in the sidebar
              <span className="empty-foot-kbd"> · <kbd>B</kbd></span>
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
                    enter={!sceneRef.current.seen.has(key)}
                    streamMode={streamMode}
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
                <span className="eq" aria-hidden>
                  <i />
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
