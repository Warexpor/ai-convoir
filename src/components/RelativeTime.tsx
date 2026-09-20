import { memo, useEffect, useState } from "react";
import { relativeTime } from "../types";

const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!interval) {
    interval = setInterval(() => {
      listeners.forEach((l) => l());
    }, 15_000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && interval) {
      clearInterval(interval);
      interval = null;
    }
  };
}

function RelativeTime({
  at,
  className = "msg-time",
}: {
  at: number;
  className?: string;
}) {
  const [label, setLabel] = useState(() => relativeTime(at));

  useEffect(() => {
    const tick = () => setLabel(relativeTime(at));
    tick();
    return subscribe(tick);
  }, [at]);

  return (
    <time className={className} dateTime={new Date(at).toISOString()}>
      {label}
    </time>
  );
}

export default memo(RelativeTime);
