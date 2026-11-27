import {
  useCallback,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { letterOf, type Platform } from "../app/shortcuts";
import type { MenuItem } from "../ui/Menu";
import type { CommitMove } from "./CellEditor";
import {
  deleteColumn,
  deleteRows,
  insertColumn,
  insertRows,
  setCell,
  setCells,
  type CellValue,
  type EditResult,
} from "./edits";
import type { GridEditHandlers, GridSelection } from "./Grid";
import type { ParsedTable } from "./parse";
import { columnMenu, rowMenu, type MenuCtx } from "./tableMenus";
import { orderAfterDelete, orderAfterInsert, type TableSort } from "./view";

export interface CellPos {
  row: number;
  col: number;
}
export type SelectMode = "cell" | "rows" | "cols";

/** The open cell editor. `pos` is the shown position, or -1 for a header cell. */
export interface EditorState {
  pos: number;
  fileRow: number;
  col: number;
  value: string;
}

interface MenuState {
  kind: "row" | "col";
  /** The selection the menu acts on, as it was when the menu opened. */
  sel: GridSelection;
  x: number;
  y: number;
}

export interface GridEditingArgs {
  table: ParsedTable;
  seq: number;
  order: number[];
  header: boolean;
  readOnly: boolean;
  sort?: TableSort;
  onSort(sort: TableSort): void;
  edit: GridEditHandlers;
  platform: Platform;
  /** The current (clamped) selection. */
  sel: GridSelection;
  /** Sets the selection; a "cell" selection is also scrolled into view. */
  select(active: CellPos, mode: SelectMode, rows?: number[]): void;
  focusGrid(): void;
}

/** Runs an edit builder; a builder that throws (out-of-range input) is no edit. */
function build(f: () => EditResult): EditResult | null {
  try {
    return f();
  } catch {
    return null;
  }
}

/**
 * Cell editing, clearing, undo/redo keys and the gutter/header menus. Every
 * edit is built from the current `table` at the moment of the user action and
 * goes through exactly one `edit.apply`.
 */
export function useGridEditing(a: GridEditingArgs) {
  const { table, order, header, readOnly, sel, edit } = a;
  const nRows = order.length;
  const nCols = table.width;
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // A re-parse (new seq) drops the editor and any menu: their rows may be gone.
  const [seenSeq, setSeenSeq] = useState(a.seq);
  if (a.seq !== seenSeq) {
    setSeenSeq(a.seq);
    setEditor(null);
    setMenu(null);
  }
  // A new order reinterprets positions: the menu's selection is stale.
  const [seenOrder, setSeenOrder] = useState(order);
  if (order !== seenOrder) {
    setSeenOrder(order);
    setMenu(null);
  }

  const open = (pos: number, col: number, initial?: string) => {
    if (readOnly || col < 0 || col >= Math.max(nCols, 1)) return;
    const fileRow = pos < 0 ? 0 : order[pos];
    if (fileRow === undefined || fileRow >= table.rows.length) return;
    const value = initial ?? table.rows[fileRow].cells[col] ?? "";
    setEditor({ pos, fileRow, col, value });
  };

  const commit = (move: CommitMove) => {
    const ed = editor;
    if (!ed) return;
    setEditor(null);
    // Keyboard commits (Enter, Tab) return focus to the grid. A blur or
    // shortcut commit leaves focus alone: the user, or the app, moved it.
    if (move) a.focusGrid();
    const current = table.rows[ed.fileRow]?.cells[ed.col] ?? "";
    if (ed.value !== current) {
      const r = build(() => setCell(table, ed.fileRow, ed.col, ed.value));
      if (!r || !edit.apply(r)) return;
    }
    if (!move || ed.pos < 0) return;
    const d = { down: [1, 0], up: [-1, 0], right: [0, 1], left: [0, -1] }[move];
    a.select({ row: ed.pos + d[0], col: ed.col + d[1] }, "cell");
  };

  const cancel = () => {
    setEditor(null);
    a.focusGrid();
  };

  /** Delete: empties every non-empty selected cell, as one edit. */
  const clear = () => {
    if (nRows === 0 || nCols === 0) return;
    let positions: number[];
    let cols: [number, number];
    if (sel.rows && sel.cols) [positions, cols] = [sel.rows, sel.cols];
    else if (sel.rows) [positions, cols] = [sel.rows, [0, nCols - 1]];
    else if (sel.cols)
      [positions, cols] = [
        Array.from({ length: nRows }, (_, i) => i),
        sel.cols,
      ];
    else [positions, cols] = [[sel.row], [sel.col, sel.col]];
    const cells: CellValue[] = [];
    for (const p of positions) {
      const fileRow = order[p];
      const row = table.rows[fileRow];
      if (!row) continue;
      const last = Math.min(cols[1], row.cells.length - 1);
      for (let c = cols[0]; c <= last; c++)
        if (row.cells[c] !== "")
          cells.push({ row: fileRow, col: c, value: "" });
    }
    if (cells.length === 0) return;
    const r = build(() => setCells(table, cells));
    if (r) edit.apply(r);
  };

  /** Grid keydown, before navigation. True when the key was handled. */
  const onKey = (e: ReactKeyboardEvent): boolean => {
    const mac = a.platform === "mac";
    const mod = mac ? e.metaKey : e.ctrlKey;
    const letter = letterOf(e);
    if (mod && !e.altKey && (letter === "z" || (letter === "y" && !mac))) {
      e.preventDefault();
      if (readOnly) return true;
      if (letter === "y" || e.shiftKey) edit.redo();
      else edit.undo();
      return true;
    }
    if (readOnly || nRows === 0 || nCols === 0) return false;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if ((e.key === "Enter" && plain && !e.shiftKey) || e.key === "F2") {
      e.preventDefault();
      open(sel.row, sel.col);
      return true;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && plain) {
      e.preventDefault();
      clear();
      return true;
    }
    // A printable character starts editing with it. AltGr is Ctrl+Alt off
    // macOS; Option composes characters on macOS.
    const typed =
      [...e.key].length === 1 &&
      !e.metaKey &&
      (e.ctrlKey ? e.altKey && !mac : !e.altKey || mac);
    if (typed) {
      e.preventDefault();
      open(sel.row, sel.col, e.key);
      return true;
    }
    return false;
  };

  const positionsOf = (s: GridSelection) =>
    s.rows && !s.cols ? s.rows : [s.row];

  const ctx = (s: GridSelection): MenuCtx => ({
    readOnly,
    header,
    sort: a.sort,
    insertRow(side) {
      const ps = positionsOf(s);
      const p = side === "above" ? Math.min(...ps) : Math.max(...ps);
      const fileRow = order[p];
      if (fileRow === undefined) return;
      const at = side === "above" ? fileRow : fileRow + 1;
      const r = build(() => insertRows(table, at, 1));
      if (!r) return;
      const after = side === "above" ? p - 1 : p;
      if (edit.apply(r, orderAfterInsert(order, at, 1, after)))
        a.select({ row: after + 1, col: s.col }, "cell");
    },
    deleteRows() {
      const ps = positionsOf(s);
      const rows = ps.map((p) => order[p]).filter((r) => r !== undefined);
      if (rows.length === 0) return;
      const r = build(() => deleteRows(table, rows));
      if (r && edit.apply(r, orderAfterDelete(order, rows)))
        a.select({ row: Math.min(...ps), col: s.col }, "cell");
    },
    insertColumn(side) {
      const at = side === "left" ? s.col : s.col + 1;
      const r = build(() => insertColumn(table, at));
      if (!r || !edit.apply(r)) return;
      if (header && table.rows.length > 0) {
        a.select({ row: s.row, col: at }, "cell");
        setEditor({ pos: -1, fileRow: 0, col: at, value: "" });
      } else {
        a.select({ row: 0, col: at }, "cell");
      }
    },
    deleteColumn() {
      const r = build(() => deleteColumn(table, s.col));
      if (r && edit.apply(r)) a.select({ row: s.row, col: s.col }, "cell");
    },
    renameColumn() {
      open(-1, s.col);
    },
    sortBy(dir) {
      a.onSort({ col: s.col, dir });
    },
  });

  const onGutterMenu = (e: ReactMouseEvent, pos: number) => {
    e.preventDefault();
    const kept = sel.rows && !sel.cols && sel.rows.includes(pos);
    const s: GridSelection = kept
      ? sel
      : { row: pos, col: sel.col, rows: [pos] };
    if (!kept) a.select({ row: pos, col: sel.col }, "rows", [pos]);
    setMenu({ kind: "row", sel: s, x: e.clientX, y: e.clientY });
  };

  const onHeaderMenu = (e: ReactMouseEvent, col: number) => {
    e.preventDefault();
    a.select({ row: sel.row, col }, "cols");
    setMenu({
      kind: "col",
      sel: { row: sel.row, col, cols: [col, col] },
      x: e.clientX,
      y: e.clientY,
    });
  };

  const { focusGrid } = a;
  const dismissMenu = useCallback(() => {
    setMenu(null);
    focusGrid();
  }, [focusGrid]);

  let menuView: {
    label: string;
    items: MenuItem[];
    x: number;
    y: number;
  } | null = null;
  if (menu) {
    const c = ctx(menu.sel);
    menuView =
      menu.kind === "row"
        ? { label: "Row", items: rowMenu(menu.sel, c), x: menu.x, y: menu.y }
        : {
            label: "Column",
            items: columnMenu(menu.sel, c),
            x: menu.x,
            y: menu.y,
          };
  }

  return {
    editor,
    setEditorValue: (value: string) =>
      setEditor((ed) => (ed ? { ...ed, value } : ed)),
    commit,
    cancel,
    onKey,
    menu: menuView,
    dismissMenu,
    onGutterMenu,
    onHeaderMenu,
  };
}
