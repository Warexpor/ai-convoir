import { useEffect, useRef } from "react";

const EDGE = 24; // px from the left edge where a drag may start
const TRIGGER = 56; // px of horizontal travel that commits

/**
 * Drawer gestures for touch screens: drag right from the left edge to
 * open, drag left anywhere while open to close. Vertical scrolls win.
 */
export function useEdgeSwipe(
  enabled: boolean,
  open: boolean,
  setOpen: (v: boolean) => void,
) {
  const state = useRef({ open, setOpen });
  state.current = { open, setOpen };

  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (state.current.open || t.clientX <= EDGE) {
        start = { x: t.clientX, y: t.clientY };
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
        start = null;
        return;
      }
      const { open: isOpen, setOpen: set } = state.current;
      if (!isOpen && dx > TRIGGER) {
        set(true);
        start = null;
      } else if (isOpen && dx < -TRIGGER) {
        set(false);
        start = null;
      }
    };
    const onEnd = () => {
      start = null;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);
}
