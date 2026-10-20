import { useMemo, useRef, useState } from "react";
import type { SavedChat } from "../lib/storage";
import { renameChat } from "../lib/storage";
import type { Cast } from "../lib/casts";
import { agentAccent, agentConfig, type VoiceSource } from "../types";
import VoiceAvatar from "./VoiceAvatar";
import {
  IconGear,
  IconNew,
  IconPlus,
  IconRailHide,
  IconSearch,
  IconThreads,
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
  onSettings: () => void;
  needsKey?: boolean;
}

const ALL = "__all";
const UNSORTED = "__unsorted";
const DAY = 86_400_000;

/** The cast in miniature: overlapping avatars, same glyphs as on stage. */
function VoiceStack({ src }: { src: VoiceSource & { bot_count: number } }) {
  const n = src.bot_count >= 3 ? 3 : 2;
  return (
    <span className="voice-stack" aria-hidden>
      {Array.from({ length: n }, (_, i) => {
        const id = `ai${i + 1}`;
        const cfg = agentConfig(id, src);
        return (
          <VoiceAvatar
            key={id}
            className="stack-avatar"
            name={cfg?.name || "Voice"}
            icon={cfg?.icon}
            color={agentAccent(id, src)}
          />
        );
      })}
    </span>
  );
}

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Today / Yesterday / This week / Earlier, like the History screen. */
function bucketOf(t: number, today: number): string {
  if (t >= today) return "Today";
  if (t >= today - DAY) return "Yesterday";
  if (t >= today - 6 * DAY) return "This week";
  return "Earlier";
}

function stampOf(t: number, today: number): string {
  const d = new Date(t);
  if (t >= today) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (t >= today - 6 * DAY) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function lastLine(chat: SavedChat): string {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const t = chat.messages[i]?.content?.replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim();
    if (t) return t;
  }
  return "";
}

function ChatRow({
  chat,
  active,
  stamp,
  onSelect,
  onDelete,
  onRename,
}: {
  chat: SavedChat;
  active: boolean;
  stamp: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [text, setText] = useState("");
  const rowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const line = lastLine(chat);

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
      className={`thread${active ? " on" : ""}${leaving ? " is-leaving" : ""}${confirming ? " is-confirming" : ""}`}
      inert={leaving}
    >
      {renaming ? (
        <input
          ref={inputRef}
          className="thread-rename"
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
      ) : (
        <button
          type="button"
          className="thread-main"
          onClick={() => onSelect(chat.id)}
          onDoubleClick={() => {
            setText(chat.title);
            setRenaming(true);
            requestAnimationFrame(() => inputRef.current?.select());
          }}
          aria-current={active ? "page" : undefined}
          title="Double-click to rename"
        >
          <span className="thread-title">{chat.title}</span>
          {line && <span className="thread-line">{line}</span>}
        </button>
      )}

      {confirming ? (
        <div className="inline-confirm">
          <button
            type="button"
            className="confirm-del"
            onClick={() => {
              setConfirming(false);
              remove();
            }}
          >
            Delete
          </button>
          <button type="button" className="confirm-cancel" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </div>
      ) : (
        !renaming && (
          <span className="thread-aside">
            <span className="thread-time">{stamp}</span>
            <button
              type="button"
              className="icon-btn thread-del"
              title="Delete thread"
              aria-label={`Delete ${chat.title}`}
              onClick={() => setConfirming(true)}
            >
              <IconTrash />
            </button>
          </span>
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
  onSettings,
  needsKey = false,
}: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>(ALL);
  const [renamingCast, setRenamingCast] = useState<string | null>(null);
  const [castText, setCastText] = useState("");
  const [confirmCast, setConfirmCast] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const castInputRef = useRef<HTMLInputElement>(null);

  const known = useMemo(() => new Set(casts.map((c) => c.id)), [casts]);
  const castOf = (c: SavedChat) => (c.cast_id && known.has(c.cast_id) ? c.cast_id : UNSORTED);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of chats) {
      const k = c.cast_id && known.has(c.cast_id) ? c.cast_id : UNSORTED;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [chats, known]);
  // A filter on a cast that no longer exists falls back to everything.
  const activeFilter = filter === ALL || filter === UNSORTED || known.has(filter) ? filter : ALL;

  const q = query.trim().toLowerCase();
  const today = startOfDay(Date.now());
  const sections = useMemo(() => {
    const out: { label: string; rows: SavedChat[] }[] = [];
    for (const c of chats) {
      if (activeFilter !== ALL && castOf(c) !== activeFilter) continue;
      if (q && !c.title.toLowerCase().includes(q) && !lastLine(c).toLowerCase().includes(q)) continue;
      const label = bucketOf(c.updated_at, today);
      const sec = out.find((s) => s.label === label) ?? out[out.push({ label, rows: [] }) - 1];
      sec.rows.push(c);
    }
    return out;
    // castOf only depends on `known`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats, activeFilter, q, today, known]);

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

  const unsorted = counts.get(UNSORTED) ?? 0;

  return (
    <aside className="rail glass-sheet" aria-label="History" aria-hidden={!open} inert={!open}>
      <div className="rail-head">
        <span className="wordmark">AI ConvoIR</span>
        <button
          type="button"
          className="gbtn"
          onClick={onClose}
          title="Hide history (B)"
          aria-label="Hide history"
        >
          <IconRailHide />
        </button>
      </div>

      <div className="rail-scroll">
        <div className="card nav">
          <button
            type="button"
            className={`nav-row${activeFilter === ALL ? " on" : ""}`}
            onClick={() => setFilter(ALL)}
          >
            <span className="nav-icon">
              <IconThreads />
            </span>
            <span className="nav-name">All threads</span>
            <span className="nav-count">{chats.length}</span>
          </button>

          {casts.map((cast) => {
            const isOn = activeFilter === cast.id;
            return (
              <div
                key={cast.id}
                className={`nav-row nav-cast${isOn ? " on" : ""}${cast.id === activeCastId ? " is-current" : ""}`}
              >
                {renamingCast === cast.id ? (
                  <input
                    ref={castInputRef}
                    className="thread-rename"
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
                    className="nav-hit"
                    onClick={() => setFilter(isOn ? ALL : cast.id)}
                    onDoubleClick={() => {
                      setCastText(cast.name);
                      setRenamingCast(cast.id);
                      requestAnimationFrame(() => castInputRef.current?.select());
                    }}
                    aria-pressed={isOn}
                    title="Show this cast's threads · double-click to rename"
                  >
                    <span className="nav-icon">
                      <VoiceStack src={cast} />
                    </span>
                    <span className="nav-name">{cast.name}</span>
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
                    <button type="button" className="confirm-cancel" onClick={() => setConfirmCast(null)}>
                      Keep
                    </button>
                  </div>
                ) : (
                  renamingCast !== cast.id && (
                    <span className="nav-aside">
                      <span className="nav-count">{counts.get(cast.id) ?? 0}</span>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setConfirmCast(cast.id)}
                        title="Delete cast (threads stay, unsorted)"
                        aria-label={`Delete cast ${cast.name}`}
                      >
                        <IconTrash />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => onNew(cast.id)}
                        title={`New thread with ${cast.name}`}
                        aria-label={`New thread in ${cast.name}`}
                      >
                        <IconNew />
                      </button>
                    </span>
                  )
                )}
              </div>
            );
          })}

          {unsorted > 0 && casts.length > 0 && (
            <button
              type="button"
              className={`nav-row${activeFilter === UNSORTED ? " on" : ""}`}
              onClick={() => setFilter(activeFilter === UNSORTED ? ALL : UNSORTED)}
            >
              <span className="nav-icon nav-icon-dim">
                <IconThreads />
              </span>
              <span className="nav-name">Unsorted</span>
              <span className="nav-count">{unsorted}</span>
            </button>
          )}

          {creating ? (
            <div className="nav-row nav-create">
              <input
                autoFocus
                className="thread-rename"
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
            </div>
          ) : (
            <button type="button" className="nav-row nav-add" onClick={() => setCreating(true)}>
              <span className="nav-icon">
                <IconPlus />
              </span>
              <span className="nav-name">New cast</span>
              <span className="nav-hint">copies the current voices</span>
            </button>
          )}
        </div>

        {sections.length === 0 && (
          <div className="rail-empty">
            {q ? (
              <>
                <p>No matches</p>
                <span>Nothing like &ldquo;{query}&rdquo;.</span>
              </>
            ) : (
              <>
                <p>No threads yet</p>
                <span>Set a scene and it lands here.</span>
              </>
            )}
          </div>
        )}

        {sections.map((sec) => (
          <section key={sec.label} className="threads">
            <h3 className="label">{sec.label}</h3>
            {sec.rows.map((c) => (
              <ChatRow
                key={c.id}
                chat={c}
                active={activeId === c.id}
                stamp={stampOf(c.updated_at, today)}
                onSelect={onSelect}
                onDelete={onDelete}
                onRename={onRename}
              />
            ))}
          </section>
        ))}
      </div>

      <div className="rail-foot">
        <label className="search glass">
          <IconSearch />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search threads"
          />
        </label>
        <button
          type="button"
          className={`gbtn${needsKey ? " needs-key" : ""}`}
          onClick={onSettings}
          title={needsKey ? "Settings · a key is missing (,)" : "Settings (,)"}
          aria-label="Settings"
        >
          <IconGear />
        </button>
        <button
          type="button"
          className="gbtn"
          onClick={() => onNew(activeFilter !== ALL && activeFilter !== UNSORTED ? activeFilter : undefined)}
          title="New thread (Ctrl+Shift+R)"
          aria-label="New thread"
        >
          <IconNew />
        </button>
      </div>
    </aside>
  );
}
