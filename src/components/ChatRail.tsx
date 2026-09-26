import { useCallback, useMemo, useRef, useState } from "react";
import type { SavedChat } from "../lib/storage";
import { renameChat } from "../lib/storage";
import type { Cast } from "../lib/casts";
import { agentAccent, agentConfig, type VoiceSource } from "../types";
import VoiceAvatar from "./VoiceAvatar";
import RelativeTime from "./RelativeTime";
import Collapse from "./Collapse";
import {
  SlashMark,
  IconChevron,
  IconKey,
  IconNew,
  IconRailHide,
  IconSearch,
  IconTrash,
} from "./Marks";

interface Props {
  open?: boolean;
  chats: SavedChat[];
  casts: Cast[];
  activeId: string | null;
  activeCastId: string | null;
  onNew: (castId?: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  onRename?: () => void;
  onCreateCast: (name: string) => void;
  onRenameCast: (id: string, name: string) => void;
  onDeleteCast: (id: string) => void;
  needsKey?: boolean;
}

const UNSORTED = "__unsorted";

function voiceNames(v: VoiceSource & { bot_count: number }): string[] {
  const names =
    v.bot_count >= 3
      ? [v.ai1_config.name, v.ai2_config.name, v.ai3_config.name]
      : [v.ai1_config.name, v.ai2_config.name];
  return names.map((n) => n || "Voice");
}

/** The cast in miniature: overlapping avatars, same glyphs as on stage. */
function VoiceStack({ src }: { src: VoiceSource & { bot_count: number } }) {
  const n = src.bot_count >= 3 ? 3 : 2;
  return (
    <span className="voice-stack-mini" aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const id = `ai${i + 1}`;
        const cfg = agentConfig(id, src);
        return (
          <VoiceAvatar
            key={id}
            className="mini-avatar"
            name={cfg?.name || "Voice"}
            icon={cfg?.icon}
            color={agentAccent(id, src)}
          />
        );
      })}
    </span>
  );
}

function ChatRow({
  chat,
  active,
  onSelect,
  onDelete,
  onRename,
}: {
  chat: SavedChat;
  active: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  // Fold the row away, then drop it for real.
  const remove = () => {
    const el = rowRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onDelete(chat.id);
      return;
    }
    el.style.height = `${el.offsetHeight}px`;
    setLeaving(true);
    requestAnimationFrame(() => {
      el.style.height = "0px";
    });
    window.setTimeout(() => onDelete(chat.id), 280);
  };
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed) {
      renameChat(chat.id, trimmed);
      onRename?.();
    }
    setRenaming(false);
  };

  return (
    <div
      ref={rowRef}
      className={`chat-row${active ? " active" : ""}${leaving ? " is-leaving" : ""}`}
      inert={leaving}
    >
      {renaming ? (
        <div className="chat-item is-renaming">
          <input
            ref={inputRef}
            className="chat-rename-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") setRenaming(false);
              e.stopPropagation();
            }}
            onBlur={commit}
            aria-label="Rename thread"
          />
        </div>
      ) : (
        <button
          type="button"
          className="chat-item"
          onClick={() => onSelect(chat.id)}
          onDoubleClick={() => {
            setText(chat.title);
            setRenaming(true);
            requestAnimationFrame(() => inputRef.current?.select());
          }}
          aria-current={active ? "page" : undefined}
          title="Double-click to rename"
        >
          <div className="chat-item-title">{chat.title}</div>
          <div className="chat-item-meta">
            <VoiceStack src={chat} />
            <span>{voiceNames(chat).join(" · ")}</span>
            <RelativeTime at={chat.updated_at} className="chat-item-time" />
          </div>
        </button>
      )}

      {confirming ? (
        <div className="inline-confirm">
          <button
            type="button"
            className="confirm-del"
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(false);
              remove();
            }}
          >
            Delete
          </button>
          <button
            type="button"
            className="confirm-cancel"
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(false);
            }}
          >
            Keep
          </button>
        </div>
      ) : (
        !renaming && (
          <button
            type="button"
            className="chat-item-del"
            title="Delete thread"
            aria-label={`Delete ${chat.title}`}
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
            }}
          >
            <IconTrash />
          </button>
        )
      )}
    </div>
  );
}

export default function ChatRail({
  open = true,
  chats,
  casts,
  activeId,
  activeCastId,
  onNew,
  onSelect,
  onDelete,
  onClose,
  onRename,
  onCreateCast,
  onRenameCast,
  onDeleteCast,
  needsKey = false,
}: Props) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renamingCast, setRenamingCast] = useState<string | null>(null);
  const [castText, setCastText] = useState("");
  const [confirmCast, setConfirmCast] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const castInputRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const known = new Set(casts.map((c) => c.id));
    const byCast = new Map<string, SavedChat[]>();
    for (const c of chats) {
      if (q && !c.title.toLowerCase().includes(q)) continue;
      const key = c.cast_id && known.has(c.cast_id) ? c.cast_id : UNSORTED;
      const list = byCast.get(key) ?? [];
      list.push(c);
      byCast.set(key, list);
    }
    return byCast;
  }, [chats, casts, q]);

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const commitCastName = (id: string) => {
    if (castText.trim()) onRenameCast(id, castText);
    setRenamingCast(null);
  };

  const commitNewCast = () => {
    const name = newName.trim();
    setCreating(false);
    setNewName("");
    if (name) onCreateCast(name);
  };

  const unsorted = groups.get(UNSORTED) ?? [];
  const noResults = q && [...groups.values()].every((l) => l.length === 0);
  const threadLabel =
    chats.length === 1 ? "1 thread" : `${chats.length} threads`;

  return (
    <aside
      className="rail"
      aria-label="Casts and threads"
      aria-hidden={!open}
      inert={!open}
    >
      <div className="rail-inner">
        <div className="rail-head">
          <div className="rail-brand">
            <SlashMark className="rail-logo" size={22} />
            <span>
              AI ConvoIR
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
          <button type="button" className="rail-new" onClick={() => onNew()}>
            <IconNew />
            New thread
            {activeCastId && (
              <span className="rail-new-in">
                in {casts.find((c) => c.id === activeCastId)?.name}
              </span>
            )}
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
          {noResults && (
            <div className="rail-empty">
              <p>No matches.</p>
              <span>Nothing titled like &ldquo;{query}&rdquo;.</span>
            </div>
          )}

          {casts.map((cast) => {
            const list = groups.get(cast.id) ?? [];
            if (q && list.length === 0) return null;
            const isOpen = q ? true : !collapsed.has(cast.id);
            const isActive = cast.id === activeCastId;
            return (
              <section
                key={cast.id}
                className={`cast-group${isActive ? " is-active" : ""}`}
              >
                <div className="cast-group-head">
                  {renamingCast === cast.id ? (
                    <input
                      ref={castInputRef}
                      className="chat-rename-input"
                      value={castText}
                      onChange={(e) => setCastText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitCastName(cast.id);
                        else if (e.key === "Escape") setRenamingCast(null);
                        e.stopPropagation();
                      }}
                      onBlur={() => commitCastName(cast.id)}
                      aria-label="Rename cast"
                    />
                  ) : (
                    <button
                      type="button"
                      className="cast-group-toggle"
                      onClick={() => toggle(cast.id)}
                      onDoubleClick={() => {
                        setCastText(cast.name);
                        setRenamingCast(cast.id);
                        requestAnimationFrame(() =>
                          castInputRef.current?.select(),
                        );
                      }}
                      aria-expanded={isOpen}
                      title="Double-click to rename"
                    >
                      <IconChevron />
                      <VoiceStack src={cast} />
                      <span className="cast-group-name">{cast.name}</span>
                      <span className="cast-group-count">{list.length}</span>
                    </button>
                  )}

                  {confirmCast === cast.id ? (
                    <div className="inline-confirm">
                      <button
                        type="button"
                        className="confirm-del"
                        onClick={() => {
                          setConfirmCast(null);
                          onDeleteCast(cast.id);
                        }}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className="confirm-cancel"
                        onClick={() => setConfirmCast(null)}
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    renamingCast !== cast.id && (
                      <div className="cast-group-actions">
                        <button
                          type="button"
                          className="cast-group-btn is-danger"
                          onClick={() => setConfirmCast(cast.id)}
                          title="Delete cast (threads move to Unsorted)"
                          aria-label={`Delete cast ${cast.name}`}
                        >
                          <IconTrash />
                        </button>
                        <button
                          type="button"
                          className="cast-group-btn"
                          onClick={() => onNew(cast.id)}
                          title={`New thread with ${cast.name}`}
                          aria-label={`New thread in ${cast.name}`}
                        >
                          <IconNew />
                        </button>
                      </div>
                    )
                  )}
                </div>

                <Collapse open={isOpen}>
                  <div className="cast-group-list">
                    {list.length === 0 ? (
                      <button
                        type="button"
                        className="cast-group-empty"
                        onClick={() => onNew(cast.id)}
                      >
                        Start the first thread
                      </button>
                    ) : (
                      list.map((c) => (
                        <ChatRow
                          key={c.id}
                          chat={c}
                          active={activeId === c.id}
                          onSelect={onSelect}
                          onDelete={onDelete}
                          onRename={onRename}
                        />
                      ))
                    )}
                  </div>
                </Collapse>
              </section>
            );
          })}

          {unsorted.length > 0 && (
            <section className="cast-group is-unsorted">
              <div className="cast-group-head">
                <button
                  type="button"
                  className="cast-group-toggle"
                  onClick={() => toggle(UNSORTED)}
                  aria-expanded={q ? true : !collapsed.has(UNSORTED)}
                >
                  <IconChevron />
                  <span className="cast-group-name">Unsorted</span>
                  <span className="cast-group-count">{unsorted.length}</span>
                </button>
              </div>
              <Collapse open={!!q || !collapsed.has(UNSORTED)}>
                <div className="cast-group-list">
                  {unsorted.map((c) => (
                    <ChatRow
                      key={c.id}
                      chat={c}
                      active={activeId === c.id}
                      onSelect={onSelect}
                      onDelete={onDelete}
                      onRename={onRename}
                    />
                  ))}
                </div>
              </Collapse>
            </section>
          )}

          {!q &&
            (creating ? (
              <div className="cast-create">
                <input
                  autoFocus
                  className="chat-rename-input"
                  value={newName}
                  placeholder="Name the cast…"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitNewCast();
                    else if (e.key === "Escape") {
                      setCreating(false);
                      setNewName("");
                    }
                    e.stopPropagation();
                  }}
                  onBlur={commitNewCast}
                  aria-label="New cast name"
                />
                <p>Starts as a copy of the current voices.</p>
              </div>
            ) : (
              <button
                type="button"
                className="cast-add"
                onClick={() => setCreating(true)}
              >
                <IconNew />
                New cast
              </button>
            ))}
        </div>

        <div className="rail-foot">
          <span className={`key-state ${needsKey ? "is-missing" : "is-ok"}`}>
            <IconKey />
            {needsKey ? "API key needed" : "Key connected"}
          </span>
          <span className="rail-foot-mute">{threadLabel}</span>
        </div>
      </div>
    </aside>
  );
}
