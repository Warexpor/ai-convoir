import { memo, useCallback, useState } from "react";
import type { InnerState, Message } from "../types";
import { agentAccent, agentInitials, agentLabel } from "../types";
import MarkdownBody from "./MarkdownBody";
import RelativeTime from "./RelativeTime";

interface Props {
  message: Message;
  config?: InnerState | null;
  showThoughtsUi: boolean;
  onDelete?: (agent: string, turn: number, created_at: number) => void;
}

function MessageBubble({
  message,
  config,
  showThoughtsUi,
  onDelete,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [thoughtsOpen, setThoughtsOpen] = useState(false);
  const label = agentLabel(message.agent, config);
  const accent = agentAccent(message.agent);
  const isSeed = message.agent === "seed";
  const isStream = !!message.streaming;
  const reasoning = (message.reasoning || "").trim();
  const hasThoughts = showThoughtsUi && reasoning.length > 0;

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [message.content]);

  return (
    <article
      className={`msg ${isSeed ? "seed" : ""} ${isStream ? "streaming" : ""}`}
    >
      <div
        className="msg-avatar"
        style={
          isSeed
            ? undefined
            : {
                color: accent,
                borderColor: accent,
              }
        }
        aria-hidden
      >
        {isSeed ? "You" : agentInitials(label)}
      </div>

      <div className="msg-body">
        <div className="msg-meta">
          <span className="msg-name">{label}</span>
          {isStream ? (
            <span className="msg-live">live</span>
          ) : (
            <RelativeTime at={message.created_at || Date.now()} />
          )}
          <div className="msg-actions">
            <button
              type="button"
              className="msg-action"
              onClick={handleCopy}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            {!isStream && onDelete && (
              <button
                type="button"
                className="msg-action msg-action-del"
                onClick={() =>
                  onDelete(message.agent, message.turn, message.created_at)
                }
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {hasThoughts && (
          <div className="thoughts">
            <button
              type="button"
              className={`thoughts-toggle ${thoughtsOpen ? "open" : ""}`}
              onClick={() => setThoughtsOpen((o) => !o)}
              aria-expanded={thoughtsOpen}
            >
              <span className="thoughts-chevron">
                {thoughtsOpen ? "▾" : "▸"}
              </span>
              <span className="thoughts-label">Thoughts</span>
              {isStream && !message.content && (
                <span className="msg-live" style={{ marginLeft: 6 }}>
                  thinking
                </span>
              )}
            </button>
            {thoughtsOpen && (
              <div className="thoughts-body">
                <MarkdownBody
                  content={reasoning}
                  streaming={isStream && !message.content}
                />
              </div>
            )}
          </div>
        )}

        {(message.content || !hasThoughts) && (
          <div className="msg-bubble">
            <MarkdownBody content={message.content} streaming={isStream} />
          </div>
        )}
      </div>
    </article>
  );
}

export default memo(MessageBubble);
