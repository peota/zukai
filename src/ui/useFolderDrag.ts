import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent, RefObject } from "react";
import type { Entry } from "../library/api";
import { rootOf, type Row } from "../library/tree";
import { isUnder, parentOf, sameDir } from "./libraryEntries";

/** What is being dragged onto a Library folder. */
export type DragSource =
  { kind: "entry"; entry: Entry } | { kind: "scratchpad"; id: string };

export interface PointerHandlers {
  onPointerDown(e: PointerEvent<HTMLElement>): void;
  onPointerMove(e: PointerEvent<HTMLElement>): void;
  onPointerUp(e: PointerEvent<HTMLElement>): void;
  onPointerCancel(e: PointerEvent<HTMLElement>): void;
}

/** Pointer travel (px) before a press becomes a drag; less is a click. */
const DRAG_THRESHOLD = 4;

/**
 * A press is just its start point: nothing is measured or walked until it
 * crosses the threshold, so a plain click costs nothing.
 */
interface Press {
  source: DragSource;
  pointerId: number;
  startX: number;
  startY: number;
  moving: boolean;
  dest: string | null;
}

/** Each row's parent row index (-1 for the top level), in one pass. */
export function parentIndex(rows: Row[]): Int32Array {
  const parents = new Int32Array(rows.length);
  const stack: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const d = rows[i].depth;
    while (stack.length > 0 && rows[stack[stack.length - 1]].depth >= d) {
      stack.pop();
    }
    parents[i] = stack.length > 0 ? stack[stack.length - 1] : -1;
    stack.push(i);
  }
  return parents;
}

/** A drop that would do nothing or can't be done lands nowhere. */
function allowed(source: DragSource, dest: string | null): string | null {
  if (dest === null || source.kind === "scratchpad") return dest;
  const path = source.entry.path;
  if (sameDir(dest, path) || isUnder(dest, path)) return null;
  return sameDir(dest, parentOf(path)) ? null : dest;
}

/**
 * Pointer-event drag of tree rows and Scratchpad items onto Library folders, the
 * same way the tab bar drags Tabs: a threshold, Esc to cancel, the click
 * after a drag swallowed, and a window-level release guard. The target is
 * the one row under the pointer, hit-tested.
 */
export function useFolderDrag({
  treeRef,
  rows,
  root,
  roots,
  blocked,
  fixed,
  onDrop,
}: {
  treeRef: RefObject<HTMLElement | null>;
  rows: Row[];
  root: string | null;
  /** The Library root and the added folders: a drop across them copies. */
  roots: string[];
  /** Entries Zukai can't act on: never dragged, never a target. */
  blocked(e: Entry): boolean;
  /** Entries that are never dragged but may be a target (an added folder). */
  fixed(e: Entry): boolean;
  onDrop(source: DragSource, destDir: string): void;
}) {
  const press = useRef<Press | null>(null);
  const [view, setView] = useState<{
    dest: string | null;
    copy: boolean;
  } | null>(null);
  const swallow = useRef(false);
  // The parent index of the rows being dragged over, built when a drag starts.
  const parents = useRef<{ rows: Row[]; index: Int32Array } | null>(null);

  const clear = useCallback(() => {
    press.current = null;
    parents.current = null;
    setView(null);
  }, []);

  const moving = view !== null;
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
    if (
      source.kind === "entry" &&
      (blocked(source.entry) || fixed(source.entry))
    ) {
      return;
    }
    press.current = {
      source,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moving: false,
      dest: null,
    };
    watchRelease(e.pointerId);
  };

  /** Where a drop at (x, y) lands: the row under the pointer, or the root. */
  const destAt = (source: DragSource, x: number, y: number): string | null => {
    const tree = treeRef.current;
    const hit = document.elementFromPoint?.(x, y) ?? null;
    if (!tree || !hit || !tree.contains(hit)) return null;
    const rowEl = hit.closest<HTMLElement>("[data-row]");
    if (!rowEl) {
      // The tree's own empty part (not an inline card) is the root.
      return hit === tree ? allowed(source, root) : null;
    }
    const i = Number(rowEl.dataset.row);
    const r = rows[i];
    if (!r || r.heading?.available === false) return null;
    if (r.entry.isDir) {
      return blocked(r.entry) ? null : allowed(source, r.entry.path);
    }
    if (parents.current?.rows !== rows) {
      parents.current = { rows, index: parentIndex(rows) };
    }
    const p = parents.current.index[i];
    return allowed(source, p >= 0 ? rows[p].entry.path : root);
  };

  const move = (e: PointerEvent<HTMLElement>) => {
    const d = press.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if ((e.buttons & 1) === 0) {
      // The button is up (its release was missed): no press to drag.
      clear();
      return;
    }
    if (!d.moving) {
      const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
      if (dist < DRAG_THRESHOLD) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // No capture (e.g. the pointer is gone): the drag still works.
      }
    }
    const dest = destAt(d.source, e.clientX, e.clientY);
    press.current = { ...d, moving: true, dest };
    if (!d.moving || dest !== d.dest) {
      // A drop into another tree copies (Rust never moves across roots).
      const copy =
        d.source.kind === "entry" &&
        dest !== null &&
        rootOf(d.source.entry.path, roots) !== rootOf(dest, roots);
      setView({ dest, copy });
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
    onPointerDown: (e) => begin(e, source),
    onPointerMove: move,
    onPointerUp: (e) => end(e, true),
    onPointerCancel: (e) => end(e, false),
  });

  /** True (once) when the click that follows a drag should be ignored. */
  const swallowClick = () => {
    if (!swallow.current) return false;
    swallow.current = false;
    return true;
  };

  return {
    dropTarget: view?.dest ?? null,
    /** The drop would copy into another tree: the target shows "Copy". */
    dropCopy: view?.copy ?? false,
    dragging: moving,
    handlers,
    swallowClick,
  };
}
