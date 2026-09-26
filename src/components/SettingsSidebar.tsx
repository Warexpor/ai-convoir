import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type {
  AiConfig,
  InnerState,
  ReasoningEffort,
  ResponseLength,
} from "../types";
import {
  MUSE_SPARK_13_CONTRIBUTOR,
  OPENCODE_GO_BASE,
  SLOT_COLORS,
  VOICE_PALETTE,
  agentAccent,
} from "../types";
import { fetchModels } from "../lib/api";
import { defaultConfig } from "../lib/config";
import { deleteApi, listApis, type SavedApi } from "../lib/storage";
import { IconChevron } from "./Marks";
import VoiceAvatar, { GLYPH_IDS, GLYPHS } from "./VoiceAvatar";

interface Props {
  open: boolean;
  config: InnerState | null;
  onSave: (config: InnerState) => void;
  onClose: () => void;
  showThoughtsUi: boolean;
  onShowThoughtsUiChange: (v: boolean) => void;
  /** Active cast (group) name; null when the thread has no cast. */
  castName?: string | null;
  onRenameCast?: (name: string) => void;
}

/** Color + avatar picker for one voice. */
function LookEditor({
  slot,
  accent,
  config,
  onChange,
}: {
  slot: string;
  accent: string;
  config: AiConfig;
  onChange: (c: AiConfig) => void;
}) {
  const icon = config.icon || "";
  const isText = !!icon && !icon.startsWith("g:");
  const [text, setText] = useState(isText ? icon : "");
  const current = accent.toLowerCase();
  const customColor = !VOICE_PALETTE.includes(current);

  return (
    <div className="look">
      <div className="field">
        <label>Color</label>
        <div className="swatches" role="radiogroup" aria-label="Voice color">
          {VOICE_PALETTE.map((hex) => (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={current === hex}
              aria-label={hex}
              className={`swatch${current === hex ? " on" : ""}${
                SLOT_COLORS[slot] === hex ? " is-default" : ""
              }`}
              style={{ ["--sw" as string]: hex }}
              title={SLOT_COLORS[slot] === hex ? `${hex} (default)` : hex}
              onClick={() => onChange({ ...config, color: hex })}
            />
          ))}
          <label
            className={`swatch swatch-custom${customColor ? " on" : ""}`}
            style={customColor ? { ["--sw" as string]: accent } : undefined}
            title="Custom color"
          >
            <input
              type="color"
              value={accent}
              aria-label="Custom color"
              onChange={(e) => onChange({ ...config, color: e.target.value })}
            />
          </label>
        </div>
      </div>
      <div className="field">
        <label>Avatar</label>
        <div className="glyphs" role="radiogroup" aria-label="Voice avatar">
          <button
            type="button"
            role="radio"
            aria-checked={!icon}
            className={`glyph-opt${!icon ? " on" : ""}`}
            title="Initials"
            onClick={() => {
              setText("");
              onChange({ ...config, icon: "" });
            }}
          >
            Aa
          </button>
          {GLYPH_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={icon === `g:${id}`}
              aria-label={id}
              title={id}
              className={`glyph-opt${icon === `g:${id}` ? " on" : ""}`}
              onClick={() => {
                setText("");
                onChange({ ...config, icon: `g:${id}` });
              }}
            >
              <svg viewBox="0 0 16 16" fill="currentColor">
                {GLYPHS[id]}
              </svg>
            </button>
          ))}
          <input
            className={`glyph-text${isText ? " on" : ""}`}
            value={text}
            placeholder="✎"
            maxLength={4}
            aria-label="Custom avatar characters"
            title="Type 1–2 characters or an emoji"
            onChange={(e) => {
              const v = [...e.target.value].slice(0, 2).join("");
              setText(v);
              onChange({ ...config, icon: v.trim() });
            }}
          />
        </div>
      </div>
    </div>
  );
}

function withSharedKey(cfg: InnerState, key: string): InnerState {
  const apply = (c: AiConfig): AiConfig => ({
    ...c,
    api_key: key,
    api_base_url: OPENCODE_GO_BASE,
    model: MUSE_SPARK_13_CONTRIBUTOR,
  });
  return {
    ...cfg,
    ai1_config: apply(cfg.ai1_config),
    ai2_config: apply(cfg.ai2_config),
    ai3_config: apply(cfg.ai3_config),
  };
}

function CharCard({
  slot,
  accent,
  config,
  onChange,
  defaultOpen,
}: {
  slot: string;
  accent: string;
  config: AiConfig;
  onChange: (c: AiConfig) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [more, setMore] = useState(false);

  return (
    <div
      className={`char-card${open ? " is-open" : ""}`}
      style={{ ["--voice" as string]: accent }}
    >
      <button
        type="button"
        className="char-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <VoiceAvatar
          className="char-avatar"
          name={config.name || "?"}
          icon={config.icon}
          color={accent}
        />
        <span className="char-id">
          <span className="char-name">{config.name || "Voice"}</span>
          <span className="char-bio">
            {config.system_prompt || "No direction yet"}
          </span>
        </span>
        <IconChevron />
      </button>
      {open && (
        <div className="char-body">
          <LookEditor
            slot={slot}
            accent={accent}
            config={config}
            onChange={onChange}
          />
          <div className="field">
            <label>Name</label>
            <input
              value={config.name}
              onChange={(e) => onChange({ ...config, name: e.target.value })}
              placeholder="What they’re called"
            />
          </div>
          <div className="field">
            <label>How they talk</label>
            <textarea
              rows={4}
              value={config.system_prompt}
              onChange={(e) =>
                onChange({ ...config, system_prompt: e.target.value })
              }
              placeholder="Voice, mood, what they know…"
            />
          </div>
          <button
            type="button"
            className="link-btn"
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
          >
            {more ? "Fewer options" : "Reply length & thinking →"}
          </button>
          {more && (
            <>
              <div className="field">
                <label>Thinking</label>
                <div className="seg" role="group" aria-label="Thinking effort">
                  {(
                    ["none", "low", "medium", "high"] as ReasoningEffort[]
                  ).map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={
                        (config.reasoning_effort || "none") === r ? "on" : ""
                      }
                      aria-pressed={(config.reasoning_effort || "none") === r}
                      onClick={() =>
                        onChange({ ...config, reasoning_effort: r })
                      }
                    >
                      {r === "none" ? "off" : r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Reply length</label>
                <div className="seg" role="group" aria-label="Reply length">
                  {(
                    [
                      "brief",
                      "small",
                      "normal",
                      "long",
                      "very_long",
                    ] as ResponseLength[]
                  ).map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={
                        (config.response_length || "normal") === r ? "on" : ""
                      }
                      aria-pressed={
                        (config.response_length || "normal") === r
                      }
                      onClick={() =>
                        onChange({ ...config, response_length: r })
                      }
                    >
                      {r === "very_long" ? "very long" : r}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function SettingsSidebar({
  open,
  config,
  onSave,
  onClose,
  showThoughtsUi,
  onShowThoughtsUiChange,
  castName = null,
  onRenameCast,
}: Props) {
  const [castDraft, setCastDraft] = useState(castName ?? "");
  useEffect(() => setCastDraft(castName ?? ""), [castName]);
  const ready = !!config;
  const [local, setLocal] = useState<InnerState>(() => config ?? defaultConfig());
  const [apis, setApis] = useState<SavedApi[]>(() => listApis());
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const localRef = useRef(local);
  localRef.current = local;
  useFocusTrap(open, panelRef);

  useEffect(() => {
    if (config) setLocal(config);
  }, [config]);
  useEffect(() => {
    if (!open || !ready) return undefined;
    return () => {
      const cfg = localRef.current;
      const n = cfg.bot_count >= 3 ? 3 : 2;
      const key =
        cfg.ai1_config.api_key ||
        cfg.ai2_config.api_key ||
        cfg.ai3_config.api_key ||
        "";
      onSave(
        withSharedKey(
          { ...cfg, bot_count: n, max_turns: Math.max(1, cfg.max_turns) },
          key,
        ),
      );
    };
  }, [open, onSave, ready]);
  useEffect(() => {
    const r = () => setApis(listApis());
    window.addEventListener("apis-changed", r);
    return () => window.removeEventListener("apis-changed", r);
  }, []);

  const botCount = local.bot_count >= 3 ? 3 : 2;
  const sharedKey =
    local.ai1_config.api_key ||
    local.ai2_config.api_key ||
    local.ai3_config.api_key ||
    "";
  const dirty =
    !!config &&
    JSON.stringify({
      n: botCount,
      d: local.delay_ms,
      t: local.max_turns,
      s: local.seed_prompt,
      m: local.mode,
      a1: local.ai1_config,
      a2: local.ai2_config,
      a3: botCount === 3 ? local.ai3_config : null,
    }) !==
      JSON.stringify({
        n: config.bot_count >= 3 ? 3 : 2,
        d: config.delay_ms,
        t: config.max_turns,
        s: config.seed_prompt,
        m: config.mode,
        a1: config.ai1_config,
        a2: config.ai2_config,
        a3: config.bot_count >= 3 ? config.ai3_config : null,
      });

  const verifyKey = async () => {
    setLoading(true);
    setErr(null);
    setOkMsg(null);
    try {
      await fetchModels({
        baseUrl: OPENCODE_GO_BASE,
        apiKey: sharedKey,
      });
      setOkMsg("Key works");
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside
      className={`settings ${open ? "is-open" : ""}`}
      ref={panelRef}
      aria-label="Settings"
      aria-labelledby="settings-title"
      aria-modal={open ? true : undefined}
      aria-hidden={!open}
      inert={!open}
      role={open ? "dialog" : undefined}
    >
      <div className="settings-inner">
      <div className="settings-head">
        <div className="settings-brand">
          <span className="settings-title" id="settings-title">
            Voices &amp; settings
          </span>
          <span className="settings-sub">Changes apply when you close</span>
        </div>
        <button
          type="button"
          className="btn btn-chrome btn-sm"
          onClick={() => {
            if (!ready) {
              onClose();
              return;
            }
            const n = botCount;
            onSave(
              withSharedKey(
                {
                  ...local,
                  bot_count: n,
                  max_turns: Math.max(1, local.max_turns),
                },
                sharedKey,
              ),
            );
            onClose();
          }}
        >
          Close
        </button>
      </div>
      <div className="settings-body">
        {!ready && <p className="set-loading">Loading settings…</p>}
        <section className="set-section">
        <h3 className="set-h">
          <span>01</span>Access
        </h3>
        <div
          className={`key-card${sharedKey.trim() ? "" : " is-missing"}`}
          aria-disabled={!ready}
        >
          <p className="key-card-lead">
            One OpenCode Go key powers every voice. Model is locked to{" "}
            <code>muse-spark-1.3-contributor</code>.
          </p>
          <div className="field">
            <label htmlFor="go-api-key">API key</label>
            <input
              id="go-api-key"
              type="password"
              name="opencode-go-key"
              autoComplete="new-password"
              data-1p-ignore="true"
              data-lpignore="true"
              data-form-type="other"
              spellCheck={false}
              value={sharedKey}
              disabled={!ready}
              onChange={(e) => setLocal(withSharedKey(local, e.target.value))}
              placeholder="sk-…"
            />
          </div>
          <div className="key-card-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={verifyKey}
              disabled={!ready || loading || !sharedKey.trim()}
            >
              {loading ? "Checking…" : "Check key"}
            </button>
            {okMsg && (
              <span className="ok-tag">{okMsg}</span>
            )}
          </div>
          {err && <p className="field-error">{err}</p>}
        </div>
        </section>

        <section className="set-section">
        <h3 className="set-h">
          <span>02</span>Cast
          <div className="seg seg-sm" role="group" aria-label="How many voices">
            <button
              type="button"
              className={botCount === 2 ? "on" : ""}
              aria-pressed={botCount === 2}
              onClick={() => setLocal({ ...local, bot_count: 2 })}
            >
              2
            </button>
            <button
              type="button"
              className={botCount === 3 ? "on" : ""}
              aria-pressed={botCount === 3}
              onClick={() => setLocal({ ...local, bot_count: 3 })}
            >
              3
            </button>
          </div>
        </h3>
        {castName !== null ? (
          <div className="field cast-name-field">
            <label htmlFor="cast-name">Cast name</label>
            <input
              id="cast-name"
              value={castDraft}
              onChange={(e) => setCastDraft(e.target.value)}
              onBlur={() => castDraft.trim() && onRenameCast?.(castDraft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <p className="field-hint">
              Edits here become the cast&rsquo;s look. New threads in this cast
              inherit them; older threads keep theirs.
            </p>
          </div>
        ) : (
          <p className="field-hint cast-name-field">
            This thread isn&rsquo;t in a cast, so edits only affect it.
          </p>
        )}
        <div className="voice-stack">
          <CharCard
            slot="ai1"
            accent={agentAccent("ai1", local)}
            config={local.ai1_config}
            onChange={(c) => setLocal({ ...local, ai1_config: c })}
            defaultOpen
          />
          <CharCard
            slot="ai2"
            accent={agentAccent("ai2", local)}
            config={local.ai2_config}
            onChange={(c) => setLocal({ ...local, ai2_config: c })}
          />
          {botCount === 3 && (
            <CharCard
              slot="ai3"
              accent={agentAccent("ai3", local)}
              config={local.ai3_config}
              onChange={(c) => setLocal({ ...local, ai3_config: c })}
            />
          )}
        </div>

        </section>

        <section className="set-section">
        <h3 className="set-h">
          <span>03</span>Pacing &amp; display
        </h3>
          <div className="session-more">
            <div className="field">
              <label>Default first line</label>
              <textarea
                value={local.seed_prompt || ""}
                onChange={(e) =>
                  setLocal({ ...local, seed_prompt: e.target.value })
                }
                placeholder="Used only if you begin without typing"
              />
              <p className="field-hint">
                New still starts blank. This is a fallback opening, not a
                required prompt.
              </p>
            </div>
            <div className="field">
              <label>Show thinking</label>
              <div className="seg" role="group" aria-label="Show thinking">
                <button
                  type="button"
                  className={showThoughtsUi ? "on" : ""}
                  aria-pressed={showThoughtsUi}
                  onClick={() => onShowThoughtsUiChange(true)}
                >
                  Show
                </button>
                <button
                  type="button"
                  className={!showThoughtsUi ? "on" : ""}
                  aria-pressed={!showThoughtsUi}
                  onClick={() => onShowThoughtsUiChange(false)}
                >
                  Hide
                </button>
              </div>
            </div>
            <div className="field">
              <label>Pause between turns · {local.delay_ms}ms</label>
              <input
                type="range"
                min={0}
                max={4000}
                step={100}
                value={local.delay_ms}
                aria-valuemin={0}
                aria-valuemax={4000}
                aria-valuenow={local.delay_ms}
                style={{
                  ["--range" as string]: `${(local.delay_ms / 4000) * 100}%`,
                }}
                onChange={(e) =>
                  setLocal({
                    ...local,
                    delay_ms: parseInt(e.target.value, 10) || 0,
                  })
                }
              />
            </div>
            {local.mode !== "step" && (
              <div className="field">
                <label>Stop after this many turns</label>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={local.max_turns}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      max_turns: parseInt(e.target.value, 10) || 40,
                    })
                  }
                />
              </div>
            )}
          </div>

        {apis.length > 0 && (
          <div className="field">
            <label>Saved keys</label>
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
        )}
        </section>
      </div>
      <div className="settings-foot">
        <button
          type="button"
          className="btn btn-go btn-block"
          disabled={!dirty && !saved}
          onClick={() => {
            onSave(
              withSharedKey(
                {
                  ...local,
                  bot_count: botCount,
                  max_turns: Math.max(1, local.max_turns),
                },
                sharedKey,
              ),
            );
            setSaved(true);
            window.setTimeout(() => setSaved(false), 1400);
          }}
        >
          {saved ? "Saved" : dirty ? "Save changes" : "All saved"}
        </button>
        <p className="about-line">
          AI Conversation <span>v2.0</span> · <kbd>S</kbd> toggles this panel
        </p>
      </div>
      </div>
    </aside>
  );
}
