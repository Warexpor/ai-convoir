import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useBackClose } from "../hooks/useBackClose";
import { usePresence } from "../hooks/usePresence";

export interface SheetAction {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  run: () => void;
}

interface Props {
  open: boolean;
  title?: ReactNode;
  actions: SheetAction[];
  onClose: () => void;
}

/** Android-style bottom sheet for long-press actions. */
export default function ActionSheet({ open, title, actions, onClose }: Props) {
  const shown = usePresence(open, 240);
  useBackClose(open, onClose);
  if (!shown) return null;
  return createPortal(
    <div
      className={`sheet-scrim${open ? "" : " is-leaving"}`}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="action-sheet"
        role="menu"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="sheet-grip" aria-hidden />
        {title && <div className="sheet-title">{title}</div>}
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            role="menuitem"
            className={`sheet-item${a.danger ? " is-danger" : ""}`}
            onClick={() => {
              onClose();
              a.run();
            }}
          >
            {a.icon}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
