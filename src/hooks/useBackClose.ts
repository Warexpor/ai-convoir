import { useEffect, useRef } from "react";

/**
 * Android back button (and browser Back) closes the top-most open layer
 * instead of leaving the app. Each open layer pushes one history entry;
 * Back pops it and closes that layer. Closing a layer from the UI rewinds
 * its entry so history never fills with dead states.
 */
interface Entry {
  close: () => void;
  popped: boolean;
}

const stack: Entry[] = [];
let skipPops = 0;
let listening = false;
/** Pushes made while a rewind is in flight wait for it, or the rewind
 *  (async) would land on the new entry instead of the old one. */
let deferredPushes = 0;

function push() {
  if (skipPops > 0) deferredPushes++;
  else history.pushState({ convoirLayer: true }, "");
}

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("popstate", () => {
    if (skipPops > 0) {
      skipPops--;
      if (skipPops === 0) {
        for (; deferredPushes > 0; deferredPushes--) {
          history.pushState({ convoirLayer: true }, "");
        }
      }
      return;
    }
    const top = stack.pop();
    if (top) {
      top.popped = true;
      top.close();
    }
  });
}

export function useBackClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    listen();
    const entry: Entry = { close: () => closeRef.current(), popped: false };
    stack.push(entry);
    push();
    return () => {
      if (entry.popped) return;
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (deferredPushes > 0) {
        // Its entry was never pushed; just drop the pending push.
        deferredPushes--;
        return;
      }
      skipPops++;
      history.back();
    };
  }, [open]);
}
