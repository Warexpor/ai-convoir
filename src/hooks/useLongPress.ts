import { useRef, type PointerEvent } from "react";

const HOLD_MS = 450;
const SLOP = 10;

/** Lifting the finger after a long-press still fires a click, which would
 *  land on whatever the press just opened (e.g. a sheet's scrim). */
function swallowNextClick() {
  const eat = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", eat, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", eat, true), 800);
}

/** Touch long-press. Mouse and pen are ignored: desktop keeps hover actions. */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    window.clearTimeout(timer.current);
    origin.current = null;
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      // Links and buttons inside the target keep their own tap (the target
      // itself may be a button, e.g. a thread row).
      const hit = (e.target as HTMLElement).closest("a, button");
      if (hit && hit !== e.currentTarget) return;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        origin.current = null;
        navigator.vibrate?.(8);
        swallowNextClick();
        onLongPress();
      }, HOLD_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      const o = origin.current;
      if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: { preventDefault: () => void }) => {
      // Android fires contextmenu on long-press; ours replaces it.
      if (window.matchMedia("(hover: none)").matches) e.preventDefault();
    },
  };
}
