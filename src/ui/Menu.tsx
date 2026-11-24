import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

export interface MenuItem {
  label: string;
  /** Right-aligned, e.g. a shortcut. */
  hint?: string;
  /** A second, muted line, e.g. a File's path. */
  detail?: string;
  disabled?: boolean;
  /** Why it is disabled, shown muted under the label. */
  reason?: string;
  checked?: boolean;
  /** A small mark at the row's end, e.g. a status dot. */
  trailing?: ReactNode;
  /** A thin rule above this item. */
  separated?: boolean;
  onSelect?(): void;
  /** Opens to the side; `submenuEmpty` shows when the list is empty. */
  submenu?: MenuItem[];
  submenuEmpty?: string;
}

export interface MenuProps {
  /** The accessible name. */
  label: string;
  /** A small muted heading, as in the encoding menu. */
  heading?: string;
  /** Viewport point the menu hangs from. */
  x: number;
  y: number;
  /** "above" puts the menu's bottom at `y`; "end" puts its right edge at `x`. */
  side?: "below" | "above";
  align?: "start" | "end";
  items: MenuItem[];
  /** `chose` is true when an item was picked (its action runs right after). */
  onDismiss(chose?: boolean): void;
  /** Mousedowns inside these elements don't dismiss (the toggle button). */
  ignoreSelector?: string;
}

/** The menu's panel and its rows, for lists that look like a Menu. */
export const MENU_PANEL =
  "z-fade-in min-w-48 max-w-[360px] select-none rounded-float bg-surface p-1.5 text-ui text-text shadow-float outline-none";
export const menuRow = (
  active: boolean,
  disabled = false,
  align: "start" | "center" = "start",
) =>
  "flex cursor-default gap-3 rounded-[6px] px-2.5 py-[6px] " +
  (align === "center" ? "items-center " : "items-start ") +
  (disabled ? "text-faint" : active ? "bg-row-sel text-text" : "");

/** Zukai's floating menu in the Paper style (spec section 6). */
export function Menu({
  label,
  heading,
  x,
  y,
  side = "below",
  align = "start",
  items,
  onDismiss,
  ignoreSelector,
}: MenuProps) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      if (root.current?.contains(t)) return;
      if (ignoreSelector && t.closest?.(ignoreSelector)) return;
      onDismiss(false);
    };
    const onBlur = () => onDismiss(false);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [ignoreSelector, onDismiss]);

  const style: CSSProperties = {
    position: "fixed",
    ...(side === "above" ? { bottom: window.innerHeight - y } : { top: y }),
    ...(align === "end" ? { right: window.innerWidth - x } : { left: x }),
  };

  return (
    <div ref={root} style={style} className="z-40">
      <MenuList
        label={label}
        heading={heading}
        items={items}
        onDone={() => onDismiss(true)}
        onBack={() => onDismiss(false)}
      />
    </div>
  );
}

function MenuList({
  label,
  heading,
  items,
  empty,
  onDone,
  onBack,
  sub = false,
}: {
  label: string;
  heading?: string;
  items: MenuItem[];
  empty?: string;
  /** An item was chosen: close everything. */
  onDone(): void;
  /** Esc / ArrowLeft: close this level. */
  onBack(): void;
  sub?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState<number | null>(null);
  const [shift, setShift] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    // Keep the menu on screen.
    const r = node.getBoundingClientRect();
    const dx =
      r.right > window.innerWidth - 8
        ? sub
          ? -(r.width + (node.parentElement?.offsetWidth ?? 0))
          : window.innerWidth - 8 - r.right
        : 0;
    const dy =
      r.bottom > window.innerHeight - 8 ? window.innerHeight - 8 - r.bottom : 0;
    if (dx !== 0 || dy !== 0) setShift({ x: dx, y: dy });
  }, [sub]);

  const usable = (i: number) => !!items[i] && !items[i].disabled;

  const step = (from: number, dir: 1 | -1) => {
    const n = items.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + dir * k) % n) + n) % n;
      if (usable(i)) return i;
    }
    return from;
  };

  const choose = (i: number) => {
    const item = items[i];
    if (!item || item.disabled) return;
    if (item.submenu) {
      setOpen(open === i ? null : i);
      return;
    }
    onDone();
    item.onSelect?.();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") setActive(step(active, 1));
    else if (e.key === "ArrowUp") setActive(step(active < 0 ? 0 : active, -1));
    else if (e.key === "Enter" || e.key === " ") {
      if (active >= 0) choose(active);
    } else if (e.key === "ArrowRight") {
      if (active >= 0 && items[active]?.submenu && usable(active)) {
        setOpen(active);
      }
    } else if (e.key === "Escape" || (sub && e.key === "ArrowLeft")) {
      onBack();
    } else if (e.key === "Tab") {
      onDone();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={el}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={
        shift.x || shift.y
          ? { transform: `translate(${shift.x}px, ${shift.y}px)` }
          : undefined
      }
      className={
        MENU_PANEL +
        " " +
        (sub
          ? "absolute top-[-4px] left-full ml-1 max-h-[70vh] overflow-y-auto"
          : "")
      }
    >
      {heading && (
        <div className="px-2.5 pt-1.5 pb-1 text-ui-xs font-semibold tracking-[0.04em] text-faint">
          {heading}
        </div>
      )}
      {items.map((item, i) => (
        <div key={`${i}:${item.label}`} className="relative">
          {item.separated && (
            <div className="-mx-1.5 my-1.5 h-px bg-hairline" />
          )}
          <div
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            aria-haspopup={item.submenu ? "menu" : undefined}
            aria-expanded={item.submenu ? open === i : undefined}
            onMouseEnter={() => {
              setActive(i);
              if (item.submenu && !item.disabled) setOpen(i);
              else setOpen(null);
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(i)}
            className={menuRow(i === active, item.disabled)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.label}</span>
              {item.detail && (
                <span className="block truncate text-ui-sm text-faint">
                  {item.detail}
                </span>
              )}
              {item.disabled && item.reason && (
                <span className="block text-ui-sm text-faint">
                  {item.reason}
                </span>
              )}
            </span>
            {item.checked && (
              <span className="self-center text-accent" aria-hidden>
                <Check size={15} strokeWidth={2} />
              </span>
            )}
            {item.trailing && (
              <span className="flex shrink-0 self-center">{item.trailing}</span>
            )}
            {item.hint && (
              <span className="shrink-0 text-ui-sm text-faint">
                {item.hint}
              </span>
            )}
            {item.submenu && (
              <span className="self-center text-faint" aria-hidden>
                <ChevronRight size={15} strokeWidth={1.8} />
              </span>
            )}
          </div>
          {item.submenu && open === i && (
            <MenuList
              sub
              label={item.label}
              items={item.submenu}
              empty={item.submenuEmpty}
              onDone={onDone}
              onBack={() => {
                setOpen(null);
                el.current?.focus({ preventScroll: true });
              }}
            />
          )}
        </div>
      ))}
      {items.length === 0 && empty && (
        <div className="px-2.5 py-[6px] text-faint">{empty}</div>
      )}
    </div>
  );
}
