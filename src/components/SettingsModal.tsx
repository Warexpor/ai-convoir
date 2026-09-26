import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useBackClose } from "../hooks/useBackClose";
import { usePresence } from "../hooks/usePresence";
import { PHONE_QUERY, useMedia } from "../hooks/useMedia";
import type { InnerState } from "../types";
import { type FxLevel, type StreamMode } from "../lib/config";
import ProviderKeys from "./ProviderKeys";
import { deleteApi, listApis, type SavedApi } from "../lib/storage";
import { SHADER_PRESETS, type BackgroundPrefs, type ShaderPreset } from "../lib/background";
import { presetThumb } from "./StageField";
import Seg from "./Seg";
import { SHORTCUTS } from "./ShortcutsModal";
import {
  IconKey,
  IconLive,
  IconSliders,
  IconSpark,
  IconThreads,
  IconBack,
} from "./Marks";

export type SettingsTab = "conversation" | "appearance" | "access" | "shortcuts";

const TABS: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  { id: "conversation", label: "Conversation", icon: <IconThreads /> },
  { id: "appearance", label: "Appearance", icon: <IconSpark /> },
  { id: "access", label: "Providers", icon: <IconKey /> },
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
  bg: BackgroundPrefs;
  onBg: (v: BackgroundPrefs) => void;
  bgUrl: string | null;
  onPickBgImage: (f: File) => Promise<void>;
  onRemoveBgImage: () => void;
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

function thumbStyle(id: ShaderPreset) {
  const url = presetThumb(id);
  return url ? { backgroundImage: `url("${url}")` } : undefined;
}

function BackgroundRows({
  bg,
  onBg,
  url,
  onPick,
  onRemove,
}: {
  bg: BackgroundPrefs;
  onBg: (v: BackgroundPrefs) => void;
  url: string | null;
  onPick: (f: File) => Promise<void>;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);
  // Ranges commit live — the image layer is static, so this is cheap.
  const set = (p: Partial<BackgroundPrefs>) => onBg({ ...bg, ...p });

  const take = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setErr("");
    try {
      await onPick(f);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const preset = SHADER_PRESETS.find((p) => p.id === bg.preset);
  const picker = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        void take(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  return (
    <>
      <Row
        title="Background"
        hint={
          bg.kind === "shader"
            ? preset?.hint
            : "Your own picture behind the stage, darkened so text stays legible."
        }
        stack
      >
        <Seg
          size="sm"
          label="Background kind"
          value={bg.kind}
          onChange={(kind) => set({ kind })}
          options={[
            { value: "shader", label: "Shader" },
            { value: "image", label: "Image" },
          ]}
        />
        {bg.kind === "shader" ? (
          <div className="bg-presets" role="radiogroup" aria-label="Shader preset">
            {SHADER_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={bg.preset === p.id}
                className={`bg-preset${bg.preset === p.id ? " on" : ""}`}
                onClick={() => set({ preset: p.id })}
              >
                <i className="bg-swatch" style={thumbStyle(p.id)} aria-hidden />
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        ) : url ? (
          <div className="bg-image-row">
            <i
              className="bg-thumb"
              style={{
                backgroundImage: `url("${url}")`,
                filter: bg.mono ? "grayscale(1)" : undefined,
              }}
              aria-hidden
            />
            <div className="bg-image-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? "Loading…" : "Replace"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
                Remove
              </button>
            </div>
            {picker}
          </div>
        ) : (
          <>
            <button
              type="button"
              className={`bg-drop${over ? " is-over" : ""}`}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                void take(e.dataTransfer.files?.[0]);
              }}
            >
              {busy ? "Loading…" : "Choose an image"}
              <small>or drop one here · stays on this device</small>
            </button>
            {picker}
          </>
        )}
        {err && <span className="field-error">{err}</span>}
      </Row>

      {bg.kind === "image" && url && (
        <>
          <Row title="Dim" hint={`${Math.round(bg.dim * 100)}% black over the picture.`} stack>
            <input
              className="range"
              type="range"
              min={0}
              max={90}
              step={5}
              value={Math.round(bg.dim * 100)}
              style={{ ["--range" as string]: `${(bg.dim / 0.9) * 100}%` }}
              onChange={(e) => set({ dim: (parseInt(e.target.value, 10) || 0) / 100 })}
            />
          </Row>
          <Row title="Blur" hint={bg.blur ? `${bg.blur}px` : "Sharp"} stack>
            <input
              className="range"
              type="range"
              min={0}
              max={32}
              step={2}
              value={bg.blur}
              style={{ ["--range" as string]: `${(bg.blur / 32) * 100}%` }}
              onChange={(e) => set({ blur: parseInt(e.target.value, 10) || 0 })}
            />
          </Row>
          <Row title="Monochrome" hint="Strip the color to match the rest of the stage.">
            <Seg
              size="sm"
              label="Monochrome"
              value={bg.mono ? "on" : "off"}
              onChange={(v) => set({ mono: v === "on" })}
              options={[
                { value: "on", label: "On" },
                { value: "off", label: "Off" },
              ]}
            />
          </Row>
        </>
      )}
    </>
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
  bg,
  onBg,
  bgUrl,
  onPickBgImage,
  onRemoveBgImage,
  zoom,
  onZoom,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const shown = usePresence(open, 220);
  useFocusTrap(open, cardRef);
  useBackClose(open, onClose);

  const isPhone = useMedia(PHONE_QUERY);
  // Draft fields that would be noisy to commit per keystroke.
  const [delay, setDelay] = useState(config?.delay_ms ?? 800);
  const [turns, setTurns] = useState(String(config?.max_turns ?? 40));
  const [seed, setSeed] = useState(config?.seed_prompt ?? "");
  const [apis, setApis] = useState<SavedApi[]>(() => listApis());

  useEffect(() => {
    if (!open || !config) return;
    setDelay(config.delay_ms);
    setTurns(String(config.max_turns));
    setSeed(config.seed_prompt || "");
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
              className={`prefs-tab prefs-tab-${t.id}${tab === t.id ? " on" : ""}`}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => onTab(t.id)}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
          <span className="prefs-version">AI ConvoIR 2.0</span>
        </nav>

        <div className="prefs-main">
          <div className="prefs-head">
            <button
              type="button"
              className="btn btn-icon btn-bare sheet-back"
              onClick={onClose}
              aria-label="Back"
            >
              <IconBack />
            </button>
            <h2>
              <span className="prefs-h-tab">{TABS.find((t) => t.id === tab)?.label}</span>
              <span className="prefs-h-app">Settings</span>
            </h2>
            <button type="button" className="btn btn-chrome btn-sm sheet-close" onClick={onClose}>
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
                <BackgroundRows
                  bg={bg}
                  onBg={onBg}
                  url={bgUrl}
                  onPick={onPickBgImage}
                  onRemove={onRemoveBgImage}
                />
                <Row
                  title="Effects"
                  hint={
                    bg.kind === "image" && bgUrl
                      ? `${fx === "lite" ? "No blur anywhere." : "Glass blur on menus and sheets."} Your picture is static either way.`
                      : FX_HINT[fx]
                  }
                  stack
                >
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
                <Row
                  title="Interface size"
                  hint={isPhone ? undefined : "Also Ctrl + / Ctrl − anywhere."}
                >
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
                <ProviderKeys config={config} />
                {apis.length > 0 && (
                  <Row title="Old saved keys" hint="From an earlier version. Delete them; they aren’t used." stack>
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
