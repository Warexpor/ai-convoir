import { useFocusTrap } from "../hooks/useFocusTrap";
import { useRef } from "react";

const ROWS: { keys: string; action: string }[] = [
  { keys: "Space", action: "Start / pause (auto) or next (step mode)" },
  { keys: "N", action: "Advance one agent turn" },
  { keys: "S", action: "Toggle settings" },
  { keys: "B", action: "Toggle chats sidebar" },
  { keys: "?", action: "This help" },
  { keys: "Esc", action: "Stop run → close help → close settings → hide chats" },
  { keys: "Ctrl+Shift+R", action: "New chat" },
  { keys: "Ctrl+E", action: "Export transcript" },
  { keys: "Ctrl+S", action: "Save chat" },
  { keys: "Ctrl+= / Ctrl+-", action: "Zoom in / out" },
  { keys: "Ctrl+0", action: "Reset zoom" },
  { keys: "⌘/Ctrl+Enter", action: "Begin from first-message box" },
];

export default function ShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, cardRef);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={cardRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span id="shortcuts-title">Keyboard shortcuts</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="modal-body">
          {ROWS.map((r) => (
            <div key={r.keys} className="shortcut-row">
              <kbd className="kbd">{r.keys}</kbd>
              <span>{r.action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
