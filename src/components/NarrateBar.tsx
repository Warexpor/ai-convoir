import { useEffect, useState } from "react";
import { agentLabel, nextAgentId, type InnerState } from "../types";
import { IconHint, IconReturn } from "./Marks";

interface Props {
  config: InnerState | null;
  turnCount: number;
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  disabled?: boolean;
}

export default function NarrateBar({
  config,
  turnCount,
  value,
  onChange,
  onCommit,
  disabled,
}: Props) {
  const next = nextAgentId(config, turnCount);
  const nextName = agentLabel(next, config);
  const [open, setOpen] = useState(() => !!value.trim());

  useEffect(() => {
    if (value.trim()) setOpen(true);
  }, [value]);

  if (!open) {
    return (
      <div className="composer composer-collapsed">
        <button
          type="button"
          className="hint-toggle"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <IconHint />
          Hint for {nextName}
        </button>
      </div>
    );
  }

  return (
    <div className="composer">
      <div className="composer-row">
        <span className="mono-cap" style={{ flexShrink: 0 }}>
          Hint · {nextName}
        </span>
        <input
          value={value}
          disabled={disabled}
          placeholder={`A quiet note for ${nextName}`}
          aria-label={`Hint for ${nextName}`}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit(value);
            }
            if (e.key === "Escape" && !value.trim()) {
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={disabled}
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
        >
          Hide
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={disabled || !value.trim()}
          onClick={() => onCommit(value)}
        >
          Send
          <IconReturn />
        </button>
      </div>
    </div>
  );
}
