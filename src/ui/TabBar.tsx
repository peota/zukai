import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent,
  WheelEvent,
} from "react";
import { baseName, stemOf } from "../files/paths";
import { Icon } from "./icons";

export interface TabBarItem {
  id: string;
  title: string;
  active: boolean;
  /** Present for a File Tab. */
  file?: { missing: boolean; path: string };
  /** Can't be renamed (its unsaved text can't be read yet). */
  locked?: boolean;
  /** Parent folder, shown when another open File has the same name. */
  folder?: string;
  /** Kept at the start; a pin (which unpins) replaces the close button. */
  pinned?: boolean;
}

export interface TabBarProps {
  tabs: TabBarItem[];
  onActivate(id: string): void;
  onClose(id: string): void;
  onNew(): void;
  onMove(id: string, toIndex: number): void;
  /**
   * A Scratchpad gets its new Title; a File gets its new stem and may
   * resolve to an error message, shown inline.
   */
  onRename(id: string, name: string): void | Promise<string | null>;
  /** Right-click on a Tab, or (id null) on the empty bar. */
  onContextMenu(id: string | null, x: number, y: number): void;
  /** The pin on a pinned Tab was clicked. */
  onUnpin(id: string): void;
}

/** Pointer travel (px) before a press becomes a drag; less is a click. */
const DRAG_THRESHOLD = 4;
/** The bar's gap between Tabs (gap-1). */
const GAP = 4;

interface Drag {
  id: string;
  pointerId: number;
  startX: number;
  from: number;
  /** Tab centres and the dragged Tab's width, measured at the press. */
  centers: number[];
  width: number;
  dx: number;
  moving: boolean;
}

/** The index among the other Tabs where the dragged one lands. */
function dropIndex(d: Drag): number {
  const center = d.centers[d.from] + d.dx;
  return d.centers.filter((c, j) => j !== d.from && c < center).length;
}

export function TabBar({
  tabs,
  onActivate,
  onClose,
  onNew,
  onMove,
  onRename,
  onContextMenu,
  onUnpin,
}: TabBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const activeId = tabs.find((t) => t.active)?.id;
  // The press in progress (ref, for the handlers) and its view (state).
  const drag = useRef<Drag | null>(null);
  const [dragView, setDragView] = useState<Drag | null>(null);
  const swallowClick = useRef(false);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeId]);

  const dragging = dragView?.moving ?? false;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = null;
      setDragView(null);
      // The release that follows still clicks: don't activate on it.
      swallowClick.current = true;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragging]);

  // A press released outside any Tab (no capture yet) must not linger and
  // turn a later hover into a drag: the window sees every release.
  const unlisten = useRef<(() => void) | null>(null);
  useEffect(() => () => unlisten.current?.(), []);
  const watchRelease = (pointerId: number) => {
    unlisten.current?.();
    const onRelease = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      unlisten.current?.();
      const d = drag.current;
      if (!d || d.pointerId !== pointerId) return;
      drag.current = null;
      setDragView(null);
      if (d.moving) swallowClick.current = true;
    };
    window.addEventListener("pointerup", onRelease);
    window.addEventListener("pointercancel", onRelease);
    unlisten.current = () => {
      window.removeEventListener("pointerup", onRelease);
      window.removeEventListener("pointercancel", onRelease);
      unlisten.current = null;
    };
  };

  // The bar only scrolls horizontally; map the vertical wheel onto it.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0 && Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
      e.currentTarget.scrollLeft += e.deltaY;
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>, index: number) => {
    swallowClick.current = false;
    if (e.button !== 0 || editing === tabs[index].id) return;
    if ((e.target as Element).closest("button, input")) return;
    const els = barRef.current?.querySelectorAll<HTMLElement>("[role=tab]");
    if (!els) return;
    const rects = [...els].map((el) => el.getBoundingClientRect());
    drag.current = {
      id: tabs[index].id,
      pointerId: e.pointerId,
      startX: e.clientX,
      from: index,
      centers: rects.map((r) => r.left + r.width / 2),
      width: rects[index]?.width ?? 0,
      dx: 0,
      moving: false,
    };
    watchRelease(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if ((e.buttons & 1) === 0) {
      // The button is up (its release was missed): no press to drag.
      drag.current = null;
      setDragView(null);
      return;
    }
    const dx = e.clientX - d.startX;
    if (!d.moving && Math.abs(dx) < DRAG_THRESHOLD) return;
    if (!d.moving) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // No capture (e.g. the pointer is gone): the drag still works.
      }
    }
    const next = { ...d, dx, moving: true };
    drag.current = next;
    setDragView(next);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>, drop: boolean) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragView(null);
    if (!d.moving) return;
    swallowClick.current = true;
    if (!drop) return;
    const to = dropIndex(d);
    if (to !== d.from) onMove(d.id, to);
  };

  /** How far a non-dragged Tab shifts to open the drop slot. */
  const shiftOf = (index: number): number => {
    if (!dragView?.moving) return 0;
    if (index === dragView.from) return dragView.dx;
    const to = dropIndex(dragView);
    const step = dragView.width + GAP;
    if (dragView.from < index && index <= to) return -step;
    if (to <= index && index < dragView.from) return step;
    return 0;
  };

  const openMenu = (e: ReactMouseEvent, id: string | null) => {
    if ((e.target as Element).closest("input")) return; // native menu
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(id, e.clientX, e.clientY);
  };

  return (
    <div
      ref={barRef}
      role="tablist"
      className="z-no-scrollbar flex h-9 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden bg-chrome px-2"
      onWheel={onWheel}
      onContextMenu={(e) => openMenu(e, null)}
    >
      {tabs.map((tab, index) => {
        const shift = shiftOf(index);
        const lifted = dragView?.moving && dragView.from === index;
        return (
          <div
            key={tab.id}
            ref={tab.active ? activeRef : undefined}
            role="tab"
            aria-selected={tab.active}
            title={tab.file ? tab.file.path : tab.title}
            onClick={() => {
              if (swallowClick.current) {
                swallowClick.current = false;
                return;
              }
              onActivate(tab.id);
            }}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault(); // no autoscroll
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab.id);
              }
            }}
            onDoubleClick={() => {
              if (!tab.locked) setEditing(tab.id);
            }}
            onContextMenu={(e) => openMenu(e, tab.id)}
            onPointerDown={(e) => onPointerDown(e, index)}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endDrag(e, true)}
            onPointerCancel={(e) => endDrag(e, false)}
            style={
              shift !== 0 ? { transform: `translateX(${shift}px)` } : undefined
            }
            className={
              "group flex h-7 min-w-[120px] max-w-[200px] flex-[0_1_200px] cursor-default select-none items-center gap-1 rounded-tab pl-2.5 pr-1 " +
              (lifted ? "relative z-10 shadow-float " : "") +
              (tab.active
                ? "bg-surface text-text shadow-float"
                : "text-muted hover:text-text")
            }
          >
            {editing === tab.id ? (
              <RenameInput
                tab={tab}
                onSubmit={(name) => onRename(tab.id, name)}
                onClose={() => setEditing(null)}
              />
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate">
                  <span
                    className={
                      tab.file?.missing ? "line-through decoration-faint" : ""
                    }
                  >
                    {tab.title}
                  </span>
                  {tab.folder && (
                    <span className="text-faint">{` · ${tab.folder}`}</span>
                  )}
                </span>
                {tab.file && (
                  <span className="shrink-0 rounded-[4px] border border-hairline px-1 text-[10px] leading-[14px] text-faint">
                    FILE
                  </span>
                )}
              </>
            )}
            {tab.pinned ? (
              <button
                type="button"
                aria-label={`Unpin ${tab.title}`}
                title="Unpin"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  onUnpin(tab.id);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                className="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-faint hover:bg-chrome hover:text-text"
              >
                <Icon name="pin" size={12} />
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                className={
                  "flex size-5 shrink-0 items-center justify-center rounded-[4px] text-faint hover:bg-chrome hover:text-text " +
                  (tab.active ? "" : "invisible group-hover:visible")
                }
              >
                <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
                  <path
                    d="M1 1l6 6M7 1L1 7"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New Tab"
        title="New Tab"
        tabIndex={-1}
        onClick={onNew}
        className="flex size-7 shrink-0 items-center justify-center rounded-tab text-muted hover:bg-surface hover:text-text"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M5 1v8M1 5h8"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

/**
 * The inline rename field. A File edits only its stem, with the extension
 * shown fixed after it; a refused rename keeps the field open with the
 * reason under it (on Enter), Esc cancels.
 */
function RenameInput({
  tab,
  onSubmit,
  onClose,
}: {
  tab: TabBarItem;
  onSubmit(name: string): void | Promise<string | null>;
  onClose(): void;
}) {
  const [split] = useState(() => {
    if (!tab.file) return { stem: tab.title, ext: "" };
    const name = baseName(tab.file.path);
    const stem = stemOf(name, tab.file.path);
    return { stem, ext: name.slice(stem.length) };
  });
  const [value, setValue] = useState(split.stem);
  const [error, setError] = useState<{
    text: string;
    left: number;
    top: number;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const done = useRef(false);

  const close = () => {
    if (done.current) return;
    done.current = true;
    onClose();
  };

  const submit = async (keepOpenOnError: boolean) => {
    if (busy.current || done.current) return;
    // A File whose name didn't change: nothing to do on disk.
    if (tab.file && value.trim() === split.stem) return close();
    const pending = onSubmit(value);
    if (!pending) return close(); // a Scratchpad's Title: nothing to wait for
    busy.current = true;
    const result = await pending;
    busy.current = false;
    if (!result || !keepOpenOnError) return close();
    const r = input.current?.getBoundingClientRect();
    setError({ text: result, left: r?.left ?? 0, top: (r?.bottom ?? 0) + 6 });
    input.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation(); // keep app shortcuts out of the field
    if (e.key === "Enter") void submit(true);
    else if (e.key === "Escape") close();
  };

  return (
    <>
      <input
        ref={input}
        autoFocus
        value={value}
        aria-invalid={error !== null}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={onKeyDown}
        // Leaving the field submits; a refusal then shows as a notice.
        onBlur={() => void submit(false)}
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="min-w-0 flex-1 bg-transparent text-text outline-none"
        spellCheck={false}
      />
      {split.ext && <span className="shrink-0 text-faint">{split.ext}</span>}
      {error && (
        <div
          role="alert"
          style={{ position: "fixed", left: error.left, top: error.top }}
          className="z-fade-in z-30 max-w-[280px] rounded-float bg-surface px-2 py-1 text-[11.5px] text-danger shadow-float"
        >
          {error.text}
        </div>
      )}
    </>
  );
}
