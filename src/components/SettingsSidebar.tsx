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
  agentAccent,
} from "../types";
import { fetchModels } from "../lib/api";
import { deleteApi, listApis, type SavedApi } from "../lib/storage";

interface Props {
  open: boolean;
  config: InnerState;
  onSave: (config: InnerState) => void;
  onClose: () => void;
  showThoughtsUi: boolean;
  onShowThoughtsUiChange: (v: boolean) => void;
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
  accent,
  config,
  onChange,
  defaultOpen,
}: {
  accent: string;
  config: AiConfig;
  onChange: (c: AiConfig) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [more, setMore] = useState(false);

  return (
    <div className="char-card glass-card">
      <button
        type="button"
        className="char-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span
          className="char-avatar"
          style={{ color: accent, borderColor: accent }}
        >
          {(config.name || "?").slice(0, 2).toUpperCase()}
        </span>
        <span className="char-name">{config.name || "Voice"}</span>
        <span className="mono-cap">{open ? "Hide" : "Edit"}</span>
      </button>
      {open && (
        <div className="char-body">
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
            className="btn btn-ghost btn-sm"
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
          >
            {more ? "Fewer options" : "Length & thinking"}
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
}: Props) {
  const [local, setLocal] = useState(config);
  const [apis, setApis] = useState<SavedApi[]>(() => listApis());
  const [saved, setSaved] = useState(false);
  const [sessionMore, setSessionMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const localRef = useRef(local);
  localRef.current = local;
  useFocusTrap(open, panelRef);

  useEffect(() => setLocal(config), [config]);
  useEffect(() => {
    if (!open) return undefined;
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
  }, [open, onSave]);
  useEffect(() => {
    const r = () => setApis(listApis());
    window.addEventListener("apis-changed", r);
    return () => window.removeEventListener("apis-changed", r);
  }, []);

  if (!open) return null;
  const botCount = local.bot_count >= 3 ? 3 : 2;
  const sharedKey =
    local.ai1_config.api_key ||
    local.ai2_config.api_key ||
    local.ai3_config.api_key ||
    "";
  const dirty =
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
      className="settings"
      ref={panelRef}
      aria-label="Settings"
      aria-labelledby="settings-title"
      aria-modal="true"
      role="dialog"
    >
      <div className="settings-head">
        <div className="settings-brand">
          <span className="settings-title" id="settings-title">
            Settings
          </span>
          <span className="settings-sub">One key · two or three voices</span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
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
        <div className="key-card glass-card">
          <p className="mono-cap settings-kicker">OpenCode Go</p>
          <p className="key-card-lead">
            Paste your API key once. Every voice uses it. The model is Muse
            Spark 1.3 contributor.
          </p>
          <div className="field">
            <label htmlFor="go-api-key">API key</label>
            <input
              id="go-api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={sharedKey}
              onChange={(e) => setLocal(withSharedKey(local, e.target.value))}
              placeholder="sk-…"
            />
          </div>
          <div className="key-card-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={verifyKey}
              disabled={loading || !sharedKey.trim()}
            >
              {loading ? "Checking…" : "Check key"}
            </button>
            {okMsg && (
              <span className="mono-cap" style={{ color: "var(--ok)" }}>
                {okMsg}
              </span>
            )}
          </div>
          {err && <p className="field-error">{err}</p>}
        </div>

        <p className="mono-cap settings-kicker">Voices</p>
        <div className="field">
          <label>How many</label>
          <div className="seg" role="group" aria-label="How many voices">
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
        </div>
        <div className="voice-stack">
          <CharCard
            accent={agentAccent("ai1")}
            config={local.ai1_config}
            onChange={(c) => setLocal({ ...local, ai1_config: c })}
            defaultOpen
          />
          <CharCard
            accent={agentAccent("ai2")}
            config={local.ai2_config}
            onChange={(c) => setLocal({ ...local, ai2_config: c })}
          />
          {botCount === 3 && (
            <CharCard
              accent={agentAccent("ai3")}
              config={local.ai3_config}
              onChange={(c) => setLocal({ ...local, ai3_config: c })}
            />
          )}
        </div>

        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setSessionMore((v) => !v)}
          aria-expanded={sessionMore}
        >
          {sessionMore ? "Hide extras" : "Extras"}
        </button>
        {sessionMore && (
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
        )}

        {apis.length > 0 && (
          <div className="field">
            <p className="mono-cap settings-kicker" style={{ marginBottom: 8 }}>
              Saved keys
            </p>
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
      </div>
      <div className="settings-foot">
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: "100%" }}
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
          {saved ? "Saved" : "Save"}
        </button>
        <p className="about-line">
          AI Conversation <span>v2.0</span>
        </p>
      </div>
    </aside>
  );
}
