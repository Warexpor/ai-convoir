import { useEffect, useState } from "react";

/** Keep children mounted for `ms` after `open` becomes false so exit motion can play. */
export function usePresence(open: boolean, ms = 220): boolean {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      return undefined;
    }
    const t = window.setTimeout(() => setShown(false), ms);
    return () => window.clearTimeout(t);
  }, [open, ms]);
  return shown;
}
