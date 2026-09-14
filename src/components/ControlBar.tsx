import { memo, useEffect, useRef, useState } from "react";
import type { AppStatus, ConversationMode } from "../types";

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
  needsKey?: boolean;
  onOpenSettings?: () => void;
}

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
  needsKey = false,
  onOpenSettings,
}: Props) {
  const progress =
    mode === "step"
      ? 0
      : Math.min((turnCount / Math.max(maxTurns, 1)) * 100, 100);
  const running = status === "Running";
  const isStep = mode === "step";
  const statusLabel = running
    ? "Writing"
    : status === "Paused"
      ? "Paused"
      : "Ready";
  const tokenRatio = tokenCapacity > 0 ? tokenUsed / tokenCapacity : 0;
  const tokenPct = Math.round(tokenRatio * 100);
  const tokenColor =
    tokenRatio > 0.8
      ? "var(--danger)"
      : tokenRatio > 0.6
        ? "var(--text-2)"
        : "var(--faint)";

  const [moreOpen, setMoreOpen] = useState(false);
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

  const secondary = (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          setMoreOpen(false);
          onSaveChat();
        }}
        disabled={!hasMessages}
      >
        Save
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          setMoreOpen(false);
          onExport();
        }}
        disabled={!hasMessages}
      >
        Export
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          setMoreOpen(false);
          onReset();
        }}
      >
        New
      </button>
    </>
  );

  return (
    <div className="dock" role="toolbar" aria-label="Conversation controls">
      <div className="dock-lead">
        <div className="dock-stat" aria-live="polite">
          <span
            className={`dot ${running ? "run" : status === "Paused" ? "pause" : ""}`}
            aria-hidden
          />
          <span className="dock-status">{statusLabel}</span>
          {!isStep && (
            <>
              <span className="dock-turns">
                {turnCount}/{maxTurns}
              </span>
              <span className="bar" aria-hidden>
                <i style={{ width: `${progress}%` }} />
              </span>
            </>
          )}
          <span className="ctx-bar" title="Estimated context use">
            <span className="ctx-pct" style={{ color: tokenColor }}>
              {tokenPct}%
            </span>
            <span className="bar ctx" aria-hidden>
              <i
                style={{
                  width: `${Math.min(tokenPct, 100)}%`,
                  background: tokenColor,
                }}
              />
            </span>
          </span>
        </div>

        <div className="seg dock-mode" role="group" aria-label="Run mode">
          <button
            type="button"
            className={mode === "step" ? "on" : ""}
            aria-pressed={mode === "step"}
            title="One reply at a time"
            onClick={() => onModeChange("step")}
          >
            Step
          </button>
          <button
            type="button"
            className={mode === "auto" ? "on" : ""}
            aria-pressed={mode === "auto"}
            title="Keep talking until you pause"
            onClick={() => onModeChange("auto")}
          >
            Auto
          </button>
        </div>
      </div>

      <div className="dock-actions">
        {needsKey ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onOpenSettings?.()}
          >
            Add key
          </button>
        ) : isStep ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onStep}
            disabled={running || !hasMessages}
            title={
              nextName ? `Let ${nextName} speak next` : "Advance one turn"
            }
          >
            Next
            {nextName ? (
              <span className="dock-next-name"> · {nextName}</span>
            ) : null}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onToggle}>
            {running ? "Pause" : status === "Paused" ? "Resume" : "Start"}
          </button>
        )}

        <button
          type="button"
          className={`btn ${status === "Idle" ? "btn-ghost" : "btn-danger"}`}
          onClick={onStop}
          disabled={status === "Idle"}
          title="Stop generation, keep chat"
        >
          Stop
        </button>

        {retryTarget && onRetry && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRetry}
            title={`Retry ${retryTarget.agent} turn ${retryTarget.turn}`}
          >
            Retry
          </button>
        )}

        <div className="dock-wide">{secondary}</div>

        <div className="dock-narrow" ref={moreRef}>
          <button
            type="button"
            className="btn btn-ghost"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
          >
            More
          </button>
          {moreOpen && (
            <div className="dock-menu" role="menu">
              {secondary}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(ControlBar);
