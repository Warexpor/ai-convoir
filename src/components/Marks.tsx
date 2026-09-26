import type { ReactNode } from "react";

/** Brand mark plus the chrome icon family: duotone — a crisp line over a
 *  translucent body (`.t`), so icons read at 14px and glow up on hover. */

export function SlashMark({
  className,
  size = 20,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <img
      className={className}
      src="/logo-mark.png"
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}

function Icon({
  children,
  size = 16,
  className,
}: {
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={["icon", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const stroke = {
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const T = { className: "t", fill: "currentColor" } as const;

/** Saved threads: spine + transcript ticks. */
export function IconThreads() {
  return (
    <Icon>
      <rect x="2.5" y="2.5" width="11" height="11" rx="3" {...T} />
      <path d="M5.4 5.6h5.2M5.4 8h3.6M5.4 10.4h4.4" {...stroke} />
    </Icon>
  );
}

/** Settings is two voices talking, not a gear. */
export function IconVoices() {
  return (
    <Icon>
      <path d="M9.6 3.2h2.2a2.4 2.4 0 0 1 2.4 2.4v2.1a2.4 2.4 0 0 1-2.4 2.4h-.3v1.8L9.4 10.1" {...T} />
      <path d="M4.2 2.6h3.9a2.5 2.5 0 0 1 2.5 2.5v2.3a2.5 2.5 0 0 1-2.5 2.5H6.2l-2.6 2.2V9.9h.6A2.5 2.5 0 0 1 1.7 7.4V5.1a2.5 2.5 0 0 1 2.5-2.5Z" {...stroke} />
    </Icon>
  );
}

export function IconKey() {
  return (
    <Icon>
      <circle cx="5.2" cy="8" r="3.3" {...T} />
      <circle cx="5.2" cy="8" r="3.3" {...stroke} />
      <circle cx="5.2" cy="8" r=".9" fill="currentColor" />
      <path d="M8.5 8h5.3M11.3 8v2.2M13.5 8v2.8" {...stroke} />
    </Icon>
  );
}

/** Enter / begin / send a hint. */
export function IconReturn() {
  return (
    <Icon>
      <path d="M3.1 9.15h7.45a2.75 2.75 0 0 0 0-5.5H8.4" {...stroke} strokeWidth={1.6} />
      <path d="M5.75 6.55 3.1 9.15l2.65 2.6" {...stroke} strokeWidth={1.6} />
    </Icon>
  );
}

/** Next speaker in the rotation: a voice dot handing off. */
export function IconNextVoice() {
  return (
    <Icon>
      <circle cx="4.6" cy="8" r="3" {...T} />
      <circle cx="4.6" cy="8" r="1.35" fill="currentColor" />
      <path d="M9.4 4.4 13.1 8l-3.7 3.6" {...stroke} strokeWidth={1.7} />
    </Icon>
  );
}

export function IconPause() {
  return (
    <Icon>
      <rect x="3.7" y="2.9" width="3" height="10.2" rx="1.4" fill="currentColor" />
      <rect x="9.3" y="2.9" width="3" height="10.2" rx="1.4" fill="currentColor" />
    </Icon>
  );
}

export function IconPlay() {
  return (
    <Icon>
      <path
        d="M4.9 3.3c0-.95 1.03-1.54 1.85-1.06l6.75 3.95c.82.48.82 1.67 0 2.14l-6.75 3.95c-.82.48-1.85-.11-1.85-1.06V3.3Z"
        fill="currentColor"
        transform="translate(0 1)"
      />
    </Icon>
  );
}

export function IconStop() {
  return (
    <Icon size={14}>
      <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
    </Icon>
  );
}

export function IconSearch() {
  return (
    <Icon size={14}>
      <circle cx="7" cy="7" r="4.3" {...T} />
      <circle cx="7" cy="7" r="4.3" {...stroke} />
      <path d="M10.3 10.3 13.6 13.6" {...stroke} strokeWidth={1.8} />
    </Icon>
  );
}

/** New thread — a fresh page with a plus. */
export function IconNew() {
  return (
    <Icon>
      <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="3.6" {...T} />
      <path d="M8 5.1v5.8M5.1 8h5.8" {...stroke} strokeWidth={1.7} />
    </Icon>
  );
}

/** Collapse the rail. */
export function IconRailHide() {
  return (
    <Icon>
      <rect x="1.9" y="2.6" width="4.4" height="10.8" rx="2" {...T} />
      <rect x="1.9" y="2.6" width="12.2" height="10.8" rx="2.6" {...stroke} />
      <path d="M11.2 6.1 9.3 8l1.9 1.9" {...stroke} />
    </Icon>
  );
}

export function IconSave() {
  return (
    <Icon>
      <path d="M4.3 2.4h7.4c.5 0 .9.4.9.9v10.3L8 10.8l-4.6 2.8V3.3c0-.5.4-.9.9-.9Z" {...T} />
      <path d="M4.3 2.4h7.4c.5 0 .9.4.9.9v10.3L8 10.8l-4.6 2.8V3.3c0-.5.4-.9.9-.9Z" {...stroke} />
    </Icon>
  );
}

export function IconExport() {
  return (
    <Icon>
      <path d="M2.8 9.2h10.4v2.6a2 2 0 0 1-2 2H4.8a2 2 0 0 1-2-2V9.2Z" {...T} />
      <path d="M8 10.2V2.6M5 5.5 8 2.6l3 2.9" {...stroke} />
      <path d="M2.8 9.2v2.6a2 2 0 0 0 2 2h6.4a2 2 0 0 0 2-2V9.2" {...stroke} />
    </Icon>
  );
}

export function IconRetry() {
  return (
    <Icon>
      <path d="M13 8.1A5 5 0 1 1 11.25 4.2" {...stroke} strokeWidth={1.6} />
      <path d="M13.1 2.4v3.6H9.5" {...stroke} strokeWidth={1.6} />
    </Icon>
  );
}

export function IconCopy() {
  return (
    <Icon size={14}>
      <rect x="2.4" y="2.4" width="7.6" height="7.6" rx="2" {...T} />
      <rect x="5.6" y="5.6" width="8" height="8" rx="2" {...stroke} />
    </Icon>
  );
}

export function IconCheck() {
  return (
    <Icon size={14}>
      <path d="M3 8.3 6.4 11.6 13.1 4.4" {...stroke} strokeWidth={1.8} />
    </Icon>
  );
}

export function IconChevron() {
  return (
    <Icon size={12}>
      <path d="M5.8 3.2 10.6 8l-4.8 4.8" {...stroke} strokeWidth={1.7} />
    </Icon>
  );
}

export function IconChevronDown() {
  return (
    <Icon size={12}>
      <path d="M3.2 5.8 8 10.6l4.8-4.8" {...stroke} strokeWidth={1.7} />
    </Icon>
  );
}

/** Overflow — three voices in a row. */
export function IconMore() {
  return (
    <Icon>
      <circle cx="3.4" cy="8" r="1.6" fill="currentColor" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" />
      <circle cx="12.6" cy="8" r="1.6" fill="currentColor" />
    </Icon>
  );
}

/** Whisper — a small bubble with a hush tick. */
export function IconHint() {
  return (
    <Icon size={14}>
      <path d="M3.4 3h9.2A1.9 1.9 0 0 1 14.5 4.9v4.6a1.9 1.9 0 0 1-1.9 1.9H8.4L5.3 14v-2.6H3.4A1.9 1.9 0 0 1 1.5 9.5V4.9A1.9 1.9 0 0 1 3.4 3Z" {...T} />
      <path d="M5.4 6.3h5.2M5.4 8.4h3.2" {...stroke} />
    </Icon>
  );
}

export function IconTrash() {
  return (
    <Icon size={14}>
      <path d="M4.2 5h7.6l-.6 7.7a1.3 1.3 0 0 1-1.3 1.2H6.1a1.3 1.3 0 0 1-1.3-1.2L4.2 5Z" {...T} />
      <path d="M2.8 4.6h10.4M6.3 4.4V3.2c0-.4.3-.7.7-.7h2c.4 0 .7.3.7.7v1.2" {...stroke} />
      <path d="M4.2 5l.6 7.7a1.3 1.3 0 0 0 1.3 1.2h3.8a1.3 1.3 0 0 0 1.3-1.2l.6-7.7" {...stroke} />
    </Icon>
  );
}

/** Rename: a pencil. */
export function IconEdit() {
  return (
    <Icon size={14}>
      <path d="M10.6 2.9l2.5 2.5-7.4 7.4-3.1.6.6-3.1 7.4-7.4Z" {...T} />
      <path d="M10.6 2.9l2.5 2.5-7.4 7.4-3.1.6.6-3.1 7.4-7.4ZM9.2 4.3l2.5 2.5" {...stroke} />
    </Icon>
  );
}

/** Rail toggle: panel with a lit sidebar. */
export function IconRail() {
  return (
    <Icon>
      <rect x="1.9" y="2.6" width="4.4" height="10.8" rx="2" {...T} />
      <rect x="1.9" y="2.6" width="12.2" height="10.8" rx="2.6" {...stroke} />
      <path d="M9.3 6.1 11.2 8l-1.9 1.9" {...stroke} />
    </Icon>
  );
}

/** Spark — a starter / suggestion. */
export function IconSpark() {
  return (
    <Icon size={14}>
      <path
        d="M7.4 1.8c.35 3 1.6 4.25 4.6 4.6-3 .35-4.25 1.6-4.6 4.6-.35-3-1.6-4.25-4.6-4.6 3-.35 4.25-1.6 4.6-4.6Z"
        fill="currentColor"
      />
      <path d="M12.3 9.8c.17 1.3.63 1.76 1.9 1.9-1.27.17-1.73.63-1.9 1.9-.17-1.27-.63-1.73-1.9-1.9 1.27-.14 1.73-.6 1.9-1.9Z" {...T} />
    </Icon>
  );
}

/** On air — a static level meter; the live state lives in the label. */
export function IconLive() {
  return (
    <Icon size={12}>
      <rect x="2" y="7" width="2.4" height="6" rx="1.2" fill="currentColor" />
      <rect x="6.8" y="3" width="2.4" height="10" rx="1.2" fill="currentColor" />
      <rect x="11.6" y="5.5" width="2.4" height="7.5" rx="1.2" {...T} />
    </Icon>
  );
}

/** Settings — two sliders, a line with a knob each. */
export function IconSliders() {
  return (
    <Icon>
      <path d="M2.5 5h11M2.5 11h11" {...stroke} />
      <circle cx="10.2" cy="5" r="2.1" {...T} />
      <circle cx="10.2" cy="5" r="2.1" {...stroke} />
      <circle cx="5.8" cy="11" r="2.1" {...T} />
      <circle cx="5.8" cy="11" r="2.1" {...stroke} />
    </Icon>
  );
}

/** Phone chrome: back arrow for full-screen sheets. */
export function IconBack() {
  return (
    <Icon size={20}>
      <path d="M13.5 8H2.8M7 3.6 2.6 8 7 12.4" {...stroke} strokeWidth={1.4} />
    </Icon>
  );
}

/** Phone chrome: navigation drawer. */
export function IconMenu() {
  return (
    <Icon size={20}>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" {...stroke} strokeWidth={1.4} />
    </Icon>
  );
}

/** Phone chrome: vertical overflow. */
export function IconMoreVert() {
  return (
    <Icon size={20}>
      <circle cx="8" cy="3.4" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="12.6" r="1.25" fill="currentColor" />
    </Icon>
  );
}
