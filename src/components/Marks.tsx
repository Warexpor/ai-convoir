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
  size = 15,
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
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Saved threads: spine + transcript ticks. */
export function IconThreads() {
  return (
    <Icon>
      <path d="M3.6 2.8v10.4" {...stroke} strokeWidth={1.55} />
      <path d="M6.4 4.1h7M6.4 8h5.1M6.4 11.9h6.2" {...stroke} />
    </Icon>
  );
}

/** Settings is voices, not sliders. */
export function IconVoices() {
  return (
    <Icon>
      <circle cx="5.55" cy="8" r="3.05" {...stroke} />
      <circle cx="10.45" cy="8" r="3.05" {...stroke} />
    </Icon>
  );
}

export function IconKey() {
  return (
    <Icon>
      <circle cx="5.35" cy="8" r="2.55" {...stroke} />
      <path d="M7.9 8h6.35" {...stroke} />
      <path d="M11.55 8v2.15M13.85 8v2.85" {...stroke} />
    </Icon>
  );
}

/** Enter / begin / send a hint. */
export function IconReturn() {
  return (
    <Icon>
      <path d="M3.15 9h7.35a2.7 2.7 0 0 0 0-5.4H8.6" {...stroke} />
      <path d="M5.7 6.45 3.15 9l2.55 2.55" {...stroke} />
    </Icon>
  );
}

/** Next speaker in the rotation. */
export function IconNextVoice() {
  return (
    <Icon>
      <circle cx="4.35" cy="8" r="2.2" {...stroke} />
      <path d="M9.15 4.7 13.35 8l-4.2 3.3" {...stroke} />
    </Icon>
  );
}

export function IconPause() {
  return (
    <Icon>
      <rect x="4.05" y="3.35" width="2.45" height="9.3" rx="1.15" fill="currentColor" />
      <rect x="9.5" y="3.35" width="2.45" height="9.3" rx="1.15" fill="currentColor" />
    </Icon>
  );
}

export function IconPlay() {
  return (
    <Icon>
      <path
        d="M5.15 3.2c0-.72.78-1.16 1.38-.72l6.35 4.12c.55.36.55 1.16 0 1.52L6.53 12.24c-.6.44-1.38 0-1.38-.72V3.2Z"
        fill="currentColor"
      />
    </Icon>
  );
}

export function IconStop() {
  return (
    <Icon size={13}>
      <rect x="3.15" y="3.15" width="9.7" height="9.7" rx="2.2" fill="currentColor" />
    </Icon>
  );
}

export function IconSearch() {
  return (
    <Icon size={14}>
      <circle cx="6.85" cy="6.85" r="4.05" {...stroke} />
      <path d="M10 10.15 13.55 14" {...stroke} />
    </Icon>
  );
}

/** New thread: spine plus a plus. */
export function IconNew() {
  return (
    <Icon>
      <path d="M3.55 3.1v9.8" {...stroke} strokeWidth={1.55} />
      <path d="M6.5 8h7.1M10.05 4.4v7.2" {...stroke} />
    </Icon>
  );
}

export function IconRailHide() {
  return (
    <Icon>
      <rect x="2.35" y="3.15" width="5.4" height="9.7" rx="1.35" {...stroke} />
      <path d="M14.05 5.35 10.5 8l3.55 2.65" {...stroke} />
    </Icon>
  );
}

export function IconSave() {
  return (
    <Icon>
      <path d="M4.15 2.55h7.7v11.05L8 11.05 4.15 13.6V2.55Z" {...stroke} />
    </Icon>
  );
}

export function IconExport() {
  return (
    <Icon>
      <path d="M3.3 9.35v3.05a1.15 1.15 0 0 0 1.15 1.15h7.1A1.15 1.15 0 0 0 12.7 12.4V9.35" {...stroke} />
      <path d="M8 10.4V2.7M5.15 5.45 8 2.7l2.85 2.75" {...stroke} />
    </Icon>
  );
}

export function IconRetry() {
  return (
    <Icon>
      <path d="M12.85 8.05A4.85 4.85 0 1 1 11.2 4.4" {...stroke} />
      <path d="M12.85 2.45v3.55h-3.5" {...stroke} />
    </Icon>
  );
}

export function IconCopy() {
  return (
    <Icon size={14}>
      <rect x="5.35" y="5.2" width="7.35" height="7.45" rx="1.45" {...stroke} />
      <path d="M3.4 10.35V4.7A1.45 1.45 0 0 1 4.85 3.25h5.55" {...stroke} />
    </Icon>
  );
}

export function IconCheck() {
  return (
    <Icon size={14}>
      <path d="M3.15 8.15 6.45 11.4 12.85 4.55" {...stroke} strokeWidth={1.55} />
    </Icon>
  );
}

export function IconChevron() {
  return (
    <Icon size={12}>
      <path d="M5.7 3.35 10.4 8 5.7 12.65" {...stroke} />
    </Icon>
  );
}

export function IconChevronDown() {
  return (
    <Icon size={12}>
      <path d="M3.35 5.7 8 10.4 12.65 5.7" {...stroke} />
    </Icon>
  );
}

/** Overflow — three brand bars, not three dots. */
export function IconMore() {
  return (
    <Icon>
      <rect x="2.7" y="5.15" width="2.2" height="5.7" rx="1.05" fill="currentColor" />
      <rect x="6.9" y="3.45" width="2.2" height="9.1" rx="1.05" fill="currentColor" />
      <rect x="11.1" y="5.15" width="2.2" height="5.7" rx="1.05" fill="currentColor" />
    </Icon>
  );
}

/** Whisper / hint — quote ticks. */
export function IconHint() {
  return (
    <Icon size={13}>
      <path d="M4.35 4.7 6.2 11.3M9.8 4.7 11.65 11.3" {...stroke} strokeWidth={1.7} />
    </Icon>
  );
}
