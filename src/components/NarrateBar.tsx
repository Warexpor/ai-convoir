import { agentLabel, nextAgentId, type InnerState } from "../types";

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
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit(value);
            }
          }}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={disabled || !value.trim()}
          onClick={() => onCommit(value)}
        >
          Send
        </button>
      </div>
      {value.trim() ? (
        <p className="composer-hint">
          {nextName} will use this once, then it clears.
        </p>
      ) : (
        <p className="composer-hint">Optional. They won’t mention you said it.</p>
      )}
    </div>
  );
}
