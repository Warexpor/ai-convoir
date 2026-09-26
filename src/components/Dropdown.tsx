import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useBackClose } from "../hooks/useBackClose";
import { usePresence } from "../hooks/usePresence";
import { PHONE_QUERY, useMedia } from "../hooks/useMedia";
import { IconCheck, IconChevronDown, IconSearch } from "./Marks";

export interface DropOption<T> {
  value: T;
  label: ReactNode;
  /** Quiet text on the right of the row. */
  hint?: ReactNode;
  /** Text matched by search; defaults to the value. */
  text?: string;
}

interface Props<T> {
  value: T;
  options: DropOption<T>[];
  onChange: (v: T) => void;
  /** Accessible name for the control. */
  label: string;
  id?: string;
  placeholder?: string;
  /** Adds a filter field at the top of the list. */
  search?: boolean;
  searchPlaceholder?: string;
  /** With search: offer the typed text as a value when nothing matches it exactly. */
  allowCustom?: boolean;
  /** Shown when search leaves nothing. */
  emptyText?: string;
  className?: string;
  size?: "sm";
}

/** Where the popover is drawn, in the host's own (possibly zoomed) px. */
interface Place {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
  up: boolean;
}

function host(): HTMLElement {
  return document.querySelector<HTMLElement>(".app") ?? document.body;
}

/**
 * Custom select. The list is portaled into the app root so scroll panes
 * don't clip it, drawn as a floating glass menu on desktop and as a bottom
 * sheet on phones. Focus stays on the trigger (or the search field); the
 * highlighted row is announced via aria-activedescendant.
 */
export default function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  label,
  id,
  placeholder = "Choose…",
  search = false,
  searchPlaceholder = "Search…",
  allowCustom = false,
  emptyText = "Nothing matches",
  className,
  size,
}: Props<T>) {
  const isPhone = useMedia(PHONE_QUERY);
  const [open, setOpen] = useState(false);
  const shown = usePresence(open, 180);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);
  useBackClose(open, () => close());

  const q = query.trim().toLowerCase();
  type Row = DropOption<T> & { custom?: boolean };
  const rows = useMemo((): Row[] => {
    const list = q
      ? options.filter((o) =>
          (o.text ?? String(o.value)).toLowerCase().includes(q),
        )
      : options;
    const exact = options.some(
      (o) => String(o.value).toLowerCase() === q,
    );
    if (allowCustom && q && !exact) {
      return [
        ...list,
        {
          value: query.trim() as T,
          label: (
            <>
              Use <em>{query.trim()}</em>
            </>
          ),
          custom: true,
        },
      ];
    }
    return list;
  }, [options, q, query, allowCustom]);

  const selected = options.find((o) => o.value === value);

  const openList = () => {
    setQuery("");
    const i = options.findIndex((o) => o.value === value);
    setActive(i < 0 ? 0 : i);
    setOpen(true);
  };

  const pick = (v: T) => {
    onChange(v);
    close();
  };

  // Anchor under (or over) the trigger; keep it attached while panes scroll.
  useLayoutEffect(() => {
    if (!open || isPhone) return;
    const measure = () => {
      const t = triggerRef.current;
      if (!t) return;
      const z = parseFloat(getComputedStyle(host()).zoom || "1") || 1;
      const r = t.getBoundingClientRect();
      const vh = window.innerHeight;
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 220 && above > below;
      const room = Math.min(340, (up ? above : below) - 6);
      const width = Math.max(r.width, 200);
      const left = Math.min(r.left, window.innerWidth - width - 8);
      setPlace({
        left: left / z,
        width: width / z,
        maxHeight: Math.max(140, room) / z,
        up,
        ...(up
          ? { bottom: (vh - r.top + 6) / z }
          : { top: (r.bottom + 6) / z }),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, isPhone]);

  // Outside press closes (without stealing focus back).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (popRef.current?.contains(n) || triggerRef.current?.contains(n)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, close]);

  // The popover mounts only once it has been placed, so wait for that.
  const placed = place !== null;
  useEffect(() => {
    if (open && placed && search && !isPhone) searchRef.current?.focus({ preventScroll: true });
  }, [open, placed, search, isPhone]);

  // Keep the highlighted row in view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open, shown]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  const onKey = (e: ReactKeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home" && !search) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && !search) {
      e.preventDefault();
      setActive(rows.length - 1);
    } else if (e.key === "Enter" || (e.key === " " && !search)) {
      e.preventDefault();
      const row = rows[active];
      if (row) pick(row.value);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const optionId = (i: number) => `${uid}-o${i}`;

  const list = (
    <div
      ref={listRef}
      className="dd-list"
      role="listbox"
      id={listId}
      aria-label={label}
    >
      {rows.length === 0 && <div className="dd-empty">{emptyText}</div>}
      {rows.map((o, i) => {
        const on = o.value === value && !(o.custom);
        return (
          <div
            key={`${o.custom ? "custom:" : ""}${String(o.value)}`}
            id={optionId(i)}
            data-i={i}
            role="option"
            aria-selected={on}
            className={[
              "dd-opt",
              on ? "is-on" : "",
              i === active ? "is-active" : "",
              o.custom ? "is-custom" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onPointerMove={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(o.value)}
          >
            <span className="dd-opt-label">{o.label}</span>
            {o.hint && <span className="dd-opt-hint">{o.hint}</span>}
            <span className="dd-check" aria-hidden>
              {on && <IconCheck />}
            </span>
          </div>
        );
      })}
    </div>
  );

  const searchBox = search && (
    <label className="dd-search">
      <IconSearch />
      <input
        ref={searchRef}
        value={query}
        placeholder={searchPlaceholder}
        spellCheck={false}
        autoComplete="off"
        aria-label={`Search ${label}`}
        aria-controls={listId}
        aria-activedescendant={rows[active] ? optionId(active) : undefined}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKey}
      />
    </label>
  );

  let popover: ReactNode = null;
  if (shown) {
    popover = isPhone
      ? createPortal(
          <div
            className={`sheet-scrim dd-scrim${open ? "" : " is-leaving"}`}
            onClick={() => close(false)}
            role="presentation"
          >
            <div
              ref={popRef}
              className="action-sheet dd-sheet"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sheet-grip" aria-hidden />
              <div className="sheet-title">{label}</div>
              {searchBox}
              {list}
            </div>
          </div>,
          document.body,
        )
      : place &&
        createPortal(
          <div
            ref={popRef}
            className={`dd-pop${place.up ? " is-up" : ""}${open ? "" : " is-leaving"}`}
            style={{
              left: place.left,
              top: place.top,
              bottom: place.bottom,
              width: place.width,
              maxHeight: place.maxHeight,
            }}
          >
            {searchBox}
            {list}
          </div>,
          host(),
        );
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={[
          "dd-trigger",
          size === "sm" ? "dd-sm" : "",
          open ? "is-open" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        aria-activedescendant={
          open && !search && rows[active] ? optionId(active) : undefined
        }
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKey}
      >
        <span className={`dd-value${selected || value ? "" : " is-placeholder"}`}>
          {selected ? selected.label : value ? String(value) : placeholder}
        </span>
        <IconChevronDown />
      </button>
      {popover}
    </>
  );
}
