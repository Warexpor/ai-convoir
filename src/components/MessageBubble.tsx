import { memo, useCallback, useState } from "react";
import type { InnerState, Message } from "../types";
import { agentAccent, agentConfig, agentLabel } from "../types";
import VoiceAvatar from "./VoiceAvatar";
import MarkdownBody from "./MarkdownBody";
import RelativeTime from "./RelativeTime";
import { IconCheck, IconChevron, IconCopy, IconTrash } from "./Marks";

interface Props {
  message: Message;
  config?: InnerState | null;
  showThoughtsUi: boolean;
  onDelete?: (agent: string, turn: number, created_at: number) => void;
  enter?: boolean;
}

function MessageBubble({
  message,
  config,
  showThoughtsUi,
  onDelete,
  enter = true,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [thoughtsOpen, setThoughtsOpen] = useState(false);
  const label = agentLabel(message.agent, config);
  const isSeed = message.agent === "seed";
  const isNote = message.agent === "narrator";
  const isStream = !!message.streaming;
  const reasoning = (message.reasoning || "").trim();
  const hasThoughts = showThoughtsUi && reasoning.length > 0;
  const kind = isSeed ? "seed" : isNote ? "note" : "voice";
  const accent = agentAccent(message.agent, config);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [message.content]);

  const actions = (
    <div className="msg-actions">
      {confirming && onDelete ? (
        <div className="inline-confirm">
          <button
            type="button"
            className="confirm-del"
            onClick={() =>
              onDelete(message.agent, message.turn, message.created_at)
            }
          >
            Delete
          </button>
          <button
            type="button"
            className="confirm-cancel"
            onClick={() => setConfirming(false)}
          >
            Keep
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className={`msg-action ${copied ? "is-copied" : ""}`}
            onClick={handleCopy}
            aria-label={copied ? "Copied" : "Copy message"}
            title={copied ? "Copied" : "Copy"}
          >
            {copied ? <IconCheck /> : <IconCopy />}
          </button>
          {!isStream && onDelete && (
            <button
              type="button"
              className="msg-action msg-action-del"
              onClick={() => setConfirming(true)}
              aria-label="Delete message"
              title="Delete"
            >
              <IconTrash />
            </button>
          )}
        </>
      )}
    </div>
  );

  const cls = [
    "msg",
    `msg-${kind}`,
    isStream ? "streaming" : "",
    enter ? "" : "msg-static",
    confirming ? "confirming" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (isNote) {
    return (
      <article className={cls}>
        <div className="note-line">
          <span className="note-tag">Stage note</span>
          <p>{message.content}</p>
          {actions}
        </div>
      </article>
    );
  }

  return (
    <article
      className={cls}
      style={{ ["--voice" as string]: accent }}
    >
      <div className="msg-gutter" aria-hidden>
        {isSeed ? (
          <span className="msg-avatar msg-avatar-you">You</span>
        ) : (
          <VoiceAvatar
            className="msg-avatar"
            variant="tint"
            name={label}
            icon={agentConfig(message.agent, config)?.icon}
            color={accent}
          />
        )}
        <span className="msg-spine" />
      </div>

      <div className="msg-body">
        <div className="msg-meta">
          <span className="msg-name">{isSeed ? "Opening line" : label}</span>
          {!isSeed && message.turn > 0 && (
            <span className="msg-turn">T{String(message.turn).padStart(2, "0")}</span>
          )}
          {isStream ? (
            <span className="msg-live">
              <i />
              {message.content ? "writing" : "thinking"}
            </span>
          ) : (
            <RelativeTime at={message.created_at || Date.now()} />
          )}
          {actions}
        </div>

        {hasThoughts && (
          <div className={`thoughts ${thoughtsOpen ? "open" : ""}`}>
            <button
              type="button"
              className="thoughts-toggle"
              onClick={() => setThoughtsOpen((o) => !o)}
              aria-expanded={thoughtsOpen}
            >
              <IconChevron />
              <span>{thoughtsOpen ? "Hide thoughts" : "Thoughts"}</span>
              {!thoughtsOpen && (
                <span className="thoughts-peek">{reasoning.slice(0, 90)}</span>
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
          <div className="msg-text">
            <MarkdownBody content={message.content} streaming={isStream} />
          </div>
        )}
      </div>
    </article>
  );
}

export default memo(MessageBubble, (a, b) => {
  const ma = a.message;
  const mb = b.message;
  // Message identity alone is not enough: renaming a voice changes `config`
  // while the message object stays the same.
  return (
    a.showThoughtsUi === b.showThoughtsUi &&
    a.enter === b.enter &&
    a.onDelete === b.onDelete &&
    a.config === b.config &&
    (ma === mb ||
      (ma.agent === mb.agent &&
        ma.turn === mb.turn &&
        ma.created_at === mb.created_at &&
        ma.content === mb.content &&
        ma.reasoning === mb.reasoning &&
        ma.streaming === mb.streaming))
  );
});
