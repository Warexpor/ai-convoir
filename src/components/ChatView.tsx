import { memo, useCallback, useEffect, useRef, useState } from "react";
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
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevLen = useRef(0);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 90);
  }, []);

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

  if (messages.length === 0) {
    return (
      <div className="empty">
        <div className="empty-card">
          <span className="mono-cap empty-kicker">Conversation</span>
          <h2>Start a thread</h2>
          <p>
            Two or three models take turns on one transcript. Set endpoints in
            Settings, then write the first line.
          </p>
          <div className="empty-box">
            <textarea
              value={firstDraft}
              onChange={(e) => onFirstDraftChange?.(e.target.value)}
              placeholder="A question, a scene, or an opening line."
              aria-label="First message"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onStartFirst?.(firstDraft);
                }
              }}
            />
            <div className="empty-actions">
              <span className="mono-cap">Ctrl+Enter · begin</span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onStartFirst?.(firstDraft)}
              >
                Begin
              </button>
            </div>
          </div>
          <p className="empty-hint mono-cap">
            S settings · B chats · N step · ? shortcuts
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="chat">
      <div className="chat-inner">
        {messages.map((msg, i) => (
          <MessageBubble
            key={`${msg.agent}-${msg.turn}-${msg.created_at || i}`}
            message={msg}
            config={config}
            showThoughtsUi={showThoughtsUi}
            onDelete={onDeleteMessage}
          />
        ))}
        {isThinking && (
          <div className="thinking" role="status">
            <span className="d" />
            <span className="d" style={{ animationDelay: "0.2s" }} />
            <span className="d" style={{ animationDelay: "0.4s" }} />
            {thinkingAgent ? `${thinkingAgent}` : "Writing"}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export default memo(ChatView);
