import { memo } from "react";
import type { AppStatus, InnerState } from "../types";
import { activeAgentIds, agentAccent, agentConfig, agentLabel } from "../types";
import VoiceAvatar from "./VoiceAvatar";

interface Props {
  config: InnerState | null;
  status: AppStatus;
  /** Agent id whose turn is next (or in flight while running). */
  upNext: string | null;
  hasMessages: boolean;
}

/** The cast, on stage: who is in the room and whose line is next. */
function CastStrip({ config, status, upNext, hasMessages }: Props) {
  const ids = activeAgentIds(config);
  const running = status === "Running";

  return (
    <ol className="cast" aria-label="Voices">
      {ids.map((id) => {
        const name = agentLabel(id, config);
        const isNext = hasMessages && id === upNext;
        const state = isNext ? (running ? "speaking" : "next") : "idle";
        return (
          <li
            key={id}
            className={`cast-chip is-${state}`}
            style={{ ["--voice" as string]: agentAccent(id, config) }}
            title={
              state === "speaking"
                ? `${name} is writing`
                : state === "next"
                  ? `${name} speaks next`
                  : name
            }
          >
            <VoiceAvatar
              className="cast-avatar"
              name={name}
              icon={agentConfig(id, config)?.icon}
              color={agentAccent(id, config)}
            />
            <span className="cast-name">{name}</span>
            {state !== "idle" && (
              <span className="cast-tag">
                {state === "speaking" ? "live" : "next"}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default memo(CastStrip);
