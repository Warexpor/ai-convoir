import { useEffect, useState, type ReactNode } from "react";

/**
 * Height-animated disclosure. Children mount on first open and stay
 * mounted so closing can play out; while closed they're inert.
 */
export default function Collapse({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return (
    <div
      className={`collapse${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
      inert={!open}
      aria-hidden={!open}
    >
      <div className="collapse-inner">{mounted && children}</div>
    </div>
  );
}
