import type { ReactNode } from "react";

/** Brand mark, drawn in currentColor so it follows the theme. */
export function SlashMark({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      aria-hidden
      fill="currentColor"
    >
      <g transform="translate(0 1024) scale(0.1 -0.1)">
        <path d="M3555 8648 c-4 -27 -1 -3825 4 -3837 2 -6 37 19 446 309 215 152 425 301 467 331 l77 54 1 1588 0 1587 -495 0 -494 0 -6 -32z" />
        <path d="M5330 7233 l0 -1446 -259 -261 c-500 -505 -1076 -1139 -1896 -2087 -457 -529 -796 -931 -790 -937 3 -4 240 174 667 499 638 486 887 678 1038 797 l175 138 3 -1188 2 -1188 500 0 500 0 0 1656 0 1656 153 166 c371 404 752 833 1253 1412 84 96 212 245 286 331 357 411 773 909 748 894 -45 -27 -933 -698 -1235 -933 l-130 -101 -3 1019 -2 1020 -505 0 -505 0 0 -1447z" />
        <path d="M6525 5109 c-236 -131 -458 -254 -492 -272 l-63 -32 0 -1612 c0 -1073 3 -1613 10 -1613 6 0 231 110 500 245 l490 245 0 1640 c0 902 -3 1640 -7 1639 -5 0 -201 -108 -438 -240z" />
      </g>
    </svg>
  );
}

/** Line icons on a 24 grid, 1.75 stroke, round caps: one family everywhere. */
function Icon({ children, size = 20, className }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg
      className={["icon", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Two short bars: the History panel. */
export function IconMenu() {
  return (
    <Icon>
      <path d="M4 8h16M4 16h10" />
    </Icon>
  );
}

/** Pencil on a square: new thread. */
export function IconNew() {
  return (
    <Icon>
      <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
      <path d="M18.4 3.6a2 2 0 0 1 2.8 2.8L12.6 15l-3.6.9.9-3.6z" />
    </Icon>
  );
}

export function IconPlus() {
  return (
    <Icon>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

/** Two people: the voices. */
export function IconVoices() {
  return (
    <Icon>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4A6 6 0 0 1 21 20" />
    </Icon>
  );
}

export function IconSliders() {
  return (
    <Icon>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Icon>
  );
}

export function IconGear() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Icon>
  );
}

export function IconSearch() {
  return (
    <Icon>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Icon>
  );
}

/** » — hide the History panel. */
export function IconRailHide() {
  return (
    <Icon>
      <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />
    </Icon>
  );
}

/** « — show it again. */
export function IconBack() {
  return (
    <Icon>
      <path d="m15 18-6-6 6-6" />
    </Icon>
  );
}

export function IconChevron() {
  return (
    <Icon>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  );
}

export function IconChevronDown() {
  return (
    <Icon>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

/** Send: an arrow straight up. */
export function IconArrowUp() {
  return (
    <Icon>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Icon>
  );
}

/** Next voice in Step mode: arrow up, handed on. */
export function IconNextVoice() {
  return <IconArrowUp />;
}

/** Enter key glyph. */
export function IconReturn() {
  return (
    <Icon>
      <path d="M20 5v7a3 3 0 0 1-3 3H5" />
      <path d="m9 11-4 4 4 4" />
    </Icon>
  );
}

export function IconPlay() {
  return (
    <Icon>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconPause() {
  return (
    <Icon>
      <rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconStop() {
  return (
    <Icon>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconKey() {
  return (
    <Icon>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M17 6l3 3M14.5 8.5l2 2" />
    </Icon>
  );
}

export function IconSave() {
  return (
    <Icon>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" />
    </Icon>
  );
}

export function IconExport() {
  return (
    <Icon>
      <path d="M12 15V3M7 8l5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </Icon>
  );
}

export function IconRetry() {
  return (
    <Icon>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </Icon>
  );
}

export function IconCopy() {
  return (
    <Icon>
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Icon>
  );
}

export function IconCheck() {
  return (
    <Icon>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function IconMore() {
  return (
    <Icon>
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" />
    </Icon>
  );
}

export function IconMoreVert() {
  return (
    <Icon>
      <circle cx="12" cy="5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="19" r="1.2" fill="currentColor" />
    </Icon>
  );
}

/** Whisper: a speech bubble with a quiet line inside. */
export function IconHint() {
  return (
    <Icon>
      <path d="M20 12a8 8 0 0 1-11.7 7.1L4 20l1-4.1A8 8 0 1 1 20 12z" />
      <path d="M9 12h6" />
    </Icon>
  );
}

export function IconTrash() {
  return (
    <Icon>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </Icon>
  );
}

/** Thinking: a bulb. */
export function IconBulb() {
  return (
    <Icon>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3z" />
    </Icon>
  );
}

/** Stream: lines settling in. */
export function IconLive() {
  return (
    <Icon>
      <path d="M4 7h16M4 12h12M4 17h7" />
    </Icon>
  );
}

/** Appearance: half-lit disc. */
export function IconSpark() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** Conversation: stacked bubbles. */
export function IconThreads() {
  return (
    <Icon>
      <path d="M14 9a5 5 0 0 0-10 0c0 1 .3 1.9.8 2.7L4 14l2.4-.7A5 5 0 0 0 14 9z" />
      <path d="M10.5 15.6A5 5 0 0 0 17.6 18l2.4.7-.8-2.3A5 5 0 0 0 16 9.2" />
    </Icon>
  );
}

/** Keyboard. */
export function IconKeyboard() {
  return (
    <Icon>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </Icon>
  );
}
