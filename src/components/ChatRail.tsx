import { useCallback, useRef, useState } from "react";
import type { SavedChat } from "../lib/storage";
import { renameChat } from "../lib/storage";
import { relativeTime } from "../types";

interface Props {
  chats: SavedChat[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onRename?: () => void;
}

export default function ChatRail({
  chats,
  activeId,
  onNew,
  onSelect,
  onDelete,
  onClose,
  onRename,
}: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
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

  return (
    <aside className="rail" aria-label="Saved chats">
      <div className="rail-head">
        <span className="rail-title">Chats</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={onNew}>
          New
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onClose}
          title="Hide chats panel"
          aria-label="Hide chats panel"
        >
          Hide
        </button>
      </div>
      <div className="rail-scroll">
        {chats.length === 0 && (
          <p className="rail-empty">
            Saved threads appear here. Double-click a title to rename.
          </p>
        )}
        {chats.map((c) => {
          const isConfirming = confirmingId === c.id;
          const isRenaming = renamingId === c.id;

          return (
            <div
              key={c.id}
              className={`chat-row ${activeId === c.id ? "active" : ""}`}
            >
              {isRenaming ? (
                <div
                  className="chat-item"
                  style={{
                    padding: "8px 8px 8px 10px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
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
                    {c.messages.length} msgs · {relativeTime(c.updated_at)}
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
                  className={`chat-item-del ${isConfirming ? "show" : ""}`}
                  title="Delete chat"
                  aria-label={`Delete ${c.title}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setConfirmingId(c.id);
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
