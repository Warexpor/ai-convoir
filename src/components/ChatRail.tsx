import { useCallback, useMemo, useRef, useState } from "react";
import type { SavedChat } from "../lib/storage";
import { renameChat } from "../lib/storage";
import { agentAccent } from "../types";
import RelativeTime from "./RelativeTime";
import { SlashMark, IconNew, IconRailHide, IconSearch, IconTrash } from "./Marks";

interface Props {
  open?: boolean;
  chats: SavedChat[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onRename?: () => void;
  needsKey?: boolean;
}

const DAY = 86_400_000;

function bucketOf(ts: number): string {
  const startToday = new Date().setHours(0, 0, 0, 0);
  if (ts >= startToday) return "Today";
  if (ts >= startToday - DAY) return "Yesterday";
  if (ts >= startToday - 6 * DAY) return "This week";
  return "Earlier";
}

function chatVoices(c: SavedChat): string[] {
  const names =
    c.bot_count >= 3
      ? [c.ai1_config.name, c.ai2_config.name, c.ai3_config.name]
      : [c.ai1_config.name, c.ai2_config.name];
  return names.map((n) => n || "Voice");
}

export default function ChatRail({
  open = true,
  chats,
  activeId,
  onNew,
  onSelect,
  onDelete,
  onClose,
  onRename,
  needsKey = false,
}: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [query, setQuery] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  const handleStartRename = useCallback((id: string, currentTitle: string) => {
    setRenamingId(id);
    setRenameText(currentTitle);
    requestAnimationFrame(() => renameRef.current?.select());
  }, []);

  const handleCommitRename = useCallback(
    (id: string) => {
      const trimmed = renameText.trim();
      if (trimmed) {
        renameChat(id, trimmed);
        onRename?.();
      }
      setRenamingId(null);
      setRenameText("");
    },
    [renameText, onRename],
  );

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameText("");
  }, []);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      q
        ? chats.filter((c) => c.title.toLowerCase().includes(q))
        : chats,
    [chats, q],
  );

  const threadLabel =
    chats.length === 1 ? "1 thread" : `${chats.length} threads`;

  return (
    <aside
      className="rail"
      aria-label="Saved chats"
      aria-hidden={!open}
      inert={!open}
    >
      <div className="rail-inner">
      <div className="rail-head">
        <div className="rail-brand">
          <SlashMark className="rail-logo" size={22} />
          <span>
            AI Conversation
            <em>v2</em>
          </span>
        </div>
        <button
          type="button"
          className="btn btn-icon"
          onClick={onClose}
          title="Hide sidebar (B)"
          aria-label="Hide sidebar"
        >
          <IconRailHide />
        </button>
      </div>

      <div className="rail-tools">
        <button type="button" className="rail-new" onClick={onNew}>
          <IconNew />
          New thread
        </button>
        <label className="rail-search">
          <IconSearch />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search threads"
            aria-label="Search threads"
          />
        </label>
      </div>

      <div className="rail-scroll">
        {chats.length === 0 && (
          <div className="rail-empty">
            <p>No threads yet.</p>
            <span>Every conversation saves itself here.</span>
          </div>
        )}
        {chats.length > 0 && shown.length === 0 && (
          <div className="rail-empty">
            <p>No matches.</p>
            <span>Nothing titled like &ldquo;{query}&rdquo;.</span>
          </div>
        )}
        {shown.map((c, idx) => {
          const isConfirming = confirmingId === c.id;
          const isRenaming = renamingId === c.id;
          const names = chatVoices(c);
          const bucket = bucketOf(c.updated_at);
          const showBucket =
            idx === 0 || bucketOf(shown[idx - 1].updated_at) !== bucket;

          return (
            <div key={c.id} className="chat-group">
            {showBucket && <p className="rail-section">{bucket}</p>}
            <div
              className={`chat-row ${activeId === c.id ? "active" : ""}`}
            >
              {isRenaming ? (
                <div className="chat-item is-renaming">
                  <input
                    ref={renameRef}
                    className="chat-rename-input"
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCommitRename(c.id);
                      else if (e.key === "Escape") handleCancelRename();
                      e.stopPropagation();
                    }}
                    onBlur={() => handleCommitRename(c.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Rename chat"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="chat-item"
                  onClick={() => onSelect(c.id)}
                  onDoubleClick={() => handleStartRename(c.id, c.title)}
                  aria-current={activeId === c.id ? "page" : undefined}
                >
                  <div className="chat-item-title">{c.title}</div>
                  <div className="chat-item-meta">
                    <span className="chat-item-voices" aria-hidden>
                      {names.map((n, i) => (
                        <i
                          key={`${n}-${i}`}
                          style={{ background: agentAccent(`ai${i + 1}`) }}
                        />
                      ))}
                    </span>
                    <span>{names.join(" · ")}</span>
                    <RelativeTime at={c.updated_at} className="chat-item-time" />
                  </div>
                </button>
              )}

              {isConfirming ? (
                <div className="inline-confirm">
                  <button
                    type="button"
                    className="confirm-del"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmingId(null);
                      onDelete(c.id);
                    }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="confirm-cancel"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmingId(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="chat-item-del"
                  title="Delete thread"
                  aria-label={`Delete ${c.title}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setConfirmingId(c.id);
                  }}
                >
                  <IconTrash />
                </button>
              )}
            </div>
            </div>
          );
        })}
      </div>

      <div className="rail-foot">
        <span className={`key-state ${needsKey ? "is-missing" : "is-ok"}`}>
          <i />
          {needsKey ? "API key needed" : "Key connected"}
        </span>
        <span className="rail-foot-mute">{threadLabel}</span>
      </div>
      </div>
    </aside>
  );
}
