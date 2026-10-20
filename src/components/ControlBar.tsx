import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePresence } from "../hooks/usePresence";
import {
  IconArrowUp,
  IconBulb,
  IconExport,
  IconKey,
  IconLive,
  IconNew,
  IconPause,
  IconPlay,
  IconRetry,
  IconSave,
  IconSliders,
  IconStop,
} from "./Marks";
import type { AppStatus, ConversationMode, InnerState } from "../types";
import type { StreamMode } from "../lib/config";
import Seg from "./Seg";
import VoiceAvatar from "./VoiceAvatar";
import { agentConfig } from "../types";

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
  config: InnerState | null;
  nextId: string | null;
  nextName?: string | null;
  nextAccent?: string;
  onEditVoice?: (id: string) => void;
  needsKey?: boolean;
  onOpenSettings?: () => void;
  hint: string;
  onHintChange: (v: string) => void;
  onHintCommit: (v: string) => void;
  showThoughts: boolean;
  onShowThoughts: (v: boolean) => void;
  streamMode: StreamMode;
  onStreamMode: (m: StreamMode) => void;
}

/**
 * The composer: a glass capsule. Whisper to the next voice on top; the
 * controls panel, the next-voice pill and the send button underneath.
 */
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
  config,
  nextId,
  nextName = null,
  nextAccent,
  onEditVoice,
  needsKey = false,
  onOpenSettings,
  hint,
  onHintChange,
  onHintCommit,
  showThoughts,
  onShowThoughts,
  streamMode,
  onStreamMode,
}: Props) {
  const running = status === "Running";
  const isStep = mode === "step";
  const tokenRatio = tokenCapacity > 0 ? tokenUsed / tokenCapacity : 0;
  const tokenPct = Math.round(tokenRatio * 100);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelShown = usePresence(panelOpen, 220);
  const [queued, setQueued] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const who = nextName ?? "the next voice";

  useEffect(() => {
    if (!hint.trim()) setQueued(false);
  }, [hint]);

  // The composer floats over the transcript; publish its height so the
  // scroller can keep a runway under the last line.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const publish = () => host.style.setProperty("--dock-h", `${Math.ceil(el.offsetHeight)}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      host.style.removeProperty("--dock-h");
    };
  }, []);

  // Grow the field with its text, up to a few lines.
  useLayoutEffect(() => {
    const t = inputRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 140)}px`;
  }, [hint]);

  useEffect(() => {
    if (!panelOpen) return;
    const onDoc = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setPanelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [panelOpen]);

  /** Enter / send: Step hands the turn on (the hint rides along); Auto queues it. */
  const send = () => {
    if (needsKey) {
      onOpenSettings?.();
      return;
    }
    if (isStep) {
      if (running) onStop();
      else onStep();
      return;
    }
    if (hint.trim() && !running) {
      onHintCommit(hint);
      setQueued(true);
      return;
    }
    onToggle();
  };

  const sendIcon = isStep ? (running ? <IconStop /> : <IconArrowUp />) : running ? <IconPause /> : <IconPlay />;
  const sendLabel = isStep
    ? running
      ? "Stop"
      : `Let ${who} speak (N)`
    : running
      ? "Pause (Space)"
      : status === "Paused"
        ? "Resume (Space)"
        : "Run (Space)";

  const action = (label: string, icon: ReactNode, run: () => void) => (
    <button
      type="button"
      className="chip"
      onClick={() => {
        setPanelOpen(false);
        run();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div ref={wrapRef} className={`composer-wrap${running ? " is-running" : ""}`}>
      {panelShown && (
        <div
          className={`controls glass-sheet${panelOpen ? "" : " is-leaving"}`}
          role="dialog"
          aria-label="Conversation controls"
        >
          <span className="grabber" aria-hidden />
          <div className="controls-section">
            <span className="label">Run mode</span>
            <Seg
              label="Run mode"
              value={mode}
              onChange={onModeChange}
              options={[
                { value: "step", label: "Step", title: "One reply at a time" },
                { value: "auto", label: "Auto", title: "Keep talking until you pause" },
              ]}
            />
          </div>
          <div className="controls-section">
            <span className="label">Streaming</span>
            <Seg
              label="Streaming"
              value={streamMode}
              onChange={onStreamMode}
              options={[
                { value: "live", label: "Live" },
                { value: "paragraph", label: "By paragraph" },
                { value: "whole", label: "Whole reply" },
              ]}
            />
          </div>
          <div className="controls-chips">
            <button
              type="button"
              className={`chip chip-toggle${showThoughts ? " on" : ""}`}
              aria-pressed={showThoughts}
              onClick={() => onShowThoughts(!showThoughts)}
            >
              <IconBulb />
              <span>Thoughts</span>
            </button>
            <button
              type="button"
              className={`chip chip-toggle${streamMode !== "whole" ? " on" : ""}`}
              aria-pressed={streamMode !== "whole"}
              onClick={() => onStreamMode(streamMode === "whole" ? "live" : "whole")}
            >
              <IconLive />
              <span>Stream</span>
            </button>
          </div>
          <div className="controls-meters">
            {!isStep && (
              <div className="meter">
                <span>
                  Turn {Math.min(turnCount, maxTurns)} of {maxTurns}
                </span>
                <span className="meter-track" aria-hidden>
                  <i style={{ transform: `scaleX(${Math.min(turnCount / Math.max(maxTurns, 1), 1)})` }} />
                </span>
              </div>
            )}
            <div className="meter">
              <span>{tokenPct}% of context</span>
              <span className={`meter-track${tokenRatio > 0.8 ? " is-hot" : ""}`} aria-hidden>
                <i style={{ transform: `scaleX(${Math.min(tokenRatio, 1)})` }} />
              </span>
            </div>
          </div>
          <div className="controls-chips">
            {action("Save", <IconSave />, onSaveChat)}
            {action("Export", <IconExport />, onExport)}
            {action("New thread", <IconNew />, onReset)}
          </div>
        </div>
      )}

      <div className="composer glass">
        <textarea
          ref={inputRef}
          className="composer-input"
          rows={1}
          value={hint}
          disabled={running}
          placeholder={running ? `${who} is writing…` : `Whisper to ${who}…`}
          aria-label={`Hint for ${who}`}
          onChange={(e) => {
            setQueued(false);
            onHintChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
            if (e.key === "Escape") {
              onHintChange("");
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
        />
        <div className="composer-row">
          <button
            type="button"
            className={`gbtn${panelOpen ? " on" : ""}`}
            onClick={() => setPanelOpen((o) => !o)}
            aria-expanded={panelOpen}
            aria-label="Controls"
            title="Controls"
          >
            <IconSliders />
          </button>
          {nextId && (
            <button
              type="button"
              className="pill"
              style={nextAccent ? { ["--voice" as string]: nextAccent } : undefined}
              onClick={() => onEditVoice?.(nextId)}
              title={`Edit ${who}`}
            >
              <VoiceAvatar
                className="pill-avatar"
                name={nextName ?? "?"}
                icon={agentConfig(nextId, config)?.icon}
                color={nextAccent ?? "#8a8a8a"}
              />
              <span>{running ? `${who} is writing` : `Next: ${who}`}</span>
            </button>
          )}
          {queued && <span className="composer-tag">queued</span>}
          {!isStep && !queued && (
            <span className="composer-tag">
              {Math.min(turnCount, maxTurns)}/{maxTurns}
            </span>
          )}
          <span className="composer-spacer" />
          {retryTarget && onRetry && !running && (
            <button type="button" className="gbtn" onClick={onRetry} aria-label="Retry" title="Retry the failed turn">
              <IconRetry />
            </button>
          )}
          {!isStep && status !== "Idle" && (
            <button type="button" className="gbtn" onClick={onStop} aria-label="Stop" title="Stop, keep the thread (Esc)">
              <IconStop />
            </button>
          )}
          {needsKey ? (
            <button type="button" className="pill pill-primary" onClick={() => onOpenSettings?.()}>
              <IconKey />
              <span>Add key</span>
            </button>
          ) : (
            <button
              type="button"
              className={`send${running && isStep ? " is-stop" : ""} is-ready`}
              onClick={send}
              aria-label={sendLabel}
              title={sendLabel}
            >
              {sendIcon}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(ControlBar);
