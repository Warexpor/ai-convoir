import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { AiConfig, InnerState, ResponseLength } from "../types";
import { SLOT_COLORS, VOICE_PALETTE, agentAccent } from "../types";
import { defaultConfig } from "../lib/config";
import { fetchModels } from "../lib/api";
import {
  EFFORT_LABELS,
  PROVIDERS,
  baseUrlFor,
  effortsFor,
  getProvider,
} from "../lib/providers";
import { getProviderKey, hasProviderKey, onProviderKeysChanged } from "../lib/secrets";
import { IconBack, IconChevron } from "./Marks";
import { useBackClose } from "../hooks/useBackClose";
import VoiceAvatar, { GLYPH_IDS, GLYPHS } from "./VoiceAvatar";
import Seg from "./Seg";
import Dropdown, { type DropOption } from "./Dropdown";
import Collapse from "./Collapse";

interface Props {
  open: boolean;
  config: InnerState | null;
  onSave: (config: InnerState) => void;
  onClose: () => void;
  /** Active cast (group) name; null when the thread has no cast. */
  castName?: string | null;
  onRenameCast?: (name: string) => void;
  /** Voice to expand when the panel opens (e.g. picked from the stage). */
  focusSlot?: string | null;
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

/** Live model ids per provider+base, fetched once per session. */
const modelCache = new Map<string, Promise<string[]>>();

function useProviderModels(provider: string, base: string): {
  models: string[];
  live: boolean;
} {
  const def = getProvider(provider);
  const fallback = def?.models ?? [];
  const [state, setState] = useState<{ key: string; ids: string[] } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => onProviderKeysChanged(() => setTick((n) => n + 1)), []);
  const apiKey = getProviderKey(provider);
  const cacheKey = `${provider}|${base}|${apiKey ? "k" : ""}`;
  useEffect(() => {
    if (!def || !base || (!apiKey && !def.keyOptional)) return;
    let alive = true;
    let p = modelCache.get(cacheKey);
    if (!p) {
      p = fetchModels({ baseUrl: base, apiKey });
      modelCache.set(cacheKey, p);
      p.catch(() => modelCache.delete(cacheKey));
    }
    p.then(
      (ids) => alive && setState({ key: cacheKey, ids }),
      () => {},
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, tick]);
  const ids = state?.key === cacheKey ? state.ids : [];
  return ids.length
    ? { models: ids, live: true }
    : { models: fallback, live: false };
}

/** Provider, model and thinking for one voice. Keys are set once per provider in Settings. */
function ModelPicker({
  slot,
  config,
  onChange,
}: {
  slot: string;
  config: AiConfig;
  onChange: (c: AiConfig) => void;
}) {
  const provider = config.provider || "opencode_go";
  const def = getProvider(provider);
  const base = baseUrlFor(provider, config.api_base_url);
  const { models, live } = useProviderModels(provider, base);
  const needsKey = def && !def.keyOptional && !hasProviderKey(provider);
  const efforts = effortsFor(provider);
  const effort = efforts.includes(config.reasoning_effort)
    ? config.reasoning_effort
    : "none";

  const providerOptions: DropOption<string>[] = PROVIDERS.map((p) => ({
    value: p.id,
    label: p.name,
    text: p.name,
    hint:
      p.keyOptional || hasProviderKey(p.id)
        ? p.keyOptional
          ? "local"
          : "ready"
        : undefined,
  }));
  const modelOptions: DropOption<string>[] = models.map((m) => ({
    value: m,
    label: m,
  }));

  return (
    <>
      <div className="field">
        <label htmlFor={`prov-${slot}`}>Provider</label>
        <Dropdown
          id={`prov-${slot}`}
          label="Provider"
          value={provider}
          options={providerOptions}
          onChange={(id) => {
            const next = getProvider(id);
            if (!next) return;
            const nextEfforts = effortsFor(next.id);
            onChange({
              ...config,
              provider: next.id,
              api_base_url: next.id === "custom" ? config.api_base_url : next.baseUrl,
              model: next.models[0] ?? "",
              reasoning_effort: nextEfforts.includes(config.reasoning_effort)
                ? config.reasoning_effort
                : "none",
            });
          }}
        />
      </div>
      {provider === "custom" && (
        <div className="field">
          <label htmlFor={`base-${slot}`}>Base URL</label>
          <input
            id={`base-${slot}`}
            value={config.api_base_url}
            spellCheck={false}
            placeholder="https://host/v1"
            onChange={(e) => onChange({ ...config, api_base_url: e.target.value })}
          />
        </div>
      )}
      <div className="field">
        <label htmlFor={`model-${slot}`}>Model</label>
        <Dropdown
          id={`model-${slot}`}
          label="Model"
          value={config.model}
          options={modelOptions}
          onChange={(m) => onChange({ ...config, model: m })}
          placeholder={def?.models[0] || "Pick a model"}
          search
          searchPlaceholder="Search or type a model id"
          allowCustom
          emptyText="Type a model id this provider serves"
        />
        {needsKey ? (
          <p className="field-hint">
            {def?.signIn === "tokens"
              ? `Sign in to ${def.name} in Settings → Providers to see its models.`
              : `Add your ${def?.name} key in Settings → Providers to see its models.`}
          </p>
        ) : (
          live && <p className="field-hint">{models.length} models available</p>
        )}
      </div>
      <div className="field">
        <label>Thinking</label>
        <Seg
          label="Thinking effort"
          value={effort}
          onChange={(r) => onChange({ ...config, reasoning_effort: r })}
          options={efforts.map((r) => ({ value: r, label: EFFORT_LABELS[r] }))}
        />
      </div>
    </>
  );
}

const LENGTHS: DropOption<ResponseLength>[] = [
  { value: "brief", label: "Brief", hint: "a line or two" },
  { value: "small", label: "Short", hint: "a paragraph" },
  { value: "normal", label: "Normal" },
  { value: "long", label: "Long", hint: "a few paragraphs" },
  { value: "very_long", label: "Very long" },
];

function CharCard({
  slot,
  accent,
  config,
  onChange,
  open,
  onToggle,
}: {
  slot: string;
  accent: string;
  config: AiConfig;
  onChange: (c: AiConfig) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const [look, setLook] = useState(false);

  return (
    <div
      className={`char-card${open ? " is-open" : ""}`}
      style={{ ["--voice" as string]: accent }}
      data-slot={slot}
    >
      <button
        type="button"
        className="char-head"
        onClick={onToggle}
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
            {config.model || "No model"}
            {config.reasoning_effort && config.reasoning_effort !== "none"
              ? ` · ${EFFORT_LABELS[config.reasoning_effort].toLowerCase()} thinking`
              : ""}
          </span>
        </span>
        <IconChevron />
      </button>
      <Collapse open={open}>
        <div className="char-body">
          <div className="field">
            <label htmlFor={`name-${slot}`}>Name</label>
            <input
              id={`name-${slot}`}
              value={config.name}
              onChange={(e) => onChange({ ...config, name: e.target.value })}
              placeholder="What they’re called"
            />
          </div>
          <div className="field">
            <label htmlFor={`sys-${slot}`}>How they talk</label>
            <textarea
              id={`sys-${slot}`}
              rows={4}
              value={config.system_prompt}
              onChange={(e) =>
                onChange({ ...config, system_prompt: e.target.value })
              }
              placeholder="Voice, mood, what they know…"
            />
          </div>
          <ModelPicker slot={slot} config={config} onChange={onChange} />
          <div className="field">
            <label htmlFor={`len-${slot}`}>Reply length</label>
            <Dropdown
              id={`len-${slot}`}
              label="Reply length"
              value={config.response_length || "normal"}
              options={LENGTHS}
              onChange={(r) => onChange({ ...config, response_length: r })}
            />
          </div>
          <button
            type="button"
            className={`disclose${look ? " is-open" : ""}`}
            onClick={() => setLook((v) => !v)}
            aria-expanded={look}
          >
            <IconChevron />
            Color &amp; avatar
          </button>
          <Collapse open={look}>
            <LookEditor
              slot={slot}
              accent={accent}
              config={config}
              onChange={onChange}
            />
          </Collapse>
        </div>
      </Collapse>
    </div>
  );
}

export default function SettingsSidebar({
  open,
  config,
  onSave,
  onClose,
  castName = null,
  onRenameCast,
  focusSlot = null,
}: Props) {
  const [openSlot, setOpenSlot] = useState<string | null>("ai1");
  useEffect(() => {
    if (open && focusSlot) setOpenSlot(focusSlot);
  }, [open, focusSlot]);
  const toggleSlot = (slot: string) =>
    setOpenSlot((cur) => (cur === slot ? null : slot));
  const [castDraft, setCastDraft] = useState(castName ?? "");
  useEffect(() => setCastDraft(castName ?? ""), [castName]);
  const ready = !!config;
  const [local, setLocal] = useState<InnerState>(() => config ?? defaultConfig());
  const [saved, setSaved] = useState(false);
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
      onSave({ ...cfg, bot_count: n, max_turns: Math.max(1, cfg.max_turns) });
    };
  }, [open, onSave, ready]);

  const botCount = local.bot_count >= 3 ? 3 : 2;
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



  function closeAndSave() {
    if (ready) {
      onSave({
        ...local,
        bot_count: botCount,
        max_turns: Math.max(1, local.max_turns),
      });
    }
    onClose();
  }
  useBackClose(open, closeAndSave);

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
        <button
          type="button"
          className="btn btn-icon btn-bare sheet-back"
          onClick={closeAndSave}
          aria-label="Back"
        >
          <IconBack />
        </button>
        <div className="settings-brand">
          <span className="settings-title" id="settings-title">
            Voices
          </span>
          <span className="settings-sub">Who is on stage, and how they look</span>
        </div>
        <button
          type="button"
          className="btn btn-chrome btn-sm sheet-close"
          onClick={closeAndSave}
        >
          Close
        </button>
      </div>
      <div className="settings-body">
        {!ready && <p className="set-loading">Loading settings…</p>}

        <section className="set-section">
        <h3 className="set-h">
          Cast
          <Seg
            size="sm"
            label="How many voices"
            value={botCount}
            onChange={(n) => setLocal({ ...local, bot_count: n })}
            options={[
              { value: 2, label: "2" },
              { value: 3, label: "3" },
            ]}
          />
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
              New threads in this cast start with these voices.
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
            open={openSlot === "ai1"}
            onToggle={() => toggleSlot("ai1")}
          />
          <CharCard
            slot="ai2"
            accent={agentAccent("ai2", local)}
            config={local.ai2_config}
            onChange={(c) => setLocal({ ...local, ai2_config: c })}
            open={openSlot === "ai2"}
            onToggle={() => toggleSlot("ai2")}
          />
          {botCount === 3 && (
            <CharCard
              slot="ai3"
              accent={agentAccent("ai3", local)}
              config={local.ai3_config}
              onChange={(c) => setLocal({ ...local, ai3_config: c })}
              open={openSlot === "ai3"}
              onToggle={() => toggleSlot("ai3")}
            />
          )}
        </div>

        </section>

      </div>
      <div className="settings-foot">
        <button
          type="button"
          className="btn btn-go btn-block"
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
          {saved ? "Saved" : dirty ? "Save changes" : "All saved"}
        </button>
        <p className="about-line">
          <kbd>S</kbd> toggles this panel · <kbd>,</kbd> opens settings
        </p>
      </div>
      </div>
    </aside>
  );
}
