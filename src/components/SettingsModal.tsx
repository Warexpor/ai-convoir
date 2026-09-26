import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { usePresence } from "../hooks/usePresence";
import type { InnerState } from "../types";
import { OPENCODE_GO_BASE } from "../types";
import {
  sharedKeyOf,
  withSharedKey,
  type FxLevel,
  type StreamMode,
} from "../lib/config";
import { fetchModels } from "../lib/api";
import { deleteApi, listApis, type SavedApi } from "../lib/storage";
import Seg from "./Seg";
import { SHORTCUTS } from "./ShortcutsModal";
import {
  IconKey,
  IconLive,
  IconSliders,
  IconSpark,
  IconThreads,
} from "./Marks";

export type SettingsTab = "conversation" | "appearance" | "access" | "shortcuts";

const TABS: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  { id: "conversation", label: "Conversation", icon: <IconThreads /> },
  { id: "appearance", label: "Appearance", icon: <IconSpark /> },
  { id: "access", label: "Access", icon: <IconKey /> },
  { id: "shortcuts", label: "Shortcuts", icon: <IconSliders /> },
];

const ZOOMS = [0.9, 1, 1.1, 1.25];

interface Props {
  open: boolean;
  tab: SettingsTab;
  onTab: (t: SettingsTab) => void;
  onClose: () => void;
  config: InnerState | null;
  onSaveConfig: (cfg: InnerState) => void;
  streamMode: StreamMode;
  onStreamMode: (m: StreamMode) => void;
  showThoughts: boolean;
  onShowThoughts: (v: boolean) => void;
  fx: FxLevel;
  onFx: (v: FxLevel) => void;
  zoom: number;
  onZoom: (z: number) => void;
}

function Row({
  title,
  hint,
  children,
  stack,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  stack?: boolean;
}) {
  return (
    <div className={`set-row${stack ? " is-stack" : ""}`}>
      <div className="set-row-text">
        <span className="set-row-title">{title}</span>
        {hint && <span className="set-row-hint">{hint}</span>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

const STREAM_HINT: Record<StreamMode, string> = {
  live: "Words ink in as they arrive. Finished paragraphs render as markdown right away.",
  paragraph: "No token flicker. Each paragraph drops in once it is complete.",
  whole: "Streaming off. The reply lands in one piece when the voice is done.",
};

const FX_HINT: Record<FxLevel, string> = {
  full: "The stage drifts constantly. Prettiest, and the hungriest.",
  balanced: "The stage shifts light when the speaker changes, then rests.",
  lite: "Still stage, no blur. Pick this if anything stutters.",
};

export default function SettingsModal({
  open,
  tab,
  onTab,
  onClose,
  config,
  onSaveConfig,
  streamMode,
  onStreamMode,
  showThoughts,
  onShowThoughts,
  fx,
  onFx,
  zoom,
  onZoom,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const shown = usePresence(open, 220);
  useFocusTrap(open, cardRef);

  // Draft fields that would be noisy to commit per keystroke.
  const [delay, setDelay] = useState(config?.delay_ms ?? 800);
  const [turns, setTurns] = useState(String(config?.max_turns ?? 40));
  const [seed, setSeed] = useState(config?.seed_prompt ?? "");
  const [key, setKey] = useState(config ? sharedKeyOf(config) : "");
  const [keyState, setKeyState] = useState<
    { kind: "idle" } | { kind: "checking" } | { kind: "ok" } | { kind: "err"; msg: string }
  >({ kind: "idle" });
  const [apis, setApis] = useState<SavedApi[]>(() => listApis());

  useEffect(() => {
    if (!open || !config) return;
    setDelay(config.delay_ms);
    setTurns(String(config.max_turns));
    setSeed(config.seed_prompt || "");
    setKey(sharedKeyOf(config));
    setKeyState({ kind: "idle" });
    setApis(listApis());
    // Re-seed drafts only when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Commit the slider after the hand stops moving.
  useEffect(() => {
    if (!config || delay === config.delay_ms) return;
    const t = window.setTimeout(() => onSaveConfig({ ...config, delay_ms: delay }), 300);
    return () => window.clearTimeout(t);
  }, [delay, config, onSaveConfig]);

  if (!shown) return null;

  const patch = (p: Partial<InnerState>) => config && onSaveConfig({ ...config, ...p });
  const savedKey = config ? sharedKeyOf(config) : "";
  const keyDirty = key.trim() !== savedKey;

  const saveKey = () => {
    if (!config) return;
    onSaveConfig(withSharedKey(config, key.trim()));
  };

  const checkKey = async () => {
    setKeyState({ kind: "checking" });
    try {
      await fetchModels({ baseUrl: OPENCODE_GO_BASE, apiKey: key.trim() });
      setKeyState({ kind: "ok" });
    } catch (e) {
      setKeyState({ kind: "err", msg: String(e) });
    }
  };

  return (
    <div
      className={`modal-backdrop settings-backdrop ${open ? "" : "is-leaving"}`}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={cardRef}
        className="modal-card prefs"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prefs-title"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="prefs-nav" aria-label="Settings sections">
          <span className="prefs-title" id="prefs-title">
            Settings
          </span>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`prefs-tab${tab === t.id ? " on" : ""}`}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => onTab(t.id)}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
          <span className="prefs-version">AI Conversation 2.0</span>
        </nav>

        <div className="prefs-main">
          <div className="prefs-head">
            <h2>{TABS.find((t) => t.id === tab)?.label}</h2>
            <button type="button" className="btn btn-chrome btn-sm" onClick={onClose}>
              Done
            </button>
          </div>

          <div className="prefs-body" key={tab}>
            {tab === "conversation" && (
              <>
                <Row title="Streaming" hint={STREAM_HINT[streamMode]} stack>
                  <Seg
                    label="Streaming"
                    value={streamMode}
                    onChange={onStreamMode}
                    options={[
                      {
                        value: "live",
                        label: (
                          <>
                            <IconLive /> Live
                          </>
                        ),
                      },
                      { value: "paragraph", label: "By paragraph" },
                      { value: "whole", label: "Whole reply" },
                    ]}
                  />
                </Row>
                <Row title="Show thinking" hint="Reasoning appears as a collapsible note above each reply.">
                  <Seg
                    size="sm"
                    label="Show thinking"
                    value={showThoughts ? "on" : "off"}
                    onChange={(v) => onShowThoughts(v === "on")}
                    options={[
                      { value: "on", label: "On" },
                      { value: "off", label: "Off" },
                    ]}
                  />
                </Row>
                <Row title="Run mode" hint="Step waits for you; Auto keeps talking until it hits the turn limit.">
                  <Seg
                    size="sm"
                    label="Run mode"
                    value={config?.mode ?? "step"}
                    onChange={(m) => patch({ mode: m })}
                    options={[
                      { value: "step", label: "Step" },
                      { value: "auto", label: "Auto" },
                    ]}
                  />
                </Row>
                <Row title="Pause between turns" hint={`${(delay / 1000).toFixed(1)}s of silence before the next voice.`} stack>
                  <input
                    className="range"
                    type="range"
                    min={0}
                    max={4000}
                    step={100}
                    value={delay}
                    disabled={!config}
                    style={{ ["--range" as string]: `${(delay / 4000) * 100}%` }}
                    onChange={(e) => setDelay(parseInt(e.target.value, 10) || 0)}
                  />
                </Row>
                <Row title="Turn limit" hint="Auto mode stops after this many turns.">
                  <input
                    className="text-input num"
                    type="number"
                    min={1}
                    max={999}
                    value={turns}
                    disabled={!config}
                    onChange={(e) => setTurns(e.target.value)}
                    onBlur={() => {
                      const n = Math.max(1, Math.min(999, parseInt(turns, 10) || 40));
                      setTurns(String(n));
                      if (config && n !== config.max_turns) patch({ max_turns: n });
                    }}
                  />
                </Row>
                <Row title="Fallback first line" hint="Used only if you begin without typing." stack>
                  <textarea
                    className="text-input"
                    rows={3}
                    value={seed}
                    disabled={!config}
                    placeholder="Two strangers share a window on a night train…"
                    onChange={(e) => setSeed(e.target.value)}
                    onBlur={() => config && seed !== (config.seed_prompt || "") && patch({ seed_prompt: seed })}
                  />
                </Row>
              </>
            )}

            {tab === "appearance" && (
              <>
                <Row title="Effects" hint={FX_HINT[fx]} stack>
                  <Seg
                    label="Effects"
                    value={fx}
                    onChange={onFx}
                    options={[
                      { value: "full", label: "Full" },
                      { value: "balanced", label: "Balanced" },
                      { value: "lite", label: "Lite" },
                    ]}
                  />
                </Row>
                <Row title="Interface size" hint="Also Ctrl + / Ctrl − anywhere.">
                  <Seg
                    size="sm"
                    label="Interface size"
                    value={ZOOMS.includes(zoom) ? zoom : 1}
                    onChange={onZoom}
                    options={ZOOMS.map((z) => ({ value: z, label: `${Math.round(z * 100)}%` }))}
                  />
                </Row>
              </>
            )}

            {tab === "access" && (
              <>
                <Row
                  title="OpenCode Go key"
                  hint={
                    <>
                      One key powers every voice. Model is locked to{" "}
                      <code>muse-spark-1.3-contributor</code>.
                    </>
                  }
                  stack
                >
                  <div className="key-line">
                    <input
                      className="text-input"
                      type="password"
                      autoComplete="new-password"
                      data-1p-ignore="true"
                      data-lpignore="true"
                      spellCheck={false}
                      placeholder="sk-…"
                      value={key}
                      disabled={!config}
                      onChange={(e) => {
                        setKey(e.target.value);
                        setKeyState({ kind: "idle" });
                      }}
                      onKeyDown={(e) => e.key === "Enter" && keyDirty && saveKey()}
                    />
                    <button
                      type="button"
                      className="btn btn-go btn-sm"
                      disabled={!keyDirty}
                      onClick={saveKey}
                    >
                      {keyDirty ? "Save" : "Saved"}
                    </button>
                  </div>
                  <div className="key-status">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={!key.trim() || keyState.kind === "checking"}
                      onClick={checkKey}
                    >
                      {keyState.kind === "checking" ? "Checking…" : "Check key"}
                    </button>
                    {keyState.kind === "ok" && <span className="key-ok">Key works</span>}
                    {keyState.kind === "err" && <span className="field-error">{keyState.msg}</span>}
                  </div>
                </Row>
                {apis.length > 0 && (
                  <Row title="Saved keys" stack>
                    <div className="api-list">
                      {apis.map((a) => (
                        <div key={a.id} className="api-row">
                          <span>{a.name}</span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              deleteApi(a.id);
                              setApis(listApis());
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  </Row>
                )}
              </>
            )}

            {tab === "shortcuts" && (
              <div className="shortcut-list">
                {SHORTCUTS.map((r) => (
                  <div key={r.keys} className="shortcut-row">
                    <kbd className="kbd">{r.keys}</kbd>
                    <span>{r.action}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
