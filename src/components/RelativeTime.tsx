import { memo, useEffect, useState } from "react";
import { relativeTime } from "../types";

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
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [at]);

  return (
    <time className={className} dateTime={new Date(at).toISOString()}>
      {label}
    </time>
  );
}

export default memo(RelativeTime);
