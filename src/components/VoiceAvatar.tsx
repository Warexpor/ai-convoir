import { memo, type ReactNode } from "react";
import { agentInitials, inkOn } from "../types";

/** Built-in avatar glyphs — filled shapes on a 16px grid so they read tiny. */
export const GLYPHS: Record<string, ReactNode> = {
  spark: (
    <path d="M8 1.6c.45 3.6 2.35 5.5 5.95 5.95-3.6.45-5.5 2.35-5.95 5.95-.45-3.6-2.35-5.5-5.95-5.95C5.65 7.1 7.55 5.2 8 1.6Z" />
  ),
  moon: <path d="M10.6 2.1a6.1 6.1 0 1 0 3.3 8.9A5 5 0 0 1 10.6 2.1Z" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="3.1" />
      <path
        d="M8 1.3v1.6M8 13.1v1.6M1.3 8h1.6M13.1 8h1.6M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M3.3 12.7l1.1-1.1M11.6 4.4l1.1-1.1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </>
  ),
  bolt: <path d="M9.2 1.4 3.4 9.1h4l-1 5.5 5.9-7.8H8.3l.9-5.4Z" />,
  eye: (
    <>
      <path d="M8 3.3c3.2 0 5.6 2.5 6.6 4.7-1 2.2-3.4 4.7-6.6 4.7S2.4 10.2 1.4 8C2.4 5.8 4.8 3.3 8 3.3Z" />
      <circle cx="8" cy="8" r="2.1" fill="var(--glyph-cut)" />
    </>
  ),
  flame: (
    <path d="M8.3 1.3c.4 2.3 3.9 3.9 3.9 7.7A4.2 4.2 0 0 1 8 13.9a4.2 4.2 0 0 1-4.2-4.3c0-1.9 1-3 1.9-3.8 0 1.2.5 2 1.4 2.4-.4-2.7.4-5 1.2-6.9Z" />
  ),
  leaf: (
    <path d="M13.8 2.2C6.6 2 2.6 5.2 2.8 10.4c0 .9.2 1.7.5 2.4L2 14.1l.9.9 1.3-1.3c.7.3 1.5.5 2.4.5 5.2.2 7.4-4.3 7.2-12Z" />
  ),
  drop: <path d="M8 1.4c2.3 3 4.6 5.6 4.6 8.2A4.6 4.6 0 0 1 8 14.3a4.6 4.6 0 0 1-4.6-4.7C3.4 7 5.7 4.4 8 1.4Z" />,
  star: (
    <path d="m8 1.5 1.95 4.1 4.45.55-3.25 3.1.85 4.45L8 11.55 4 13.7l.85-4.45L1.6 6.15l4.45-.55L8 1.5Z" />
  ),
  heart: (
    <path d="M8 14 2.3 8.6A3.4 3.4 0 0 1 8 4.1a3.4 3.4 0 0 1 5.7 4.5L8 14Z" />
  ),
  crown: (
    <path d="m1.8 4.6 3.3 3 2.9-4.5 2.9 4.5 3.3-3-1 7.6H2.8l-1-7.6ZM2.9 13h10.2v1.4H2.9V13Z" />
  ),
  wave: (
    <path
      d="M1.6 6.2c1.6-1.6 3.2-1.6 4.8 0s3.2 1.6 4.8 0 2.4-1 3.2-.4M1.6 10.6c1.6-1.6 3.2-1.6 4.8 0s3.2 1.6 4.8 0 2.4-1 3.2-.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  ),
  ghost: (
    <>
      <path d="M8 1.6a5 5 0 0 1 5 5v7.6l-1.7-1.3-1.6 1.3L8 12.9l-1.7 1.3-1.6-1.3L3 14.2V6.6a5 5 0 0 1 5-5Z" />
      <circle cx="6.2" cy="6.9" r="1" fill="var(--glyph-cut)" />
      <circle cx="9.8" cy="6.9" r="1" fill="var(--glyph-cut)" />
    </>
  ),
  diamond: <path d="M8 1.4 14.3 8 8 14.6 1.7 8 8 1.4Z" />,
  orbit: (
    <>
      <circle cx="8" cy="8" r="2.7" />
      <ellipse
        cx="8"
        cy="8"
        rx="6.3"
        ry="2.3"
        transform="rotate(-28 8 8)"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </>
  ),
  mask: (
    <>
      <path d="M2.4 3.2c3.7 1.3 7.5 1.3 11.2 0v4.4c0 3.3-2.5 6-5.6 6s-5.6-2.7-5.6-6V3.2Z" />
      <ellipse cx="5.8" cy="6.9" rx="1.25" ry=".85" fill="var(--glyph-cut)" />
      <ellipse cx="10.2" cy="6.9" rx="1.25" ry=".85" fill="var(--glyph-cut)" />
      <path
        d="M5.9 9.9c1.3 1 2.9 1 4.2 0"
        fill="none"
        stroke="var(--glyph-cut)"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </>
  ),
  feather: (
    <>
      <path d="M13.8 2.2C8.4 2.3 4.6 5.8 4.2 11.2l-1.8 2.2.8.7 1.8-2.2c5.5-.1 8.7-3.8 8.8-9.7Z" />
      <path
        d="M11.9 4.2 5.4 10.9"
        fill="none"
        stroke="var(--glyph-cut)"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </>
  ),
  note: (
    <>
      <path
        d="M5.7 11.3V4.2l7.4-1.9v7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <ellipse cx="4" cy="11.6" rx="2.1" ry="1.8" />
      <ellipse cx="11.4" cy="10.1" rx="2.1" ry="1.8" />
    </>
  ),
  cloud: (
    <path d="M4.5 12.8a3.2 3.2 0 0 1-.4-6.4 4.3 4.3 0 0 1 8.3-.9 3.3 3.3 0 0 1-.3 7.3H4.5Z" />
  ),
  flower: (
    <>
      <circle cx="8" cy="4.6" r="2.5" />
      <circle cx="11.2" cy="6.9" r="2.5" />
      <circle cx="10" cy="10.7" r="2.5" />
      <circle cx="6" cy="10.7" r="2.5" />
      <circle cx="4.8" cy="6.9" r="2.5" />
      <circle cx="8" cy="8" r="1.5" fill="var(--glyph-cut)" />
    </>
  ),
  cube: (
    <>
      <path d="M8 1.7 13.5 4.8v6.4L8 14.3l-5.5-3.1V4.8L8 1.7Z" />
      <path
        d="M2.9 5.1 8 8l5.1-2.9M8 8v5.8"
        fill="none"
        stroke="var(--glyph-cut)"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </>
  ),
  comet: (
    <>
      <circle cx="10.4" cy="5.6" r="3" />
      <path
        d="M8 8 2.2 13.8M6.4 5.6 3.2 8.8M10.4 9.6l-3.2 3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity=".55"
      />
    </>
  ),
};

export const GLYPH_IDS = Object.keys(GLYPHS);

export type AvatarKind =
  | { type: "initials"; text: string }
  | { type: "glyph"; id: string }
  | { type: "text"; text: string };

export function parseIcon(icon: string | undefined, name: string): AvatarKind {
  const raw = (icon || "").trim();
  if (raw.startsWith("g:") && GLYPHS[raw.slice(2)]) {
    return { type: "glyph", id: raw.slice(2) };
  }
  if (raw && !raw.startsWith("g:")) {
    return { type: "text", text: [...raw].slice(0, 2).join("") };
  }
  return { type: "initials", text: agentInitials(name) };
}

interface Props {
  name: string;
  icon?: string;
  color: string;
  /** "solid" = filled chip, "tint" = outlined (transcript). */
  variant?: "solid" | "tint";
  className?: string;
}

function VoiceAvatar({ name, icon, color, variant = "solid", className }: Props) {
  const kind = parseIcon(icon, name);
  const ink = inkOn(color);
  return (
    <span
      className={["voice-avatar", `is-${variant}`, `kind-${kind.type}`, className]
        .filter(Boolean)
        .join(" ")}
      style={{
        ["--voice" as string]: color,
        ["--voice-ink" as string]: ink,
        ["--glyph-cut" as string]: variant === "solid" ? color : "#0f0f0f",
      }}
      aria-hidden
    >
      {kind.type === "glyph" ? (
        <svg viewBox="0 0 16 16" fill="currentColor">
          {GLYPHS[kind.id]}
        </svg>
      ) : (
        kind.text
      )}
    </span>
  );
}

export default memo(VoiceAvatar);
