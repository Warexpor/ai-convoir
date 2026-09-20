/** Pure helpers for ChatView virtualization (window, estimates, scroll anchor). */

export const EST_MSG = 168;
export const GAP = 28;
export const OVERSCAN = 6;
export const VIRTUALIZE_AFTER = 16;
export const NEAR_PX = 96;

export type VirtMessage = {
  content: string;
  reasoning?: string | null;
  streaming?: boolean;
};

/** Rough pixel estimate before ResizeObserver measures a row. */
export function estimateMessageHeight(
  msg: VirtMessage | undefined,
  thoughtsOpen = false,
): number {
  if (!msg) return EST_MSG;
  const charsPerLine = 72;
  const lineH = 25;
  const meta = 64;
  const contentLen = msg.content?.length ?? 0;
  const lines = Math.max(
    msg.streaming && !contentLen ? 1 : 0,
    Math.ceil(contentLen / charsPerLine),
  );
  let h = meta + Math.min(48, Math.max(1, lines)) * lineH;
  const reasoning = (msg.reasoning || "").trim();
  if (reasoning) {
    h += 36; // Thoughts toggle row
    if (thoughtsOpen) {
      // Body is capped in CSS (~240px) plus padding.
      const rLines = Math.ceil(reasoning.length / charsPerLine);
      h += Math.min(260, 28 + rLines * 20);
    }
  }
  if (msg.streaming) h += 10; // caret / live padding
  return Math.max(96, Math.min(h, 1400));
}

export function buildPrefixes(
  count: number,
  heightOf: (i: number) => number,
): number[] {
  const p = new Array<number>(count + 1);
  p[0] = 0;
  for (let i = 0; i < count; i++) p[i + 1] = p[i] + heightOf(i);
  return p;
}

export function nearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  nearPx = NEAR_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight < nearPx;
}

export type VirtWindow = { start: number; end: number };

/**
 * Binary-search the first row at/after scrollTop, then grow to cover the
 * viewport + overscan. When `pinEnd` (stick-to-bottom / live stream), always
 * include the last message so the streaming caret stays mounted.
 */
export function computeVirtualWindow(opts: {
  scrollTop: number;
  clientHeight: number;
  count: number;
  prefixes: number[];
  overscan?: number;
  pinEnd?: boolean;
}): VirtWindow {
  const {
    scrollTop,
    clientHeight,
    count,
    prefixes,
    overscan = OVERSCAN,
    pinEnd = false,
  } = opts;
  if (count <= 0) return { start: 0, end: 0 };

  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((prefixes[mid] ?? 0) < scrollTop) lo = mid + 1;
    else hi = mid;
  }
  let start = Math.max(0, lo - 1 - overscan);
  const limit = scrollTop + clientHeight;
  let end = start;
  while (end < count && (prefixes[end] ?? 0) < limit) end++;
  end = Math.min(count, end + overscan);
  if (pinEnd) end = count;
  // Keep a non-empty window even if estimates are wildly off.
  if (start >= end) start = Math.max(0, end - 1);
  return { start, end };
}

/** Visible slice when stick-to-bottom: last ~viewport rows through the end. */
export function bottomPinnedWindow(
  count: number,
  clientHeight: number,
  estRow = EST_MSG + GAP,
  overscan = OVERSCAN,
): VirtWindow {
  if (count <= 0) return { start: 0, end: 0 };
  const visible = Math.ceil(clientHeight / Math.max(1, estRow)) + overscan * 2;
  return {
    start: Math.max(0, count - visible),
    end: count,
  };
}

/**
 * When measured heights above `anchorIndex` change, shift scrollTop by the
 * delta so the viewport doesn't jump.
 */
export function scrollAnchorDelta(
  oldPrefixes: number[],
  newPrefixes: number[],
  anchorIndex: number,
): number {
  const i = Math.max(0, Math.min(anchorIndex, oldPrefixes.length - 1, newPrefixes.length - 1));
  return (newPrefixes[i] ?? 0) - (oldPrefixes[i] ?? 0);
}

export function slicePads(
  count: number,
  start: number,
  end: number,
  prefixes: number[],
  fallbackRow = EST_MSG + GAP,
): { topPad: number; bottomPad: number } {
  const s = Math.max(0, Math.min(start, count));
  const e = Math.max(s, Math.min(end, count));
  return {
    topPad: prefixes[s] ?? s * fallbackRow,
    bottomPad: Math.max(0, (prefixes[count] ?? 0) - (prefixes[e] ?? 0)),
  };
}
