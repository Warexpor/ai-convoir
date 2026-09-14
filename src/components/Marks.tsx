/** In-app mark + chrome icons. The mark is the README PNG, not a reconstructed path. */

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

export function IconChats() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="1.75"
        y="2.5"
        width="12.5"
        height="4"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <rect
        x="1.75"
        y="9.5"
        width="8.5"
        height="4"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

export function IconSliders() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 4.5h12M2 11.5h12"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="6" cy="4.5" r="1.7" fill="currentColor" />
      <circle cx="10.5" cy="11.5" r="1.7" fill="currentColor" />
    </svg>
  );
}

export function IconHelp() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.1" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M6.35 6.2a1.7 1.7 0 0 1 3.32.7c0 1.1-1.66 1.25-1.66 2.35"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="8.05" cy="11.35" r=".85" fill="currentColor" />
    </svg>
  );
}

export function IconArrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M2 6h7.2M6.4 3.2 9.6 6 6.4 8.8"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconStop() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.6" fill="currentColor" />
    </svg>
  );
}
