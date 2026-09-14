import type { ReactNode } from "react";

/** Brand mark plus a small family of chrome icons — two-bar / slash geometry, not generic placeholders. */

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
  strokeWidth: 1.45,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Saved threads: spine + transcript ticks. Filled so 16px still reads. */
export function IconThreads() {
  return (
    <Icon>
      <rect x="3.1" y="2.6" width="2.15" height="10.8" rx="1.05" fill="currentColor" />
      <rect x="6.5" y="2.85" width="7.2" height="2.15" rx="1.05" fill="currentColor" />
      <rect x="6.5" y="6.95" width="5.35" height="2.15" rx="1.05" fill="currentColor" />
      <rect x="6.5" y="11.05" width="6.35" height="2.15" rx="1.05" fill="currentColor" />
    </Icon>
  );
}

/** Settings is two voices, not a gear. */
export function IconVoices() {
  return (
    <Icon>
      <circle cx="5.15" cy="8" r="3.2" {...stroke} />
      <circle cx="10.85" cy="8" r="3.2" {...stroke} />
    </Icon>
  );
}

export function IconKey() {
  return (
    <Icon>
      <circle cx="5.1" cy="8" r="3.05" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8.15 8H14M11.45 8v2.45M13.7 8v3.25"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </Icon>
  );
}

/** Enter / begin / send a hint. */
export function IconReturn() {
  return (
    <Icon>
      <path d="M3.1 9.15h7.45a2.75 2.75 0 0 0 0-5.5H8.4" {...stroke} />
      <path d="M5.75 6.55 3.1 9.15l2.65 2.6" {...stroke} />
    </Icon>
  );
}

/** Next speaker in the rotation. */
export function IconNextVoice() {
  return (
    <Icon>
      <circle cx="4.2" cy="8" r="2.35" {...stroke} />
      <path d="M9 4.55 13.55 8 9 11.45" {...stroke} strokeWidth={1.6} />
    </Icon>
  );
}

export function IconPause() {
  return (
    <Icon>
      <rect x="3.85" y="3.15" width="2.55" height="9.7" rx="1.2" fill="currentColor" />
      <rect x="9.6" y="3.15" width="2.55" height="9.7" rx="1.2" fill="currentColor" />
    </Icon>
  );
}

export function IconPlay() {
  return (
    <Icon>
      <path
        d="M5.05 3.05c0-.74.8-1.18 1.4-.72l6.5 4.22c.56.36.56 1.18 0 1.54l-6.5 4.22c-.6.44-1.4 0-1.4-.72V3.05Z"
        fill="currentColor"
      />
    </Icon>
  );
}

export function IconStop() {
  return (
    <Icon size={14}>
      <rect x="3" y="3" width="10" height="10" rx="2.3" fill="currentColor" />
    </Icon>
  );
}

export function IconSearch() {
  return (
    <Icon size={14}>
      <circle cx="6.7" cy="6.7" r="4.15" {...stroke} />
      <path d="M9.9 10.15 13.7 14" {...stroke} />
    </Icon>
  );
}

/** New thread — rounded plus, same bar language as pause. */
export function IconNew() {
  return (
    <Icon>
      <rect x="6.9" y="2.7" width="2.2" height="10.6" rx="1.1" fill="currentColor" />
      <rect x="2.7" y="6.9" width="10.6" height="2.2" rx="1.1" fill="currentColor" />
    </Icon>
  );
}

/** Collapse the rail: brand bar + chevron. */
export function IconRailHide() {
  return (
    <Icon>
      <rect x="2.4" y="3.05" width="2.3" height="9.9" rx="1.1" fill="currentColor" />
      <path d="M13.9 4.7 9.15 8l4.75 3.3" {...stroke} strokeWidth={1.6} />
    </Icon>
  );
}

export function IconSave() {
  return (
    <Icon>
      <path d="M4.05 2.4h7.9v11.3L8 10.85 4.05 13.7V2.4Z" {...stroke} />
    </Icon>
  );
}

export function IconExport() {
  return (
    <Icon>
      <path d="M3.2 9.4v3.15A1.2 1.2 0 0 0 4.4 13.75h7.2A1.2 1.2 0 0 0 12.8 12.55V9.4" {...stroke} />
      <path d="M8 10.55V2.55M4.95 5.5 8 2.55 11.05 5.5" {...stroke} />
    </Icon>
  );
}

export function IconRetry() {
  return (
    <Icon>
      <path d="M13 8.1A5 5 0 1 1 11.25 4.2" {...stroke} />
      <path d="M13 2.3v3.7H9.3" {...stroke} />
    </Icon>
  );
}

export function IconCopy() {
  return (
    <Icon size={14}>
      <rect x="5.3" y="5.1" width="7.5" height="7.6" rx="1.5" {...stroke} />
      <path d="M3.3 10.4V4.55A1.5 1.5 0 0 1 4.8 3.05h5.7" {...stroke} />
    </Icon>
  );
}

export function IconCheck() {
  return (
    <Icon size={14}>
      <path d="M3 8.2 6.45 11.55 13.05 4.4" {...stroke} strokeWidth={1.6} />
    </Icon>
  );
}

export function IconChevron() {
  return (
    <Icon size={12}>
      <path d="M5.55 3.2 10.55 8 5.55 12.8" {...stroke} />
    </Icon>
  );
}

export function IconChevronDown() {
  return (
    <Icon size={12}>
      <path d="M3.2 5.55 8 10.55 12.8 5.55" {...stroke} />
    </Icon>
  );
}

/** Overflow — three brand bars, not three dots. */
export function IconMore() {
  return (
    <Icon>
      <rect x="2.55" y="5.05" width="2.3" height="5.9" rx="1.1" fill="currentColor" />
      <rect x="6.85" y="3.2" width="2.3" height="9.6" rx="1.1" fill="currentColor" />
      <rect x="11.15" y="5.05" width="2.3" height="5.9" rx="1.1" fill="currentColor" />
    </Icon>
  );
}

/** Whisper / hint — quote ticks. */
export function IconHint() {
  return (
    <Icon size={14}>
      <path d="M4.2 4.45 6.15 11.5M9.85 4.45 11.8 11.5" {...stroke} strokeWidth={1.8} />
    </Icon>
  );
}
