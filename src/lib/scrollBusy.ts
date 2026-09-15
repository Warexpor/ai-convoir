/** Shared “chat is scrolling” signal so the stage shader can pause without React. */

type Listener = (busy: boolean) => void;

let busy = false;
let clearTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

export function isScrollBusy() {
  return busy;
}

export function onScrollBusy(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Mark scroll activity; clears automatically after `idleMs` of quiet. */
export function pulseScrollBusy(idleMs = 140) {
  if (!busy) {
    busy = true;
    listeners.forEach((fn) => fn(true));
  }
  if (clearTimer != null) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    clearTimer = null;
    if (!busy) return;
    busy = false;
    listeners.forEach((fn) => fn(false));
  }, idleMs);
}
