import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface SegOption<T> {
  value: T;
  label: ReactNode;
  title?: string;
}

interface Props<T> {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm";
  className?: string;
}

/**
 * Segmented control with a sliding glass thumb. The thumb is measured from
 * the active button, so options can have any width (and may wrap).
 */
export default function Seg<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size,
  className,
}: Props<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [live, setLive] = useState(false);
  const active = options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const btn = root.querySelectorAll<HTMLButtonElement>("button")[active];
      if (!btn) {
        setThumb(null);
        return;
      }
      const next = {
        x: btn.offsetLeft,
        y: btn.offsetTop,
        w: btn.offsetWidth,
        h: btn.offsetHeight,
      };
      setThumb((prev) =>
        prev &&
        prev.x === next.x &&
        prev.y === next.y &&
        prev.w === next.w &&
        prev.h === next.h
          ? prev
          : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [active, options.length]);

  // Snap into place on first paint, glide afterwards.
  useLayoutEffect(() => {
    if (!thumb || live) return;
    const id = requestAnimationFrame(() => setLive(true));
    return () => cancelAnimationFrame(id);
  }, [thumb, live]);

  return (
    <div
      ref={rootRef}
      className={["seg", size === "sm" ? "seg-sm" : "", live ? "is-live" : "", className]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label={label}
    >
      {thumb && (
        <span
          className="seg-thumb"
          aria-hidden
          style={{
            width: thumb.w,
            height: thumb.h,
            transform: `translate3d(${thumb.x}px, ${thumb.y}px, 0)`,
          }}
        />
      )}
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={o.value === value ? "on" : ""}
          aria-pressed={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
