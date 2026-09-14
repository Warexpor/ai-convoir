import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";
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

const EST_MSG = 148;
const OVERSCAN = 5;
const VIRTUALIZE_AFTER = 28;

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevLen = useRef(0);
  const [win, setWin] = useState({ start: 0, end: messages.length });

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    setAutoScroll(atBottom);

    if (messages.length < VIRTUALIZE_AFTER) {
      setWin({ start: 0, end: messages.length });
      return;
    }
    const start = Math.max(0, Math.floor(el.scrollTop / EST_MSG) - OVERSCAN);
    const visible = Math.ceil(el.clientHeight / EST_MSG) + OVERSCAN * 2;
    let end = Math.min(messages.length, start + visible);
    if (atBottom) end = messages.length;
    setWin({ start, end });
  }, [messages.length]);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({
        behavior: messages.length > prevLen.current ? "smooth" : "auto",
      });
    }
    prevLen.current = messages.length;
  }, [messages, autoScroll]);

  const streamingTail = messages[messages.length - 1];
  const streamLen =
    streamingTail?.streaming ? streamingTail.content.length : 0;
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [streamLen, autoScroll]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length < VIRTUALIZE_AFTER) {
      setWin({ start: 0, end: messages.length });
      return;
    }
    if (autoScroll) {
      const visible = Math.ceil(el.clientHeight / EST_MSG) + OVERSCAN * 2;
      setWin({
        start: Math.max(0, messages.length - visible),
        end: messages.length,
      });
      return;
    }
    onScroll();
  }, [messages.length, autoScroll, onScroll]);

  const jumpLatest = useCallback(() => {
    setAutoScroll(true);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const { slice, sliceStart, topPad, bottomPad } = useMemo(() => {
    if (messages.length < VIRTUALIZE_AFTER) {
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
      topPad: start * EST_MSG,
      bottomPad: Math.max(0, messages.length - end) * EST_MSG,
    };
  }, [messages, win.start, win.end, autoScroll]);

  if (messages.length === 0) {
    const names = agentNames.filter(Boolean).slice(0, 3);
    const roster =
      names.length === 3
        ? `${names[0]}, ${names[1]}, and ${names[2]}`
        : `${names[0] || "Ava"} and ${names[1] || "Jules"}`;
    return (
      <div className="empty">
        <div className="empty-card">
          <img
            className="empty-logo"
            src="/logo.svg"
            width={28}
            height={28}
            alt=""
          />
          <span className="mono-cap empty-kicker">Conversation</span>
          <h2>Start a thread</h2>
          <p>
            {roster} take turns in one chat. Write the first line, then press
            Begin.
            {hasSavedChats ? " Or open a saved thread from Chats." : ""}
          </p>
          <ol className="setup-steps" aria-label="How to start">
            <li className={needsKey ? "on" : "done"}>
              <span className="setup-n">1</span>
              Add your OpenCode Go key
            </li>
            <li className={!needsKey ? "on" : ""}>
              <span className="setup-n">2</span>
              Write an opening line
            </li>
            <li>
              <span className="setup-n">3</span>
              Press Begin — they reply in turns
            </li>
          </ol>
          <div className="empty-box glass-card">
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
              <span className="mono-cap">
                {needsKey ? "Key first" : "Ctrl+Enter · begin"}
              </span>
              {needsKey ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onOpenSettings?.()}
                >
                  Add API key
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!firstDraft.trim()}
                  onClick={() => onStartFirst?.(firstDraft)}
                >
                  Begin
                </button>
              )}
            </div>
          </div>
          <p className="empty-hint">
            Step mode: one reply at a time. Auto: they keep talking.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-wrap">
      <div ref={scrollRef} onScroll={onScroll} className="chat" aria-busy={isThinking || !!streamingTail?.streaming}>
        <div className="chat-inner">
          {topPad > 0 && (
            <div className="chat-spacer" style={{ height: topPad }} aria-hidden />
          )}
          {slice.map((msg, i) => {
            const idx = sliceStart + i;
            return (
              <MessageBubble
                key={`${msg.agent}-${msg.turn}-${msg.created_at || idx}`}
                message={msg}
                config={config}
                showThoughtsUi={showThoughtsUi}
                onDelete={onDeleteMessage}
              />
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
          {bottomPad > 0 && (
            <div
              className="chat-spacer"
              style={{ height: bottomPad }}
              aria-hidden
            />
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      {!autoScroll && (
        <button
          type="button"
          className="jump-latest"
          onClick={jumpLatest}
        >
          Latest
        </button>
      )}
    </div>
  );
}

export default memo(ChatView);
