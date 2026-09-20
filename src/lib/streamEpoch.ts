/**
 * Pure helpers for stream abort vs restart races and Thoughts layout.
 * Kept free of React so node:test can cover them cheaply.
 */

export type AbortPayload = {
  agent?: string;
  turn?: number;
  /** Stream epoch at the moment of abort (from bump_stream_epoch). */
  epoch?: number;
};

/** Ignore a stale abort that predates the latest stream-start. */
export function shouldApplyAbort(
  abortEpoch: number | undefined,
  lastStartEpoch: number,
): boolean {
  if (abortEpoch == null) return true; // legacy payloads: always apply
  return abortEpoch >= lastStartEpoch;
}

/**
 * While streaming with only reasoning, do not flash an empty content bubble
 * just because the Thoughts UI preference was toggled off.
 */
export function shouldShowContentBubble(opts: {
  content: string;
  reasoning: string;
  streaming: boolean;
  showThoughtsUi: boolean;
}): boolean {
  const content = opts.content || "";
  const reasoning = (opts.reasoning || "").trim();
  if (content) return true;
  if (opts.streaming && reasoning) return false;
  // No thoughts to show (or thoughts UI off with no reasoning yet): keep bubble
  // for the streaming caret / empty completed row.
  if (!opts.showThoughtsUi) return true;
  return !reasoning;
}
