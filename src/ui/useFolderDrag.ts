import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent, RefObject } from "react";
import type { Entry } from "../library/api";
import type { Row } from "../library/tree";
import { entryBlocked, isUnder, parentOf, sameDir } from "./libraryEntries";

/** What is being dragged onto a Library folder. */
export type DragSource =
  { kind: "entry"; entry: Entry } | { kind: "inbox"; id: string };

export interface PointerHandlers {
  onPointerDown(e: PointerEvent<HTMLElement>): void;
  onPointerMove(e: PointerEvent<HTMLElement>): void;
  onPointerUp(e: PointerEvent<HTMLElement>): void;
  onPointerCancel(e: PointerEvent<HTMLElement>): void;
}

/** Pointer travel (px) before a press becomes a drag; less is a click. */
const DRAG_THRESHOLD = 4;

interface Slot {
  top: number;
  bottom: number;
  dest: string | null;
}

interface Press {
  source: DragSource;
  pointerId: number;
  startX: number;
  startY: number;
  /** Row boxes and where a drop on each lands, measured at the press. */
  slots: Slot[];
  area: DOMRect | null;
  /** Where a drop on the empty part of the tree lands. */
  below: string | null;
  moving: boolean;
  dest: string | null;
}

/** The folder a drop on row `i` lands in: the folder itself, or a File's folder. */
function destOf(rows: Row[], i: number, root: string | null): string | null {
  const r = rows[i];
  if (r.entry.isDir) return entryBlocked(r.entry) ? null : r.entry.path;
  for (let j = i - 1; j >= 0; j--) {
    if (rows[j].depth < r.depth) return rows[j].entry.path;
  }
  return root;
}

/** A drop that would do nothing or can't be done lands nowhere. */
function allowed(source: DragSource, dest: string | null): string | null {
  if (dest === null || source.kind === "inbox") return dest;
  const path = source.entry.path;
  if (sameDir(dest, path) || isUnder(dest, path)) return null;
  return sameDir(dest, parentOf(path)) ? null : dest;
}

/**
 * Pointer-event drag of tree rows and Inbox items onto Library folders, the
 * same way the tab bar drags Tabs: a threshold, Esc to cancel, the click
 * after a drag swallowed, and a window-level release guard.
 */
export function useFolderDrag({
  treeRef,
  rows,
  root,
  onDrop,
}: {
  treeRef: RefObject<HTMLElement | null>;
  rows: Row[];
  root: string | null;
  onDrop(source: DragSource, destDir: string): void;
}) {
  const press = useRef<Press | null>(null);
  const [view, setView] = useState<{
    moving: boolean;
    dest: string | null;
  } | null>(null);
  const swallow = useRef(false);

  const clear = useCallback(() => {
    press.current = null;
    setView(null);
  }, []);

  const moving = view?.moving ?? false;
  useEffect(() => {
    if (!moving) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      clear();
      // The release that follows still clicks: don't act on it.
      swallow.current = true;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [moving, clear]);

  // A press released outside its row (no capture yet) must not linger and
  // turn a later hover into a drag: the window sees every release.
  const unlisten = useRef<(() => void) | null>(null);
  useEffect(() => () => unlisten.current?.(), []);
  const watchRelease = (pointerId: number) => {
    unlisten.current?.();
    const onRelease = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      unlisten.current?.();
      const d = press.current;
      if (!d || d.pointerId !== pointerId) return;
      clear();
      if (d.moving) swallow.current = true;
    };
    window.addEventListener("pointerup", onRelease);
    window.addEventListener("pointercancel", onRelease);
    unlisten.current = () => {
      window.removeEventListener("pointerup", onRelease);
      window.removeEventListener("pointercancel", onRelease);
      unlisten.current = null;
    };
  };

  const begin = (e: PointerEvent<HTMLElement>, source: DragSource) => {
    swallow.current = false;
    if (e.button !== 0) return;
    if ((e.target as Element).closest("button, input")) return;
    if (source.kind === "entry" && entryBlocked(source.entry)) return;
    const tree = treeRef.current;
    const els = tree?.querySelectorAll<HTMLElement>("[data-row]") ?? [];
    const slots: Slot[] = [];
    els.forEach((el) => {
      const i = Number(el.dataset.row);
      if (!rows[i]) return;
      const r = el.getBoundingClientRect();
      slots.push({
        top: r.top,
        bottom: r.bottom,
        dest: allowed(source, destOf(rows, i, root)),
      });
    });
    press.current = {
      source,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      slots,
      area: tree?.getBoundingClientRect() ?? null,
      below: allowed(source, root),
      moving: false,
      dest: null,
    };
    watchRelease(e.pointerId);
  };

  const destAt = (d: Press, x: number, y: number): string | null => {
    const a = d.area;
    if (!a || x < a.left || x > a.right || y < a.top || y > a.bottom) {
      return null;
    }
    const slot = d.slots.find((s) => y >= s.top && y < s.bottom);
    if (slot) return slot.dest;
    const last = d.slots.reduce((m, s) => Math.max(m, s.bottom), a.top);
    return y >= last ? d.below : null;
  };

  const move = (e: PointerEvent<HTMLElement>) => {
    const d = press.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if ((e.buttons & 1) === 0) {
      // The button is up (its release was missed): no press to drag.
      clear();
      return;
    }
    const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
    if (!d.moving && dist < DRAG_THRESHOLD) return;
    if (!d.moving) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // No capture (e.g. the pointer is gone): the drag still works.
      }
    }
    const next = { ...d, moving: true, dest: destAt(d, e.clientX, e.clientY) };
    press.current = next;
    if (next.dest !== view?.dest || !view?.moving) {
      setView({ moving: true, dest: next.dest });
    }
  };

  const end = (e: PointerEvent<HTMLElement>, drop: boolean) => {
    const d = press.current;
    if (!d || d.pointerId !== e.pointerId) return;
    unlisten.current?.();
    clear();
    if (!d.moving) return;
    swallow.current = true;
    if (drop && d.dest !== null) onDrop(d.source, d.dest);
  };

  /** Pointer handlers for one draggable element. */
  const handlers = (source: DragSource): PointerHandlers => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => begin(e, source),
    onPointerMove: move,
    onPointerUp: (e: PointerEvent<HTMLElement>) => end(e, true),
    onPointerCancel: (e: PointerEvent<HTMLElement>) => end(e, false),
  });

  /** True (once) when the click that follows a drag should be ignored. */
  const swallowClick = () => {
    if (!swallow.current) return false;
    swallow.current = false;
    return true;
  };

  return {
    dropTarget: view?.moving ? view.dest : null,
    dragging: moving,
    handlers,
    swallowClick,
  };
}
