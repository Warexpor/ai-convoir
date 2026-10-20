import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { usePresence } from "../hooks/usePresence";
import type { InnerState } from "../types";
import type { ChatText, FxLevel, StreamMode, ThemePref } from "../lib/config";
import ProviderKeys from "./ProviderKeys";
import { deleteApi, listApis, type SavedApi } from "../lib/storage";
import { SHADER_PRESETS, type BackgroundPrefs, type ShaderPreset } from "../lib/background";
import { presetThumb } from "./StageField";
import Seg from "./Seg";
import Switch from "./Switch";
import { SHORTCUTS } from "./ShortcutsModal";
import { IconBack, IconChevron, IconKey, IconKeyboard, IconPlus, IconSpark, IconThreads } from "./Marks";

export type SettingsTab = "conversation" | "appearance" | "access" | "shortcuts";

const TABS: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  { id: "conversation", label: "Conversation", icon: <IconThreads /> },
  { id: "appearance", label: "Appearance", icon: <IconSpark /> },
  { id: "access", label: "Providers", icon: <IconKey /> },
  { id: "shortcuts", label: "Shortcuts", icon: <IconKeyboard /> },
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
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
  chatText: ChatText;
  onChatText: (t: ChatText) => void;
  zoom: number;
  onZoom: (z: number) => void;
}

/** A section label over one grouped glass card. */
function Section({ label, children, foot }: { label: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <section className="set-section">
      <h3 className="label">{label}</h3>
      <div className="card">{children}</div>
      {foot && <p className="set-foot">{foot}</p>}
    </section>
  );
}

/** One 56px row: title and hint on the left, the control on the right (or under it). */
function Row({ title, hint, children, stack }: { title: string; hint?: ReactNode; children: ReactNode; stack?: boolean }) {
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

/** A picture tile with a caption under it; the chosen one gets a ring. */
function Tile({
  on,
  label,
  onClick,
  children,
  className,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      className={`tile${on ? " on" : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
    >
      <span className="tile-art">{children}</span>
      <span className="tile-label">{label}</span>
    </button>
  );
}

/** Miniature app: a top pill, two text lines, a composer. */
function ThemeArt({ kind }: { kind: "light" | "dark" | "system" }) {
  return (
    <span className={`theme-art is-${kind}`} aria-hidden>
      <i className="ta-pill" />
      <i className="ta-line" />
      <i className="ta-line is-short" />
      <i className="ta-composer" />
    </span>
  );
}

function thumbStyle(id: ShaderPreset) {
  const url = presetThumb(id);
  return url ? { backgroundImage: `url("${url}")` } : undefined;
}

function BackgroundSection({
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
  const hint =
    bg.kind === "off"
      ? "Plain canvas. The lightest on the GPU."
      : bg.kind === "shader"
        ? preset?.hint
        : "Your own picture behind the stage, dimmed so text stays legible.";

  return (
    <>
      <Section label="Background" foot={err ? <span className="field-error">{err}</span> : hint}>
        <div
          className={`tiles tiles-5${over ? " is-over" : ""}`}
          role="radiogroup"
          aria-label="Background"
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
          <Tile on={bg.kind === "off"} label="Off" onClick={() => set({ kind: "off" })}>
            <i className="bg-swatch is-off" aria-hidden />
          </Tile>
          {SHADER_PRESETS.map((p) => (
            <Tile
              key={p.id}
              on={bg.kind === "shader" && bg.preset === p.id}
              label={p.label}
              onClick={() => set({ kind: "shader", preset: p.id })}
            >
              <i className="bg-swatch" style={thumbStyle(p.id)} aria-hidden />
            </Tile>
          ))}
          <Tile
            on={bg.kind === "image"}
            label={busy ? "Loading…" : "Photo"}
            onClick={() => (url ? set({ kind: "image" }) : fileRef.current?.click())}
          >
            {url ? (
              <i
                className="bg-swatch"
                style={{ backgroundImage: `url("${url}")`, filter: bg.mono ? "grayscale(1)" : undefined }}
                aria-hidden
              />
            ) : (
              <i className="bg-swatch is-add" aria-hidden>
                <IconPlus />
              </i>
            )}
          </Tile>
        </div>
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
      </Section>

      {bg.kind === "image" && url && (
        <Section label="Photo">
          <Row title="Dim" hint={`${Math.round(bg.dim * 100)}% over the picture`} stack>
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
          <Row title="Monochrome" hint="Strip the color to match the rest of the app.">
            <Switch label="Monochrome" checked={bg.mono} onChange={(v) => set({ mono: v })} />
          </Row>
          <Row title="Picture">
            <div className="row-actions">
              <button
                type="button"
                className="chip"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                Replace
              </button>
              <button type="button" className="chip is-danger" onClick={onRemove}>
                Remove
              </button>
            </div>
          </Row>
        </Section>
      )}
    </>
  );
}

const STREAM_HINT: Record<StreamMode, string> = {
  live: "Words ease in as they arrive. Finished paragraphs render as markdown right away.",
  paragraph: "No token flicker. Each paragraph drops in once it is complete.",
  whole: "Streaming off. The reply lands in one piece when the voice is done.",
};

const FX_HINT: Record<FxLevel, string> = {
  full: "The background drifts constantly at a calm 14fps.",
  balanced: "The background shifts light when the speaker changes, then rests.",
  lite: "Still background, no blur. Pick this if anything stutters.",
};

const CHAT_TEXTS: { id: ChatText; label: string; size: number }[] = [
  { id: "s", label: "Small", size: 15 },
  { id: "m", label: "Default", size: 18 },
  { id: "l", label: "Large", size: 21 },
  { id: "xl", label: "Larger", size: 25 },
];

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
  theme,
  onTheme,
  chatText,
  onChatText,
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
  const current = TABS.find((t) => t.id === tab);

  return (
    <div className={`scrim${open ? "" : " is-leaving"}`} onClick={onClose} role="presentation">
      <div
        ref={cardRef}
        className="sheet prefs glass-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prefs-title"
        onClick={(e) => e.stopPropagation()}
      >
        <nav className="prefs-nav" aria-label="Settings sections">
          <div className="prefs-nav-head">
            <button type="button" className="gbtn" onClick={onClose} aria-label="Close settings">
              <IconBack />
            </button>
            <span className="prefs-title" id="prefs-title">
              Settings
            </span>
          </div>
          <div className="card nav">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`nav-row${tab === t.id ? " on" : ""}`}
                aria-current={tab === t.id ? "page" : undefined}
                onClick={() => onTab(t.id)}
              >
                <span className="nav-icon">{t.icon}</span>
                <span className="nav-name">{t.label}</span>
                <IconChevron />
              </button>
            ))}
          </div>
          <span className="prefs-version">AI ConvoIR 2.0</span>
        </nav>

        <div className="prefs-main">
          <div className="prefs-head">
            <h2>{current?.label}</h2>
            <button type="button" className="pill" onClick={onClose}>
              Done
            </button>
          </div>

          <div className="prefs-body" key={tab}>
            {tab === "conversation" && (
              <>
                <Section label="Replies" foot={STREAM_HINT[streamMode]}>
                  <Row title="Streaming" stack>
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
                  </Row>
                  <Row title="Show thinking" hint="Reasoning folds into a Thoughts row above each reply.">
                    <Switch label="Show thinking" checked={showThoughts} onChange={onShowThoughts} />
                  </Row>
                </Section>

                <Section label="Turns">
                  <Row title="Run mode" hint="Step waits for you; Auto keeps talking until the turn limit.">
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
                  <Row title="Pause between turns" hint={`${(delay / 1000).toFixed(1)}s of silence before the next voice`} stack>
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
                      className="field-input num"
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
                </Section>

                <Section label="Fallback first line" foot="Used only if you begin without typing.">
                  <textarea
                    className="field-input card-field"
                    rows={3}
                    value={seed}
                    disabled={!config}
                    placeholder="Two strangers share a window on a night train…"
                    onChange={(e) => setSeed(e.target.value)}
                    onBlur={() => config && seed !== (config.seed_prompt || "") && patch({ seed_prompt: seed })}
                  />
                </Section>
              </>
            )}

            {tab === "appearance" && (
              <>
                <Section label="Preview">
                  <div className="preview" style={{ ["--chat-scale" as string]: CHAT_TEXTS.find((c) => c.id === chatText)!.size / 18 }}>
                    <span className="preview-bubble">How do clouds stay up?</span>
                    <p>Clouds are tiny droplets, light enough for rising air to hold them aloft.</p>
                  </div>
                </Section>

                <Section label="Theme">
                  <div className="tiles tiles-3" role="radiogroup" aria-label="Theme">
                    {(["system", "light", "dark"] as const).map((t) => (
                      <Tile key={t} on={theme === t} label={t[0].toUpperCase() + t.slice(1)} onClick={() => onTheme(t)}>
                        <ThemeArt kind={t} />
                      </Tile>
                    ))}
                  </div>
                </Section>

                <Section label="Chat text">
                  <div className="tiles tiles-4" role="radiogroup" aria-label="Chat text size">
                    {CHAT_TEXTS.map((c) => (
                      <Tile key={c.id} on={chatText === c.id} label={c.label} onClick={() => onChatText(c.id)} className="tile-short">
                        <span className="aa" style={{ fontSize: c.size }}>
                          Aa
                        </span>
                      </Tile>
                    ))}
                  </div>
                </Section>

                <BackgroundSection
                  bg={bg}
                  onBg={onBg}
                  url={bgUrl}
                  onPick={onPickBgImage}
                  onRemove={onRemoveBgImage}
                />

                <Section
                  label="Effects"
                  foot={
                    bg.kind === "image" && bgUrl
                      ? `${fx === "lite" ? "No blur anywhere." : "Glass blur on panels and sheets."} Your picture is static either way.`
                      : FX_HINT[fx]
                  }
                >
                  <Row title="Motion and glass" stack>
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
                </Section>
              </>
            )}

            {tab === "access" && (
              <>
                <ProviderKeys config={config} />
                {apis.length > 0 && (
                  <Section label="Old saved keys" foot="From an earlier version. They aren’t used; delete them.">
                    {apis.map((a) => (
                      <Row key={a.id} title={a.name}>
                        <button
                          type="button"
                          className="chip is-danger"
                          onClick={() => {
                            deleteApi(a.id);
                            setApis(listApis());
                          }}
                        >
                          Delete
                        </button>
                      </Row>
                    ))}
                  </Section>
                )}
              </>
            )}

            {tab === "shortcuts" && (
              <Section label="Keyboard">
                {SHORTCUTS.map((r) => (
                  <div key={r.keys} className="set-row">
                    <span className="set-row-title">{r.action}</span>
                    <kbd className="kbd">{r.keys}</kbd>
                  </div>
                ))}
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
