import { useEffect, useState } from "react";

/** Phone layout: one column, full-screen sheets, bottom bar. */
/** A phone turned sideways is wide but short; it still wants the phone UI. */
export const PHONE_QUERY =
  "(max-width: 640px), (max-height: 500px) and (pointer: coarse)";
/** Rail becomes an overlay drawer below this width. */
export const NARROW_QUERY = "(max-width: 900px)";

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}
