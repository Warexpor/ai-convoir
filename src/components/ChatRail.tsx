import { useCallback, useMemo, useRef, useState } from "react";
import type { SavedChat } from "../lib/storage";
import { renameChat } from "../lib/storage";
import { agentInitials, type ConversationMode } from "../types";
import RelativeTime from "./RelativeTime";
import { SlashMark, IconNew, IconRailHide, IconSearch } from "./Marks";

interface Props {
  open?: boolean;
  chats: SavedChat[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onRename?: () => void;
  agentNames?: string[];
  mode?: ConversationMode;
  needsKey?: boolean;
  onUseStarter?: (text: string) => void;
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
];

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
  agentNames = ["Ava", "Jules"],
  mode = "step",
  needsKey = false,
  onUseStarter,
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

  const voices = agentNames.filter(Boolean);
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
        <span className="rail-title">Chats</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={onNew}>
          <IconNew />
          New
        </button>
        <button
          type="button"
          className="btn btn-chrome btn-icon"
          onClick={onClose}
          title="Hide chats panel"
          aria-label="Hide chats panel"
        >
          <IconRailHide />
        </button>
      </div>

      <div className="rail-tools">
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
            <SlashMark className="rail-empty-mark" size={36} />
            <span className="mono-cap">No threads yet</span>
            <p>Saved ones land here. Double-click a title to rename.</p>
            {onUseStarter && (
              <div className="rail-starters">
                <span className="mono-cap">Try a first line</span>
                {STARTERS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className="rail-starter"
                    onClick={() => onUseStarter(s.text)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {chats.length > 0 && shown.length === 0 && (
          <div className="rail-empty">
            <span className="mono-cap">No matches</span>
            <p>Nothing titled like that.</p>
          </div>
        )}
        {shown.length > 0 && <p className="rail-section">Recent</p>}
        {shown.map((c) => {
          const isConfirming = confirmingId === c.id;
          const isRenaming = renamingId === c.id;
          const names = chatVoices(c);

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
                    <span className="chat-item-voices" aria-hidden>
                      {names.map((n, i) => (
                        <span key={`${n}-${i}`} className="chat-voice-dot">
                          {agentInitials(n)}
                        </span>
                      ))}
                    </span>
                    <span>
                      {c.messages.length} · {c.mode === "auto" ? "Auto" : "Step"}
                    </span>
                    <RelativeTime at={c.updated_at} className="" />
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

      <div className="rail-foot">
        <div className="rail-foot-voices">
          {voices.map((n) => (
            <span key={n} className="rail-pill">
              {n}
            </span>
          ))}
        </div>
        <p className="rail-foot-line">
          OpenCode Go · {mode === "auto" ? "Auto" : "Step"}
        </p>
        <p className="rail-foot-line rail-foot-mute">
          {needsKey ? "Key needed" : threadLabel}
          <span> · B hides this</span>
        </p>
      </div>
      </div>
    </aside>
  );
}
