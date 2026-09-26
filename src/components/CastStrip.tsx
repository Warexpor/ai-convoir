import { memo, useLayoutEffect, useRef, useState } from "react";
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
  const listRef = useRef<HTMLOListElement>(null);
  const focusIdx = hasMessages && upNext ? ids.indexOf(upNext) : -1;
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [live, setLive] = useState(false);
  const names = ids.map((id) => agentLabel(id, config)).join("|");

  // The highlight is one element that glides between chips, so a turn
  // change reads as a hand-off instead of two unrelated fades.
  useLayoutEffect(() => {
    const ol = listRef.current;
    if (!ol) return;
    const measure = () => {
      const chip = ol.children[focusIdx + 1] as HTMLElement | undefined;
      if (focusIdx < 0 || !chip) {
        setPill(null);
        return;
      }
      const next = { x: chip.offsetLeft, w: chip.offsetWidth };
      setPill((p) => (p && p.x === next.x && p.w === next.w ? p : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ol);
    return () => ro.disconnect();
  }, [focusIdx, running, names]);

  useLayoutEffect(() => {
    if (!pill || live) return;
    const id = requestAnimationFrame(() => setLive(true));
    return () => cancelAnimationFrame(id);
  }, [pill, live]);

  const pillColor = focusIdx >= 0 ? agentAccent(ids[focusIdx], config) : undefined;

  return (
    <ol
      ref={listRef}
      className={`cast${live ? " is-live" : ""}`}
      aria-label="Voices"
    >
      <li
        className={`cast-pill${pill ? " is-on" : ""}${running ? " is-speaking" : ""}`}
        aria-hidden
        style={
          pill
            ? {
                width: pill.w,
                transform: `translate3d(${pill.x}px, 0, 0)`,
                ["--voice" as string]: pillColor,
              }
            : undefined
        }
      />
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
