import { memo } from "react";
import type { BackgroundPrefs } from "../lib/background";

/**
 * The user's own image as the stage. Static layers only: the filter is
 * rasterized once and then composited, so it costs nothing per frame.
 */
function StageImage({ url, prefs }: { url: string; prefs: BackgroundPrefs }) {
  const filter = [prefs.mono ? "grayscale(1)" : "", prefs.blur ? `blur(${prefs.blur}px)` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="stage stage-image is-ready" aria-hidden>
      <div
        className="stage-image-pic"
        style={{
          backgroundImage: `url("${url}")`,
          filter: filter || undefined,
          // Blur pulls the edges in; overscan so they never show.
          transform: prefs.blur ? `scale(${1 + prefs.blur / 200 + 0.02})` : undefined,
        }}
      />
      <div className="stage-image-shade" style={{ opacity: prefs.dim }} />
    </div>
  );
}

export default memo(StageImage);
