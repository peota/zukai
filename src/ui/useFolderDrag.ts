import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent, RefObject } from "react";
import type { Entry } from "../library/api";
import { rootOf, type Row } from "../library/tree";
import { isUnder, parentOf, sameDir } from "./libraryEntries";

/** What is being dragged onto a Library folder. */
export type DragSource =
  | {
      kind: "entry";
      entry: Entry;
      /** The selection it carries along (it included), when it's selected. */
      group?: Entry[];
    }
  | { kind: "scratchpad"; id: string };

/** The entries a drag of `source` moves: its group, or just itself. */
export function draggedEntries(
  source: Extract<DragSource, { kind: "entry" }>,
): Entry[] {
  return source.group ?? [source.entry];
}

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
  /** Where in the row the pointer grabbed it, measured when the drag starts. */
  offX: number;
  offY: number;
}

/**
 * The lifted copy of the dragged row that follows the pointer. On release it
 * glides into the folder it dropped on, or back to where it came from.
 */
export interface DragGhost {
  source: DragSource;
  left: number;
  top: number;
  width: number;
  /** Set once released: where it settles before it goes away. */
  landing: { left: number; top: number; drop: boolean } | null;
}

/** True when the OS asks for less motion: the ghost then just goes away. */
const reducedMotion = (): boolean =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  const group = draggedEntries(source);
  // Nothing goes into itself, and at least one item has to actually move.
  if (group.some((e) => sameDir(dest, e.path) || isUnder(dest, e.path))) {
    return null;
  }
  return group.every((e) => sameDir(dest, parentOf(e.path))) ? null : dest;
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
    source: DragSource;
  } | null>(null);
  const [ghost, setGhost] = useState<DragGhost | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const swallow = useRef(false);
  // The parent index of the rows being dragged over, built when a drag starts.
  const parents = useRef<{ rows: Row[]; index: Int32Array } | null>(null);

  /**
   * Ends the press. A drag's ghost settles at `to` (a drop) or glides back
   * to its row (anything else) before it goes away.
   */
  const clear = useCallback(
    (to: { left: number; top: number } | null = null) => {
      const d = press.current;
      press.current = null;
      parents.current = null;
      setView(null);
      if (!d?.moving || reducedMotion()) {
        setGhost(null);
        return;
      }
      const landing = to
        ? { ...to, drop: true }
        : { left: d.startX - d.offX, top: d.startY - d.offY, drop: false };
      setGhost((g) => g && { ...g, landing });
    },
    [],
  );

  /** The ghost finished settling: take it away. */
  const ghostDone = useCallback(() => setGhost(null), []);

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
      offX: 0,
      offY: 0,
    };
    watchRelease(e.pointerId);
  };

  /** True unless `source` is an entry outside the Library (an added folder). */
  const fromLibrary = (source: DragSource): boolean =>
    source.kind !== "entry" ||
    (root !== null && rootOf(source.entry.path, roots) === rootOf(root, roots));

  /** Where a drop at (x, y) lands: the row under the pointer, or the root. */
  const destAt = (source: DragSource, x: number, y: number): string | null => {
    const tree = treeRef.current;
    const hit = document.elementFromPoint?.(x, y) ?? null;
    if (!tree || !hit || !tree.contains(hit)) return null;
    const rowEl = hit.closest<HTMLElement>("[data-row]");
    if (!rowEl) {
      // The tree's own empty part (not an inline card) is the Library root,
      // only for a drag from the Library: from an added folder it would be
      // a copy into the Library with no row to show "Copy" on.
      return hit === tree && fromLibrary(source) ? allowed(source, root) : null;
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
    let { offX, offY } = d;
    if (!d.moving) {
      const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
      if (dist < DRAG_THRESHOLD) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // No capture (e.g. the pointer is gone): the drag still works.
      }
      // Lift the row: its ghost keeps the grab point under the pointer.
      const box = e.currentTarget.getBoundingClientRect();
      offX = d.startX - box.left;
      offY = d.startY - box.top;
      setGhost({
        source: d.source,
        left: e.clientX - offX,
        top: e.clientY - offY,
        width: Math.min(box.width, 260),
        landing: null,
      });
    } else if (ghostRef.current) {
      // Every move after the lift: straight to the DOM, no render.
      ghostRef.current.style.transform = `translate(${e.clientX - offX}px, ${e.clientY - offY}px)`;
    } else {
      // Moved before the ghost rendered: it mounts where the pointer is now.
      const left = e.clientX - offX;
      const top = e.clientY - offY;
      setGhost((g) => g && { ...g, left, top });
    }
    const dest = destAt(d.source, e.clientX, e.clientY);
    press.current = { ...d, moving: true, dest, offX, offY };
    if (!d.moving || dest !== d.dest) {
      // A drop into another tree copies (Rust never moves across roots).
      const source = d.source;
      const copy =
        source.kind === "entry" &&
        dest !== null &&
        draggedEntries(source).some(
          (e) => rootOf(e.path, roots) !== rootOf(dest, roots),
        );
      setView({ dest, copy, source });
    }
  };

  const end = (e: PointerEvent<HTMLElement>, drop: boolean) => {
    const d = press.current;
    if (!d || d.pointerId !== e.pointerId) return;
    unlisten.current?.();
    const dest = drop && d.moving ? d.dest : null;
    if (dest === null) {
      clear();
    } else {
      // It settles into the highlighted folder row, or where it is (the root).
      const row = treeRef.current?.querySelector<HTMLElement>(
        '[data-drop-target="true"]',
      );
      const box = row?.getBoundingClientRect();
      clear(
        box
          ? { left: box.left + 16, top: box.top }
          : { left: e.clientX - d.offX, top: e.clientY - d.offY },
      );
    }
    if (!d.moving) return;
    swallow.current = true;
    if (dest !== null) onDrop(d.source, dest);
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
    /** What is being dragged, while a drag is on. */
    source: view?.source ?? null,
    ghost,
    ghostRef,
    ghostDone,
    handlers,
    swallowClick,
  };
}
