import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconExport, IconKey, IconMoreVert, IconNew, IconSave, IconSliders } from "./Marks";
import { useBackClose } from "../hooks/useBackClose";
import { usePresence } from "../hooks/usePresence";

interface Props {
  needsKey: boolean;
  hasMessages: boolean;
  onSettings: () => void;
  onNew: () => void;
  onSave: () => void;
  onExport: () => void;
}

/** Phone top bar overflow: everything that isn't the conversation itself. */
export default function PhoneOverflow({
  needsKey,
  hasMessages,
  onSettings,
  onNew,
  onSave,
  onExport,
}: Props) {
  const [open, setOpen] = useState(false);
  const shown = usePresence(open, 160);
  const ref = useRef<HTMLDivElement>(null);
  useBackClose(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);

  const item = (label: string, icon: ReactNode, run: () => void, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      disabled={disabled}
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="overflow" ref={ref}>
      <button
        type="button"
        className={`btn btn-icon btn-bare${needsKey ? " needs-key" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        onClick={() => setOpen((o) => !o)}
      >
        <IconMoreVert />
      </button>
      {shown && (
        <div className={`menu overflow-menu${open ? "" : " is-leaving"}`} role="menu">
          {item("New thread", <IconNew />, onNew)}
          {item("Save thread", <IconSave />, onSave, !hasMessages)}
          {item("Share / export", <IconExport />, onExport, !hasMessages)}
          <div className="menu-sep" role="separator" />
          {needsKey
            ? item("Add your key", <IconKey />, onSettings)
            : item("Settings", <IconSliders />, onSettings)}
        </div>
      )}
    </div>
  );
}
