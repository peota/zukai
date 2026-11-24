import { Fragment, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent,
  WheelEvent,
} from "react";
import { baseName, stemOf } from "../files/paths";
import type { Kind } from "../model/kinds";
import { CloseIcon, fileIcon, Icon, PlusIcon, type IconName } from "./icons";
import { Menu } from "./Menu";

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
  /**
   * A Scratchpad's or diff Tab's Kind picks its icon (a File's comes from
   * its name).
   */
  kind?: Kind;
  /** A File with changes not yet written to disk: shows a dot. */
  unsaved?: boolean;
}

/** The quiet mark of an unsaved Tab. */
function UnsavedDot({ className = "" }: { className?: string }) {
  return (
    <span
      data-testid="unsaved-dot"
      aria-hidden="true"
      className={"size-2 shrink-0 rounded-full bg-muted " + className}
    />
  );
}

/** A File's icon follows its name; a Scratchpad's (or diff's) its Kind. */
function iconFor(tab: TabBarItem): IconName {
  if (tab.file) return fileIcon(tab.file.path);
  if (tab.kind === "diff") return "gitCompare";
  return tab.kind === "canvas" ? "canvas" : "scratchpad";
}

/** A Tab's tooltip: a File's path, what a diff shows, a Scratchpad's Title. */
function tooltipOf(tab: TabBarItem): string {
  if (tab.file) return tab.file.path;
  if (tab.kind === "diff") return "Changes since last commit";
  return tab.title;
}

export interface TabBarProps {
  /** Left room in px kept clear for the macOS traffic lights. */
  inset?: number;
  tabs: TabBarItem[];
  onActivate(id: string): void;
  onClose(id: string): void;
  onNew(): void;
  /** A new Canvas Scratchpad, from the menu beside +. */
  onNewCanvas(): void;
  /** Shortcuts shown in that menu, e.g. "Ctrl+N" and "Ctrl+Shift+N". */
  newHints?: { text: string; canvas: string };
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
  /** Joined Tabs (each pair adjacent, a then b): one tab in the bar. */
  splits?: readonly { a: string; b: string; focus: "a" | "b" }[];
  /** The × (or middle-click) on a joined tab; `a` is its first member. */
  onCloseSplit(a: string): void;
  /** A dragged (ordinary) Tab's pointer is below the bar, at x, y. */
  onDragOut?(id: string, x: number, y: number): void;
  /** The dragged Tab was released below the bar. */
  onDropOut?(id: string, x: number, y: number): void;
  /** The drag ended anywhere else (or on Esc) after going below the bar. */
  onDragOutEnd?(): void;
}

/** One tab in the bar: a Tab, or two joined ones (a Split). */
interface Item {
  members: TabBarItem[];
  /** The member a click outside the titles activates. */
  focused: TabBarItem;
}

function itemsOf(
  tabs: TabBarItem[],
  splits: TabBarProps["splits"] = [],
): Item[] {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const second = new Set(splits.map((sp) => sp.b));
  const items: Item[] = [];
  for (const t of tabs) {
    if (second.has(t.id)) continue;
    const sp = splits.find((x) => x.a === t.id);
    const b = sp && byId.get(sp.b);
    if (sp && b) {
      items.push({ members: [t, b], focused: sp.focus === "a" ? t : b });
    } else {
      items.push({ members: [t], focused: t });
    }
  }
  return items;
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
  /** A joined tab: already a Split, so never dragged out. */
  joined: boolean;
  /** Reported below the bar, awaiting its drop or end. */
  out: boolean;
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
  onNewCanvas,
  newHints,
  onMove,
  onRename,
  onContextMenu,
  onUnpin,
  splits,
  onCloseSplit,
  onDragOut,
  onDropOut,
  onDragOutEnd,
  inset = 0,
}: TabBarProps) {
  const items = itemsOf(tabs, splits);
  const barRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** The New menu's anchor (the + button's bottom-left), while open. */
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const openNewMenu = () => {
    const box = plusRef.current?.getBoundingClientRect();
    setNewMenu(box ? { x: box.left, y: box.bottom + 4 } : { x: 0, y: 0 });
  };
  const activeId = tabs.find((t) => t.active)?.id;
  // The press in progress (ref, for the handlers) and its view (state).
  const drag = useRef<Drag | null>(null);
  const [dragView, setDragView] = useState<Drag | null>(null);
  const swallowClick = useRef(false);
  /** The drag ends elsewhere than below the bar: clear what it showed. */
  const dragOutEnd = useRef(onDragOutEnd);
  useEffect(() => {
    dragOutEnd.current = onDragOutEnd;
  });
  const endOut = (d: Drag | null) => {
    if (d?.out) dragOutEnd.current?.();
  };

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
      endOut(drag.current);
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
      endOut(d);
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
    if (e.button !== 0 || editing === items[index].members[0].id) return;
    if ((e.target as Element).closest("button, input")) return;
    const els = barRef.current?.querySelectorAll<HTMLElement>("[role=tab]");
    if (!els) return;
    const rects = [...els].map((el) => el.getBoundingClientRect());
    drag.current = {
      id: items[index].members[0].id,
      pointerId: e.pointerId,
      startX: e.clientX,
      from: index,
      centers: rects.map((r) => r.left + r.width / 2),
      width: rects[index]?.width ?? 0,
      dx: 0,
      moving: false,
      joined: items[index].members.length === 2,
      out: false,
    };
    watchRelease(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if ((e.buttons & 1) === 0) {
      // The button is up (its release was missed): no press to drag.
      endOut(d);
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
    const below =
      !d.joined &&
      e.clientY > (barRef.current?.getBoundingClientRect().bottom ?? Infinity);
    if (below) onDragOut?.(d.id, e.clientX, e.clientY);
    else endOut(d);
    const next = { ...d, dx, moving: true, out: below };
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
    if (d.out) {
      if (drop) onDropOut?.(d.id, e.clientX, e.clientY);
      else onDragOutEnd?.();
      return;
    }
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
      // The bar's empty space moves the window; a double-click maximizes.
      data-tauri-drag-region=""
      style={inset ? { paddingLeft: inset } : undefined}
      className="z-no-scrollbar flex h-11 min-w-0 flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden bg-chrome px-2 pt-2.5"
      onWheel={onWheel}
      onContextMenu={(e) => openMenu(e, null)}
    >
      {items.map((item, index) => {
        const tab = item.members[0];
        const joined = item.members.length === 2;
        const active = item.members.some((m) => m.active);
        const label = item.members.map((m) => m.title).join(" | ");
        // A Split's pin is on its members that aren't diff Tabs.
        const pinnedMember = item.members.find((m) => m.pinned);
        const closeItem = () =>
          joined ? onCloseSplit(tab.id) : onClose(tab.id);
        const shift = shiftOf(index);
        const unsaved = item.members.some((m) => m.unsaved);
        const note = unsaved ? " (unsaved)" : "";
        const lifted = dragView?.moving && dragView.from === index;
        return (
          <div
            key={tab.id}
            ref={active ? activeRef : undefined}
            role="tab"
            aria-selected={active}
            aria-label={joined ? label + note : undefined}
            title={(joined ? label : tooltipOf(tab)) + note}
            onClick={(e) => {
              if (swallowClick.current) {
                swallowClick.current = false;
                return;
              }
              // A click on a joined tab's title activates that member.
              const id = (e.target as Element).closest<HTMLElement>(
                "[data-member]",
              )?.dataset.member;
              onActivate(id ?? item.focused.id);
            }}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault(); // no autoscroll
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeItem();
              }
            }}
            onDoubleClick={() => {
              if (!joined && !tab.locked) setEditing(tab.id);
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
              "group flex h-[34px] min-w-[120px] flex-[0_1_220px] cursor-default select-none items-center gap-2 rounded-t-[8px] pr-1.5 pl-3 text-ui " +
              (joined ? "max-w-[380px] " : "max-w-[220px] ") +
              (lifted ? "relative z-10 shadow-float " : "") +
              (active
                ? (lifted ? "" : "z-tab-flare relative z-[1] ") +
                  "bg-editor text-text"
                : "text-muted hover:bg-row-hover hover:text-text")
            }
          >
            {editing === tab.id && !joined ? (
              <RenameInput
                tab={tab}
                onSubmit={(name) => onRename(tab.id, name)}
                onClose={() => setEditing(null)}
              />
            ) : joined ? (
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                {item.members.map((m, i) => (
                  <Fragment key={m.id}>
                    {i === 1 && (
                      <span
                        aria-hidden="true"
                        className="h-3.5 w-px shrink-0 bg-hairline-strong"
                      />
                    )}
                    <span
                      data-member={m.id}
                      className={
                        "min-w-0 flex-1 truncate " +
                        (active && m !== item.focused ? "text-muted" : "")
                      }
                    >
                      {m.title}
                    </span>
                  </Fragment>
                ))}
              </span>
            ) : (
              <>
                <Icon
                  name={iconFor(tab)}
                  size={15}
                  className={active ? "text-accent" : "text-faint"}
                />
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
              </>
            )}
            {pinnedMember ? (
              <>
                {unsaved && <UnsavedDot />}
                <button
                  type="button"
                  aria-label={`Unpin ${joined ? label : tab.title}${note}`}
                  title="Unpin"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnpin(pinnedMember.id);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-faint hover:bg-row-sel hover:text-text"
                >
                  <Icon name="pin" size={13} />
                </button>
              </>
            ) : (
              <span className="relative flex size-6 shrink-0 items-center justify-center">
                {unsaved && (
                  <UnsavedDot className="absolute group-hover:invisible" />
                )}
                <button
                  type="button"
                  aria-label={`Close ${joined ? label : tab.title}${note}`}
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeItem();
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className={
                    "flex size-6 shrink-0 items-center justify-center rounded-[5px] text-faint hover:bg-row-sel hover:text-text " +
                    (active && !unsaved ? "" : "invisible group-hover:visible")
                  }
                >
                  <CloseIcon />
                </button>
              </span>
            )}
          </div>
        );
      })}
      {/* + makes a text Tab at once; the narrow ▾ beside it (or a
          right-click on +) offers a canvas too. */}
      <div className="mb-[3px] ml-1 flex shrink-0 items-center">
        <button
          ref={plusRef}
          type="button"
          aria-label="New Tab"
          title="New Tab"
          tabIndex={-1}
          onClick={onNew}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openNewMenu();
          }}
          className="flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-row-hover hover:text-text"
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          aria-label="New Tab options"
          title="New text or canvas"
          aria-haspopup="menu"
          aria-expanded={newMenu !== null}
          data-z-new-menu=""
          tabIndex={-1}
          onClick={() => (newMenu ? setNewMenu(null) : openNewMenu())}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className={
            "flex h-7 w-4 items-center justify-center rounded-[5px] hover:bg-row-hover hover:text-text " +
            (newMenu ? "bg-row-hover text-text" : "text-faint")
          }
        >
          <Icon name="chevronDown" size={12} strokeWidth={1.8} />
        </button>
      </div>
      {newMenu && (
        <Menu
          label="New Tab"
          x={newMenu.x}
          y={newMenu.y}
          ignoreSelector="[data-z-new-menu]"
          items={[
            { label: "New text", hint: newHints?.text, onSelect: onNew },
            {
              label: "New canvas",
              hint: newHints?.canvas,
              onSelect: onNewCanvas,
            },
          ]}
          onDismiss={() => setNewMenu(null)}
        />
      )}
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
          className="z-fade-in z-30 max-w-[280px] rounded-float bg-surface px-2.5 py-1.5 text-ui-sm text-danger shadow-float"
        >
          {error.text}
        </div>
      )}
    </>
  );
}
