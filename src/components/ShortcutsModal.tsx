import { useFocusTrap } from "../hooks/useFocusTrap";
import { usePresence } from "../hooks/usePresence";
import { useRef } from "react";

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Space", action: "Start / pause, or next turn in Step" },
  { keys: "N", action: "Next voice speaks" },
  { keys: "S", action: "Voices" },
  { keys: ",", action: "Settings" },
  { keys: "B", action: "History panel" },
  { keys: "?", action: "This help" },
  { keys: "Esc", action: "Stop run → close panels → hide history" },
  { keys: "Ctrl+Shift+R", action: "New chat" },
  { keys: "Ctrl+E", action: "Export transcript" },
  { keys: "Ctrl+S", action: "Save chat" },
  { keys: "Ctrl+= / Ctrl+-", action: "Zoom in / out" },
  { keys: "Ctrl+0", action: "Reset zoom" },
  { keys: "Enter", action: "Begin, or hand the turn on with your whisper" },
  { keys: "Shift+Enter", action: "New line in the composer" },
];

export default function ShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const shown = usePresence(open, 200);
  useFocusTrap(open, cardRef);

  if (!shown) return null;
  return (
    <div className={`scrim${open ? "" : " is-leaving"}`} onClick={onClose} role="presentation">
      <div
        ref={cardRef}
        className="sheet sheet-sm glass-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button type="button" className="pill" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="sheet-body">
          <div className="card">
            {SHORTCUTS.map((r) => (
              <div key={r.keys} className="set-row">
                <span className="set-row-title">{r.action}</span>
                <kbd className="kbd">{r.keys}</kbd>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
