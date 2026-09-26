import { useEffect, useState } from "react";
import type { InnerState } from "../types";
import { fetchModels, isTauri } from "../lib/api";
import { PROVIDERS, type ProviderDef } from "../lib/providers";
import {
  getProviderKey,
  keyStorageLabel,
  onProviderKeysChanged,
  setProviderKey,
} from "../lib/secrets";

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok"; count: number }
  | { kind: "err"; msg: string };

export async function openExternal(url: string) {
  if (isTauri()) {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(url, "_blank", "noopener");
}

function ProviderRow({
  p,
  inUse,
  open,
  onToggle,
  customBase,
}: {
  p: ProviderDef;
  inUse: boolean;
  open: boolean;
  onToggle: () => void;
  customBase: string;
}) {
  const saved = getProviderKey(p.id);
  const [draft, setDraft] = useState(saved);
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setDraft(getProviderKey(p.id));
      setCheck({ kind: "idle" });
    }
  }, [open, p.id]);

  const dirty = draft.trim() !== saved;
  const base = p.id === "custom" ? customBase : p.baseUrl;
  const status = saved
    ? "Key saved"
    : p.keyOptional
      ? "No key needed"
      : "No key";

  const save = async () => {
    setBusy(true);
    try {
      await setProviderKey(p.id, draft);
    } finally {
      setBusy(false);
    }
  };

  const runCheck = async () => {
    if (!base) {
      setCheck({ kind: "err", msg: "Set a base URL on a voice first." });
      return;
    }
    setCheck({ kind: "checking" });
    try {
      const ids = await fetchModels({ baseUrl: base, apiKey: draft.trim() });
      setCheck({ kind: "ok", count: ids.length });
    } catch (e) {
      setCheck({ kind: "err", msg: String(e) });
    }
  };

  return (
    <div className={`prov-row${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="prov-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="prov-name">{p.name}</span>
        {inUse && <span className="prov-tag">in use</span>}
        <span className={`prov-state${saved ? " is-set" : ""}`}>{status}</span>
      </button>
      {open && (
        <div className="prov-body">
          <div className="key-line">
            <input
              className="text-input"
              type="password"
              autoComplete="new-password"
              data-1p-ignore="true"
              data-lpignore="true"
              spellCheck={false}
              aria-label={`${p.name} API key`}
              placeholder={p.keyOptional ? "Optional" : p.keyHint || "API key"}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setCheck({ kind: "idle" });
              }}
              onKeyDown={(e) => e.key === "Enter" && dirty && void save()}
            />
            <button
              type="button"
              className="btn btn-go btn-sm"
              disabled={!dirty || busy}
              onClick={() => void save()}
            >
              {dirty ? (draft.trim() ? "Save" : "Remove") : "Saved"}
            </button>
          </div>
          <div className="key-status">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={(!draft.trim() && !p.keyOptional) || check.kind === "checking"}
              onClick={() => void runCheck()}
            >
              {check.kind === "checking" ? "Checking…" : "Check"}
            </button>
            {p.keyUrl && (
              <button
                type="button"
                className="link-btn"
                onClick={() => void openExternal(p.keyUrl!)}
              >
                Get a key
              </button>
            )}
            {check.kind === "ok" && (
              <span className="key-ok">
                Works · {check.count} model{check.count === 1 ? "" : "s"}
              </span>
            )}
            {check.kind === "err" && <span className="field-error">{check.msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Settings → Providers: one key per provider, shared by every voice using it. */
export default function ProviderKeys({ config }: { config: InnerState | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => onProviderKeysChanged(() => setTick((n) => n + 1)), []);

  const voices = config
    ? [config.ai1_config, config.ai2_config, ...(config.bot_count >= 3 ? [config.ai3_config] : [])]
    : [];
  const used = new Set(voices.map((v) => v.provider));
  const customBase = voices.find((v) => v.provider === "custom")?.api_base_url || "";
  // Providers the cast uses float to the top.
  const list = [...PROVIDERS].sort(
    (a, b) => Number(used.has(b.id)) - Number(used.has(a.id)),
  );

  return (
    <div className="prov-list">
      <p className="set-row-hint prov-note">
        Keys are stored in {keyStorageLabel()} and shared by every voice on that
        provider. Pick each voice&rsquo;s provider and model in Voices.
      </p>
      {list.map((p) => (
        <ProviderRow
          key={p.id}
          p={p}
          inUse={used.has(p.id)}
          open={openId === p.id}
          onToggle={() => setOpenId(openId === p.id ? null : p.id)}
          customBase={customBase}
        />
      ))}
    </div>
  );
}
