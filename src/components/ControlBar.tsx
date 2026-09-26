import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import {
  IconExport,
  IconHint,
  IconKey,
  IconMore,
  IconNew,
  IconNextVoice,
  IconPause,
  IconPlay,
  IconReturn,
  IconRetry,
  IconSave,
  IconStop,
} from "./Marks";
import type { AppStatus, ConversationMode } from "../types";
import Seg from "./Seg";

interface Props {
  status: AppStatus;
  turnCount: number;
  maxTurns: number;
  mode: ConversationMode;
  onToggle: () => void;
  onStep: () => void;
  onStop: () => void;
  onReset: () => void;
  onExport: () => void;
  onModeChange: (mode: ConversationMode) => void;
  onSaveChat: () => void;
  tokenUsed?: number;
  tokenCapacity?: number;
  retryTarget?: { agent: string; turn: number } | null;
  onRetry?: () => void;
  hasMessages?: boolean;
  nextName?: string | null;
  nextAccent?: string;
  needsKey?: boolean;
  onOpenSettings?: () => void;
  hint: string;
  onHintChange: (v: string) => void;
  onHintCommit: (v: string) => void;
}

/** One dock: whisper to the next voice on top, transport underneath. */
function ControlBar({
  status,
  turnCount,
  maxTurns,
  mode,
  onToggle,
  onStep,
  onStop,
  onReset,
  onExport,
  onModeChange,
  onSaveChat,
  tokenUsed = 0,
  tokenCapacity = 128000,
  retryTarget,
  onRetry,
  hasMessages = false,
  nextName = null,
  nextAccent,
  needsKey = false,
  onOpenSettings,
  hint,
  onHintChange,
  onHintCommit,
}: Props) {
  const running = status === "Running";
  const isStep = mode === "step";
  const progress = isStep
    ? 0
    : Math.min((turnCount / Math.max(maxTurns, 1)) * 100, 100);
  const statusLabel = running ? "Live" : status === "Paused" ? "Paused" : "Ready";
  const tokenRatio = tokenCapacity > 0 ? tokenUsed / tokenCapacity : 0;
  const tokenPct = Math.round(tokenRatio * 100);
  const ctxLevel = tokenRatio > 0.8 ? "hot" : tokenRatio > 0.6 ? "warm" : "cool";

  const [moreOpen, setMoreOpen] = useState(false);
  const [queued, setQueued] = useState(false);
  useEffect(() => {
    if (!hint.trim()) setQueued(false);
  }, [hint]);
  const commitHint = () => {
    if (!hint.trim()) return;
    onHintCommit(hint);
    setQueued(true);
  };
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const menuItem = (
    label: string,
    icon: ReactNode,
    run: () => void,
    kbd: string,
    disabled = false,
  ) => (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      disabled={disabled}
      onClick={() => {
        setMoreOpen(false);
        run();
      }}
    >
      {icon}
      <span>{label}</span>
      <kbd>{kbd}</kbd>
    </button>
  );

  const who = nextName ?? "the next voice";
  const goLabel = running ? "Pause" : status === "Paused" ? "Resume" : "Run";

  return (
    <div
      className={`dock glass${running ? " is-running" : ""}`}
      role="toolbar"
      aria-label="Conversation controls"
      style={nextAccent ? { ["--voice" as string]: nextAccent } : undefined}
    >
      {!isStep && (
        <span className="dock-progress" aria-hidden>
          <i style={{ transform: `scaleX(${progress / 100})` }} />
        </span>
      )}

      <label
        className={`whisper${running ? " is-disabled" : ""}${queued ? " is-queued" : ""}`}
      >
        <IconHint />
        <input
          value={hint}
          disabled={running}
          placeholder={
            running ? `${who} is writing…` : `Whisper to ${who} — steer their next line`
          }
          aria-label={`Hint for ${who}`}
          onChange={(e) => {
            setQueued(false);
            onHintChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hint.trim()) {
              e.preventDefault();
              commitHint();
            }
            if (e.key === "Escape") {
              onHintChange("");
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {queued && <span className="whisper-tag">queued</span>}
        {hint.trim() && !running && !queued && (
          <button
            type="button"
            className="whisper-send"
            onClick={commitHint}
            aria-label="Send hint"
            title="Send hint (Enter)"
          >
            <IconReturn />
          </button>
        )}
      </label>

      <div className="dock-row">
        <div className="dock-lead">
          <Seg
            label="Run mode"
            value={mode}
            onChange={onModeChange}
            options={[
              { value: "step", label: "Step", title: "One reply at a time" },
              { value: "auto", label: "Auto", title: "Keep talking until you pause" },
            ]}
          />

          <span
            className={`status-pill is-${status.toLowerCase()}`}
            aria-live="polite"
          >
            <span className="status-dot" aria-hidden />
            {statusLabel}
            {!isStep && (
              <span className="status-turns">
                {turnCount}
                <span>/{maxTurns}</span>
              </span>
            )}
          </span>

          {tokenPct >= 50 && (
            <span
              className={`ctx-meter is-${ctxLevel}`}
              title="How full the conversation context is"
            >
              <span className="ctx-track" aria-hidden>
                <i style={{ transform: `scaleX(${Math.min(tokenPct, 100) / 100})` }} />
              </span>
              {tokenPct}% ctx
            </span>
          )}
        </div>

        <div className="dock-actions">
          {retryTarget && onRetry && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onRetry}
              title={`Retry ${retryTarget.agent} turn ${retryTarget.turn}`}
            >
              <IconRetry />
              Retry
            </button>
          )}

          <button
            type="button"
            className="btn btn-icon btn-stop"
            onClick={onStop}
            disabled={status === "Idle"}
            title="Stop generation, keep chat (Esc)"
            aria-label="Stop"
          >
            <IconStop />
          </button>

          <div className="dock-more" ref={moreRef}>
            <button
              type="button"
              className="btn btn-icon"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-label="More actions"
              title="More"
              onClick={() => setMoreOpen((o) => !o)}
            >
              <IconMore />
            </button>
            {moreOpen && (
              <div className="menu" role="menu">
                {menuItem("Save thread", <IconSave />, onSaveChat, "Ctrl+S", !hasMessages)}
                {menuItem("Export markdown", <IconExport />, onExport, "Ctrl+E", !hasMessages)}
                {menuItem("New thread", <IconNew />, onReset, "Ctrl+Shift+R")}
              </div>
            )}
          </div>

          {needsKey ? (
            <button
              type="button"
              className="btn btn-go"
              onClick={() => onOpenSettings?.()}
            >
              <IconKey />
              Add key
            </button>
          ) : isStep ? (
            <button
              type="button"
              className="btn btn-go"
              onClick={onStep}
              disabled={running || !hasMessages}
              title={nextName ? `Let ${nextName} speak (N)` : "Advance one turn (N)"}
            >
              <IconNextVoice />
              <span className="btn-go-label">
                <span key={running ? "w" : "n"} className="swap">
                  {running ? "Writing" : "Next"}
                </span>
                {nextName && (
                  <em key={nextName} className="swap">
                    {nextName}
                  </em>
                )}
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-go"
              onClick={onToggle}
              title="Start / pause (Space)"
            >
              <span className={`go-icon${running ? " is-alt" : ""}`} aria-hidden>
                <IconPlay />
                <IconPause />
              </span>
              <span className="btn-go-label">
                <span key={goLabel} className="swap">
                  {goLabel}
                </span>
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(ControlBar);
