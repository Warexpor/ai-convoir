import { memo } from "react";
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
}: Props) {
  const progress =
    mode === "step"
      ? 0
      : Math.min((turnCount / Math.max(maxTurns, 1)) * 100, 100);
  const running = status === "Running";
  const isStep = mode === "step";
  const tokenRatio = tokenCapacity > 0 ? tokenUsed / tokenCapacity : 0;
  const tokenPct = Math.round(tokenRatio * 100);
  const tokenColor =
    tokenRatio > 0.8
      ? "var(--danger)"
      : tokenRatio > 0.6
        ? "var(--text-2)"
        : "var(--faint)";

  return (
    <div className="dock">
      <div className="dock-stat">
        <span
          className={`dot ${running ? "run" : status === "Paused" ? "pause" : ""}`}
          aria-hidden
        />
        <span className="dock-status">{status}</span>
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

      <div className="seg" role="group" aria-label="Run mode">
        <button
          type="button"
          className={mode === "step" ? "on" : ""}
          aria-pressed={mode === "step"}
          onClick={() => onModeChange("step")}
        >
          Step
        </button>
        <button
          type="button"
          className={mode === "auto" ? "on" : ""}
          aria-pressed={mode === "auto"}
          onClick={() => onModeChange("auto")}
        >
          Auto
        </button>
      </div>

      <div className="spacer" />

      {isStep ? (
        <button
          type="button"
          className="btn btn-primary"
          onClick={onStep}
          disabled={running}
        >
          Step
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

      <button type="button" className="btn btn-ghost" onClick={onSaveChat}>
        Save
      </button>
      <button type="button" className="btn btn-ghost" onClick={onExport}>
        Export
      </button>
      <button type="button" className="btn btn-ghost" onClick={onReset}>
        New
      </button>
    </div>
  );
}

export default memo(ControlBar);
