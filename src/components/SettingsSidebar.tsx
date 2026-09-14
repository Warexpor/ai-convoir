import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type {
  AiConfig,
  InnerState,
  ReasoningEffort,
  ResponseLength,
} from "../types";
import { OPENCODE_GO_BASE, OPENCODE_ZEN_BASE } from "../types";
import { fetchModels } from "../lib/api";
import {
  deleteApi,
  listApis,
  saveApi,
  type SavedApi,
} from "../lib/storage";
import { agentAccent } from "../types";

interface Props {
  open: boolean;
  config: InnerState;
  onSave: (config: InnerState) => void;
  onClose: () => void;
  showThoughtsUi: boolean;
  onShowThoughtsUiChange: (v: boolean) => void;
}

const PRESETS = [
  { name: "OpenCode Zen", base_url: OPENCODE_ZEN_BASE },
  { name: "OpenCode Go", base_url: OPENCODE_GO_BASE },
  { name: "OpenAI", base_url: "https://api.openai.com/v1" },
] as const;

function CharCard({
  accent,
  config,
  apis,
  onChange,
  defaultOpen,
}: {
  accent: string;
  config: AiConfig;
  apis: SavedApi[];
  onChange: (c: AiConfig) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("My endpoint");
  const [savingProfile, setSavingProfile] = useState(false);

  const loadModels = async () => {
    setLoading(true);
    setErr(null);
    try {
      const ids = await fetchModels({
        baseUrl: config.api_base_url,
        apiKey: config.api_key,
      });
      setModels(ids);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const applyApi = (api: SavedApi) => {
    onChange({
      ...config,
      api_base_url: api.base_url,
      api_key: api.api_key,
      model: api.model || config.model,
    });
  };

  const saveProfile = () => {
    saveApi({
      name: profileName.trim() || config.name || "API",
      base_url: config.api_base_url,
      api_key: config.api_key,
      model: config.model,
    });
    setSavingProfile(false);
    window.dispatchEvent(new Event("apis-changed"));
  };

  return (
    <div className="char-card">
      <button type="button" className="char-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span
          className="char-avatar"
          style={{ color: accent, borderColor: accent }}
        >
          {(config.name || "?").slice(0, 2).toUpperCase()}
        </span>
        <span className="char-name">{config.name}</span>
        <span className="mono-cap">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="char-body">
          <div className="field">
            <label>Name</label>
            <input
              value={config.name}
              onChange={(e) => onChange({ ...config, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>System prompt</label>
            <textarea
              rows={4}
              value={config.system_prompt}
              onChange={(e) =>
                onChange({ ...config, system_prompt: e.target.value })
              }
              placeholder="Voice, constraints, what they know…"
            />
          </div>
          {apis.length > 0 && (
            <div className="field">
              <label>Saved APIs</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {apis.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="chip"
                    onClick={() => applyApi(a)}
                    title={a.base_url}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="field">
            <label>Provider</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className={`chip ${
                    config.api_base_url.replace(/\/$/, "") === p.base_url
                      ? "on"
                      : ""
                  }`}
                  onClick={() =>
                    onChange({ ...config, api_base_url: p.base_url })
                  }
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Base URL</label>
            <input
              value={config.api_base_url}
              onChange={(e) =>
                onChange({ ...config, api_base_url: e.target.value })
              }
            />
          </div>
          <div className="field">
            <label>API key</label>
            <input
              type="password"
              value={config.api_key}
              onChange={(e) => onChange({ ...config, api_key: e.target.value })}
              placeholder="sk-…"
            />
          </div>
          <div className="field">
            <label>Model</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={{ flex: 1 }}
                value={config.model}
                onChange={(e) => onChange({ ...config, model: e.target.value })}
                list={`m-${config.name}`}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={loadModels}
                disabled={loading}
              >
                {loading ? "…" : "Fetch"}
              </button>
            </div>
            {models.length > 0 && (
              <datalist id={`m-${config.name}`}>
                {models.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            )}
            {err && (
              <p style={{ fontSize: 11, color: "var(--danger)", marginTop: 6 }}>
                {err}
              </p>
            )}
          </div>
          <div className="field">
            <label>Reasoning</label>
            <div className="seg" role="group" aria-label="Reasoning effort">
              {(["none", "low", "medium", "high"] as ReasoningEffort[]).map(
                (r) => (
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
                ),
              )}
            </div>
          </div>
          <div className="field">
            <label>Response length</label>
            <div className="seg" role="group" aria-label="Response length">
              {(["brief", "small", "normal", "long", "very_long"] as ResponseLength[]).map(
                (r) => (
                  <button
                    key={r}
                    type="button"
                    className={
                      (config.response_length || "normal") === r ? "on" : ""
                    }
                    aria-pressed={(config.response_length || "normal") === r}
                    onClick={() =>
                      onChange({ ...config, response_length: r })
                    }
                  >
                    {r === "very_long" ? "very long" : r}
                  </button>
                ),
              )}
            </div>
          </div>
          <div className="field">
            {!savingProfile ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSavingProfile(true)}
              >
                Save API profile
              </button>
            ) : (
              <div className="profile-save-row">
                <input
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Profile name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveProfile();
                    if (e.key === "Escape") setSavingProfile(false);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={saveProfile}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSavingProfile(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
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
  const panelRef = useRef<HTMLElement>(null);
  useFocusTrap(open, panelRef);

  useEffect(() => setLocal(config), [config]);
  useEffect(() => {
    const r = () => setApis(listApis());
    window.addEventListener("apis-changed", r);
    return () => window.removeEventListener("apis-changed", r);
  }, []);

  if (!open) return null;
  const botCount = local.bot_count >= 3 ? 3 : 2;
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
          <span className="settings-sub">Agents, endpoints, pace</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="settings-body">
        <p className="mono-cap settings-kicker">Session</p>
        <div className="field">
          <label>Agents</label>
          <div className="seg" role="group" aria-label="Agent count">
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
        <div className="field">
          <label>Opening</label>
          <textarea
            value={local.seed_prompt || ""}
            onChange={(e) =>
              setLocal({ ...local, seed_prompt: e.target.value })
            }
            placeholder="Default first line for a new thread"
          />
          <p className="field-hint">
            Used when you begin a thread without typing one. New leaves the
            composer empty until you write.
          </p>
        </div>
        <div className="field">
          <label>Thoughts</label>
          <div className="seg" role="group" aria-label="Show model thoughts">
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
          <p className="field-hint">
            Reasoning models can expand a Thoughts block. Hide removes the
            control from the transcript.
          </p>
        </div>
        <div className="field">
          <label>Delay · {local.delay_ms}ms</label>
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
              setLocal({ ...local, delay_ms: parseInt(e.target.value) || 0 })
            }
          />
        </div>
        {local.mode !== "step" && (
          <div className="field">
            <label>Max turns</label>
            <input
              type="number"
              min={1}
              max={999}
              value={local.max_turns}
              onChange={(e) =>
                setLocal({
                  ...local,
                  max_turns: parseInt(e.target.value) || 40,
                })
              }
            />
          </div>
        )}

        <p className="mono-cap settings-kicker">Roster</p>
        <div className="field">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <CharCard
              accent={agentAccent("ai1")}
              config={local.ai1_config}
              apis={apis}
              onChange={(c) => setLocal({ ...local, ai1_config: c })}
              defaultOpen
            />
            <CharCard
              accent={agentAccent("ai2")}
              config={local.ai2_config}
              apis={apis}
              onChange={(c) => setLocal({ ...local, ai2_config: c })}
            />
            {botCount === 3 && (
              <CharCard
                accent={agentAccent("ai3")}
                config={local.ai3_config}
                apis={apis}
                onChange={(c) => setLocal({ ...local, ai3_config: c })}
              />
            )}
          </div>
        </div>

        {apis.length > 0 && (
          <div className="field">
            <p className="mono-cap settings-kicker" style={{ marginBottom: 8 }}>
              Profiles
            </p>
            {apis.map((a) => (
              <div key={a.id} className="api-row">
                <span>
                  {a.name}
                  <span style={{ color: "var(--faint)", marginLeft: 6 }}>
                    {a.base_url.replace(/^https?:\/\//, "").slice(0, 28)}
                  </span>
                </span>
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
            onSave({
              ...local,
              bot_count: botCount,
              max_turns: Math.max(1, local.max_turns),
            });
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
