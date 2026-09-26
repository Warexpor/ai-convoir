import { memo, useCallback, useRef, useState } from "react";
import type { InnerState, Message } from "../types";
import type { StreamMode } from "../lib/config";
import { agentAccent, agentConfig, agentLabel } from "../types";
import VoiceAvatar from "./VoiceAvatar";
import MarkdownBody from "./MarkdownBody";
import RelativeTime from "./RelativeTime";
import { IconCheck, IconChevron, IconCopy, IconTrash } from "./Marks";
import ActionSheet, { type SheetAction } from "./ActionSheet";
import { useLongPress } from "../hooks/useLongPress";

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const press = useLongPress(() => setSheetOpen(true));
  const label = agentLabel(message.agent, config);
  const isSeed = message.agent === "seed";
  const isNote = message.agent === "narrator";
  const isStream = !!message.streaming;
  const reasoning = (message.reasoning || "").trim();
  const hasThoughts = showThoughtsUi && reasoning.length > 0;
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

  const sheetActions: SheetAction[] = [
    { label: "Copy text", icon: <IconCopy />, run: handleCopy },
  ];
  if (!isStream && onDelete) {
    sheetActions.push({
      label: "Delete line",
      icon: <IconTrash />,
      danger: true,
      run: () => onDelete(message.agent, message.turn, message.created_at),
    });
  }
  const sheet = (
    <ActionSheet
      open={sheetOpen}
      title={isNote ? "Direction" : isSeed ? "Opening line" : label}
      actions={sheetActions}
      onClose={() => setSheetOpen(false)}
    />
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
      <article className={cls} {...press}>
        <div className="note-line">
          <p>{message.content}</p>
          {actions}
        </div>
        {sheet}
      </article>
    );
  }

  return (
    <article
      className={cls}
      style={{ ["--voice" as string]: accent }}
      {...press}
    >
      <div className="msg-body">
        <header className="msg-meta">
          {!isSeed && (
            <VoiceAvatar
              className="msg-avatar"
              name={label}
              icon={agentConfig(message.agent, config)?.icon}
              color={accent}
            />
          )}
          <span className="msg-name">{isSeed ? "Opening line" : label}</span>
          {isStream && (
            <span className="msg-live">
              <span className="eq eq-sm" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {message.content || streamMode === "whole" ? "writing" : "thinking"}
            </span>
          )}
          <span className="msg-aside">
            {!isStream && <RelativeTime at={message.created_at || Date.now()} />}
            {!isSeed && message.turn > 0 && (
              <span className="msg-turn">#{message.turn}</span>
            )}
            {actions}
          </span>
        </header>

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
          <div
            className={`msg-text${!isStream && revealRef.current ? " is-reveal" : ""}`}
            key={isStream ? "s" : "d"}
          >
            <MarkdownBody
              content={message.content}
              streaming={isStream}
              mode={streamMode}
            />
          </div>
        )}
      </div>
      {sheet}
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
