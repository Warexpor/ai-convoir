import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { InnerState, Message } from "../types";
import type { StreamMode } from "../lib/config";
import { agentAccent, agentConfig, agentLabel } from "../types";
import VoiceAvatar from "./VoiceAvatar";
import MarkdownBody from "./MarkdownBody";
import RelativeTime from "./RelativeTime";
import { IconCheck, IconChevronDown, IconCopy, IconTrash } from "./Marks";

interface Props {
  message: Message;
  config?: InnerState | null;
  showThoughtsUi: boolean;
  onDelete?: (agent: string, turn: number, created_at: number) => void;
  enter?: boolean;
  streamMode?: StreamMode;
}

function MessageBubble({
  message,
  config,
  showThoughtsUi,
  onDelete,
  enter = true,
  streamMode = "live",
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
  // While thoughts stream in (before the reply body), keep them expanded so
  // "Show thinking" is visibly working — not a collapsed peek the user misses.
  useEffect(() => {
    if (isStream && hasThoughts && !(message.content || "").trim()) {
      setThoughtsOpen(true);
    }
  }, [isStream, hasThoughts, message.content]);
  const kind = isSeed ? "seed" : isNote ? "note" : "voice";
  const accent = agentAccent(message.agent, config);
  // In paragraph/whole mode the finished reply lands in one go; give that
  // landing its own entrance even if the bubble is long past its first one.
  const revealRef = useRef(false);
  if (isStream && streamMode !== "live") revealRef.current = true;

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
          <p>{message.content}</p>
          {actions}
        </div>
      </article>
    );
  }

  if (isSeed) {
    return (
      <article className={cls}>
        <div className="seed-bubble">
          <MarkdownBody content={message.content} />
        </div>
        <div className="msg-foot">{actions}</div>
      </article>
    );
  }

  return (
    <article className={cls} style={{ ["--voice" as string]: accent }}>
      <header className="speaker">
        <VoiceAvatar
          className="speaker-avatar"
          name={label}
          icon={agentConfig(message.agent, config)?.icon}
          color={accent}
        />
        <span className="speaker-name">{label}</span>
        {isStream && (
          <span className="speaker-live">
            {message.content || streamMode === "whole" ? "writing" : "thinking"}
          </span>
        )}
      </header>

      {hasThoughts && (
        <div className={`thoughts${thoughtsOpen ? " open" : ""}`}>
          <button
            type="button"
            className="thoughts-toggle"
            onClick={() => setThoughtsOpen((o) => !o)}
            aria-expanded={thoughtsOpen}
          >
            <span>{isStream && !message.content ? "Thinking" : "Thoughts"}</span>
            <IconChevronDown />
          </button>
          {thoughtsOpen && (
            <div className="thoughts-body">
              <MarkdownBody content={reasoning} streaming={isStream && !message.content} />
            </div>
          )}
        </div>
      )}

      {(message.content || !hasThoughts) && (
        <div
          className={`msg-text${!isStream && revealRef.current ? " is-reveal" : ""}`}
          key={isStream ? "s" : "d"}
        >
          <MarkdownBody content={message.content} streaming={isStream} mode={streamMode} />
        </div>
      )}

      {!isStream && (
        <footer className="msg-foot">
          {actions}
          <span className="msg-stamp">
            <RelativeTime at={message.created_at || Date.now()} />
            {message.turn > 0 && <span>#{message.turn}</span>}
          </span>
        </footer>
      )}
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
    a.streamMode === b.streamMode &&
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
