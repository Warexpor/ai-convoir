import { memo, useLayoutEffect, useRef, useState } from "react";
import type { AppStatus, InnerState } from "../types";
import { activeAgentIds, agentLabel } from "../types";

interface Props {
  config: InnerState | null;
  status: AppStatus;
  /** Agent id whose turn is next (or in flight while running). */
  upNext: string | null;
  hasMessages: boolean;
  /** Clicking a voice opens its editor. */
  onEditVoice?: (id: string) => void;
}

/**
 * The voices as the top bar's tabs: the one up next is ink, the rest are
 * mute, and one springing underline hands the turn along.
 */
function CastStrip({ config, status, upNext, hasMessages, onEditVoice }: Props) {
  const ids = activeAgentIds(config);
  const running = status === "Running";
  const listRef = useRef<HTMLDivElement>(null);
  const focusIdx = upNext && (hasMessages || running) ? ids.indexOf(upNext) : -1;
  const [bar, setBar] = useState<{ x: number } | null>(null);
  const [live, setLive] = useState(false);
  const names = ids.map((id) => agentLabel(id, config)).join("|");

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const tab = el.querySelectorAll<HTMLElement>(".tab")[focusIdx];
      if (focusIdx < 0 || !tab) {
        setBar(null);
        return;
      }
      const x = tab.offsetLeft + tab.offsetWidth / 2;
      setBar((b) => (b && b.x === x ? b : { x }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [focusIdx, names]);

  useLayoutEffect(() => {
    if (!bar || live) return;
    const id = requestAnimationFrame(() => setLive(true));
    return () => cancelAnimationFrame(id);
  }, [bar, live]);

  return (
    <div ref={listRef} className={`tabs${live ? " is-live" : ""}`} role="list" aria-label="Voices">
      {ids.map((id, i) => {
        const name = agentLabel(id, config);
        const on = i === focusIdx;
        return (
          <button
            key={id}
            type="button"
            role="listitem"
            className={`tab${on ? " on" : ""}`}
            title={on ? (running ? `${name} is writing` : `${name} speaks next`) : `Edit ${name}`}
            onClick={() => onEditVoice?.(id)}
          >
            {name}
          </button>
        );
      })}
      <span
        className={`tabs-bar${bar ? " is-on" : ""}${running ? " is-speaking" : ""}`}
        aria-hidden
        style={bar ? { transform: `translate3d(${bar.x}px, 0, 0)` } : undefined}
      />
    </div>
  );
}

export default memo(CastStrip);
