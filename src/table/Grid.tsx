import { ArrowDown, ArrowUp } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { detectPlatform, letterOf } from "../app/shortcuts";
import { Menu } from "../ui/Menu";
import { CellEditor } from "./CellEditor";
import { keepPlace, placeOf } from "./gridMemory";
import type { EditResult } from "./edits";
import {
  cellHidden,
  columnLabel,
  HIDDEN_DOTS,
  rangeOf,
  recordNumber,
  splitMatches,
  toggleSorted,
  toTsv,
  uniformRange,
} from "./gridHelpers";
import type { ParsedTable } from "./parse";
import {
  useGridEditing,
  type CellPos,
  type SelectMode,
} from "./useGridEditing";
import { numericColumns, type TableSort } from "./view";
import { visibleRange } from "./windowing";
import "./table.css";

/**
 * row = position in `order`. rows only → whole rows (sorted unique positions,
 * possibly non-contiguous); cols only → whole columns; both → a block.
 */
export interface GridSelection {
  row: number;
  col: number;
  rows?: number[];
  cols?: [number, number];
}

/** A column the edit inserted or deleted, at File column index `at`. */
export interface ColumnChange {
  at: number;
  op: "insert" | "delete";
}

export interface GridEditHandlers {
  /**
   * Writes the edit (and the new row order, for row inserts and deletes, or
   * the column it inserted or deleted). False when the model refused it: the
   * grid then drops the edit.
   */
  apply(edit: EditResult, order?: number[], column?: ColumnChange): boolean;
  undo(): void;
  redo(): void;
}

export interface GridProps {
  table: ParsedTable;
  /** The model's parse sequence: a new value means the text was re-parsed. */
  seq: number;
  order: number[];
  header: boolean;
  widths: number[];
  onWidths(w: number[]): void;
  sort?: TableSort;
  onSortClick(col: number): void;
  /** Sets the sort from the header menu. */
  onSort(sort: TableSort): void;
  hidden: readonly [number, number][];
  filter?: string;
  readOnly: boolean;
  focused: boolean;
  fontSize: number;
  edit: GridEditHandlers;
  onSelection?(sel: GridSelection): void;
  /** Take the keyboard (after a status-bar action); then `onFocusDone`. */
  focusRequest?: boolean;
  onFocusDone?(): void;
  /**
   * The Tab id under which the grid keeps its scroll and active cell
   * (`gridMemory`): a remount comes back to them.
   */
  memory?: string;
}

/** px at the default font size; scale with fontSize / 13. */
export const ROW_HEIGHT = 28;
const BASE_FONT = 13;
const ROW_OVERSCAN = 6;
const COL_OVERSCAN = 2;
const DEFAULT_WIDTH = 120;
const RESIZE_MIN = 32;
const FIT_MIN = 56;
const FIT_MAX = 360;
const FIT_PAD = 16;
/**
 * The rows' scroll space at most, in px: browsers stop laying out near 33.5M
 * px, so past this the scroll space is scaled (rows are drawn relative to
 * the viewport).
 */
export const MAX_SCROLL_PX = 15_000_000;

/** Average character width used for width guesses and fitting. */
export const charPx = (fontSize: number): number => fontSize * 0.6;

const platform = detectPlatform();

type Pos = CellPos;
type Mode = SelectMode;
/**
 * `active` is the anchor (the active cell); `head` is the moving end of a
 * range. In "rows" mode `rows` is the selected positions, sorted and unique.
 */
interface SelState {
  active: Pos;
  head: Pos;
  mode: Mode;
  rows?: number[];
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const span = (a: number, b: number): [number, number] =>
  a <= b ? [a, b] : [b, a];

const clampPos = (p: Pos, rows: number, cols: number): Pos => ({
  row: clamp(p.row, 0, Math.max(0, rows - 1)),
  col: clamp(p.col, 0, Math.max(0, cols - 1)),
});

function toSelection(s: SelState): GridSelection {
  const { active, head, mode } = s;
  const base = { row: active.row, col: active.col };
  if (mode === "rows") return { ...base, rows: s.rows ?? [active.row] };
  if (mode === "cols") return { ...base, cols: span(active.col, head.col) };
  if (head.row === active.row && head.col === active.col) return base;
  return {
    ...base,
    rows: rangeOf(active.row, head.row),
    cols: span(active.col, head.col),
  };
}

export function Grid(props: GridProps) {
  const { table, order, header, widths, sort, hidden, filter, fontSize } =
    props;
  const rowH = Math.round((ROW_HEIGHT * fontSize) / BASE_FONT);
  const headerH = rowH;
  const nRows = order.length;
  const nCols = table.width;
  const cpx = charPx(fontSize);

  const scroller = useRef<HTMLDivElement>(null);
  const focusGrid = useCallback(() => {
    scroller.current?.focus({ preventScroll: true });
  }, []);
  const { focusRequest, onFocusDone } = props;
  useEffect(() => {
    if (!focusRequest) return;
    focusGrid();
    onFocusDone?.();
  }, [focusRequest, onFocusDone, focusGrid]);
  const { memory } = props;
  // Where this Tab's grid was when it last unmounted.
  const [place] = useState(() => (memory ? placeOf(memory) : undefined));
  /**
   * `top` and `left` are the scroll offsets; `real` is the rows' real offset
   * at `top` when the scroll space is scaled and the grid set it (null: it
   * follows `top`).
   */
  const [view, setView] = useState<{
    top: number;
    left: number;
    w: number;
    h: number;
    real: number | null;
  }>({
    top: place?.scrollTop ?? 0,
    left: place?.scrollLeft ?? 0,
    w: 0,
    h: 0,
    real: null,
  });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !place) return;
    el.scrollTop = place.scrollTop;
    el.scrollLeft = place.scrollLeft;
    // Mount only: the place is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Viewport size: clientWidth/Height, kept current with a ResizeObserver.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const read = () =>
      setView((v) =>
        v.w === el.clientWidth && v.h === el.clientHeight
          ? v
          : { ...v, w: el.clientWidth, h: el.clientHeight },
      );
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    remember();
    setView((v) =>
      v.top === el.scrollTop && v.left === el.scrollLeft
        ? v
        : {
            ...v,
            top: el.scrollTop,
            left: el.scrollLeft,
            real: v.top === el.scrollTop ? v.real : null,
          },
    );
  };

  /** Widths during a border drag: shown live, reported once on mouseup. */
  const [dragWidths, setDragWidths] = useState<number[] | null>(null);
  const colWidths = useMemo(
    () =>
      Array.from(
        { length: nCols },
        (_, c) => (dragWidths ?? widths)[c] ?? DEFAULT_WIDTH,
      ),
    [widths, dragWidths, nCols],
  );
  const colOffsets = useMemo(() => {
    const out = [0];
    for (const w of colWidths) out.push(out[out.length - 1] + w);
    return out;
  }, [colWidths]);
  // Kept per table object by numericColumns itself.
  const numeric = numericColumns(table, header);

  const digits = String(Math.max(1, table.rows.length)).length;
  const gutterW = Math.round(Math.max(2, digits) * cpx + 24);
  const totalW = gutterW + colOffsets[nCols];
  const bodyH = Math.max(0, view.h - headerH);
  const bodyW = Math.max(0, view.w - gutterW);
  // Past MAX_SCROLL_PX the scroll space is scaled: scrollTop maps to the
  // rows' real offset in proportion, and rows are drawn `shift` px from
  // their real place so the ones in view sit in the viewport.
  const realH = nRows * rowH;
  const spaceH = Math.min(realH, MAX_SCROLL_PX);
  const maxReal = Math.max(0, realH - bodyH);
  const ratio = realH > spaceH ? maxReal / Math.max(1, spaceH - bodyH) : 1;
  const realTop =
    ratio === 1 ? view.top : clamp(view.real ?? view.top * ratio, 0, maxReal);
  const shift = view.top - realTop;
  // Rows are uniform: window them in closed form (no offsets array).
  const [r0, r1] = uniformRange(nRows, rowH, realTop, bodyH, ROW_OVERSCAN);
  const [c0, c1] = visibleRange(colOffsets, view.left, bodyW, COL_OVERSCAN);
  const pageRows = Math.max(1, Math.floor(bodyH / rowH));

  // Selection, clamped to the current shape.
  const [rawSel, setSel] = useState<SelState>(() => {
    const at = place ? order.indexOf(place.row) : -1;
    const active = { row: Math.max(0, at), col: place?.col ?? 0 };
    return { active, head: active, mode: "cell" };
  });
  const fit = (p: Pos): Pos => clampPos(p, nRows, nCols);
  // Rebuilt only when the selection or the shape changes.
  const { st, sel } = useMemo(() => {
    const kept = rawSel.rows?.filter((r) => r < nRows);
    const st: SelState = {
      active: clampPos(rawSel.active, nRows, nCols),
      head: clampPos(rawSel.head, nRows, nCols),
      mode: rawSel.mode,
      rows: kept && kept.length > 0 ? kept : undefined,
    };
    return { st, sel: toSelection(st) };
  }, [rawSel, nRows, nCols]);
  const rowSet = useMemo(
    () => (sel.rows && !sel.cols ? new Set(sel.rows) : null),
    [sel],
  );
  const [br0, br1] = span(st.active.row, st.head.row);
  const [sc0, sc1]: [number, number] =
    st.mode === "rows" ? [0, nCols - 1] : span(st.active.col, st.head.col);
  const inRows = (r: number): boolean =>
    rowSet ? rowSet.has(r) : st.mode === "cols" || (r >= br0 && r <= br1);
  const inCols = (c: number) => c >= sc0 && c <= sc1;

  // A new order reinterprets positions: keep only the active cell. After a
  // re-parse (new seq) it stays on the same File-order row while that row is
  // shown, else it goes to the last shown row.
  const [seen, setSeen] = useState({ order, seq: props.seq });
  if (order !== seen.order) {
    const before = seen;
    setSeen({ order, seq: props.seq });
    setSel((s) => {
      let active = s.active;
      if (props.seq !== before.seq) {
        const fileRow = before.order[s.active.row];
        const at = fileRow === undefined ? -1 : order.indexOf(fileRow);
        active = { row: at >= 0 ? at : order.length - 1, col: s.active.col };
      }
      return { active, head: active, mode: "cell" };
    });
  }

  const onSelection = useRef(props.onSelection);
  useEffect(() => {
    onSelection.current = props.onSelection;
  });
  useEffect(() => {
    onSelection.current?.(sel);
  }, [sel]);

  /** The active cell as a File-order row, for `gridMemory`. */
  const activeAt = useRef({ row: 0, col: 0 });
  const remember = () => {
    const el = scroller.current;
    if (!memory || !el) return;
    keepPlace(memory, {
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
      ...activeAt.current,
    });
  };
  const fileRowOfActive = order[sel.row];
  useEffect(() => {
    activeAt.current = { row: fileRowOfActive ?? 0, col: sel.col };
    remember();
    // remember reads only refs and the memory key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileRowOfActive, sel.col, memory]);

  /** Scrolls so (row, col) is fully in view. */
  const reveal = (p: Pos) => {
    const el = scroller.current;
    let top = realTop;
    let { left } = view;
    const rowTop = p.row * rowH;
    if (rowTop < top) top = rowTop;
    else if (rowTop + rowH > top + bodyH) top = rowTop + rowH - bodyH;
    const colLeft = colOffsets[p.col] ?? 0;
    const colRight = colOffsets[p.col + 1] ?? colLeft;
    if (colLeft < left) left = colLeft;
    else if (colRight > left + bodyW)
      left = Math.min(colLeft, colRight - bodyW);
    top = clamp(top, 0, maxReal);
    left = Math.max(0, left);
    if (top === realTop && left === view.left) return;
    const scrollTop = ratio === 1 ? top : Math.round(top / ratio);
    if (el) {
      el.scrollTop = scrollTop;
      el.scrollLeft = left;
    }
    setView((v) => ({
      ...v,
      top: scrollTop,
      left,
      real: ratio === 1 ? null : top,
    }));
  };

  /** Kept unclamped, so a row or column the pending edit adds can be the target. */
  const select = (active: Pos, mode: Mode, rows?: number[]) => {
    setSel({ active, head: active, mode, rows });
    if (mode === "cell") reveal(fit(active));
  };

  const editing = useGridEditing({
    table,
    seq: props.seq,
    order,
    header,
    readOnly: props.readOnly,
    sort,
    onSort: props.onSort,
    edit: props.edit,
    platform,
    sel,
    select,
    focusGrid,
  });

  const textOf = (fileRow: number, col: number): string => {
    const row = table.rows[fileRow];
    if (!row) return "";
    if (cellHidden(row, col, hidden)) return HIDDEN_DOTS;
    return row.cells[col] ?? "";
  };

  const copy = () => {
    if (nRows === 0 || nCols === 0) return;
    const positions =
      st.mode === "rows"
        ? (sel.rows ?? [])
        : st.mode === "cols"
          ? rangeOf(0, nRows - 1)
          : rangeOf(br0, br1);
    const out: string[][] = [];
    for (const r of positions) {
      const line: string[] = [];
      for (let c = sc0; c <= sc1; c++) line.push(textOf(order[r], c));
      out.push(line);
    }
    void navigator.clipboard?.writeText(toTsv(out));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!props.focused || e.currentTarget !== document.activeElement) return;
    const mod = platform === "mac" ? e.metaKey : e.ctrlKey;
    if (mod && !e.altKey && !e.shiftKey && letterOf(e) === "c") {
      e.preventDefault();
      copy();
      return;
    }
    if (editing.onKey(e)) return;
    if (e.key === "Escape" && (sel.rows || sel.cols)) {
      e.preventDefault();
      setSel({ active: st.active, head: st.active, mode: "cell" });
      return;
    }
    if (e.altKey || nRows === 0 || nCols === 0) return;
    if (mod && (e.key === "PageUp" || e.key === "PageDown")) return;
    const from = e.shiftKey ? st.head : st.active;
    const lastR = nRows - 1;
    const lastC = nCols - 1;
    let to: Pos;
    switch (e.key) {
      case "ArrowUp":
        to = { row: mod ? 0 : from.row - 1, col: from.col };
        break;
      case "ArrowDown":
        to = { row: mod ? lastR : from.row + 1, col: from.col };
        break;
      case "ArrowLeft":
        to = { row: from.row, col: mod ? 0 : from.col - 1 };
        break;
      case "ArrowRight":
        to = { row: from.row, col: mod ? lastC : from.col + 1 };
        break;
      case "Home":
        to = mod ? { row: 0, col: 0 } : { row: from.row, col: 0 };
        break;
      case "End":
        to = mod ? { row: lastR, col: lastC } : { row: from.row, col: lastC };
        break;
      case "PageUp":
        to = { row: from.row - pageRows, col: from.col };
        break;
      case "PageDown":
        to = { row: from.row + pageRows, col: from.col };
        break;
      default:
        return;
    }
    e.preventDefault();
    to = fit(to);
    if (e.shiftKey)
      setSel({
        ...st,
        head: to,
        rows: st.mode === "rows" ? rangeOf(st.active.row, to.row) : undefined,
      });
    else setSel({ active: to, head: to, mode: "cell" });
    reveal(to);
  };

  const pick = (e: ReactMouseEvent, p: Pos, mode: Mode) => {
    if (e.button !== 0) return;
    const mod = platform === "mac" ? e.metaKey : e.ctrlKey;
    const rowsFor = (list: number[]) => (mode === "rows" ? list : undefined);
    if (e.shiftKey) {
      // Extends from the anchor and replaces any toggled set.
      setSel({
        active: st.active,
        head: p,
        mode,
        rows: rowsFor(rangeOf(st.active.row, p.row)),
      });
    } else if (mod && mode === "rows") {
      const base = st.mode === "rows" ? (st.rows ?? [st.active.row]) : [];
      const rows = toggleSorted(base, p.row);
      if (rows.length === 0) setSel({ active: p, head: p, mode: "cell" });
      else setSel({ active: p, head: p, mode, rows });
    } else {
      setSel({ active: p, head: p, mode, rows: rowsFor([p.row]) });
    }
  };

  // Column resize by dragging a header border.
  const onWidths = useRef(props.onWidths);
  useEffect(() => {
    onWidths.current = props.onWidths;
  });
  const endDrag = useRef<(() => void) | null>(null);
  // A drag that moved ends with a click on the header cell (the common
  // ancestor of mousedown and mouseup); that click must not sort.
  const dragged = useRef(false);
  useEffect(() => () => endDrag.current?.(), []);

  const startResize = (e: ReactMouseEvent, c: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag.current?.();
    const x0 = e.clientX;
    const w0 = colWidths[c];
    const next = [...colWidths];
    const move = (ev: MouseEvent) => {
      if (ev.clientX !== x0) dragged.current = true;
      const w = Math.max(RESIZE_MIN, Math.round(w0 + ev.clientX - x0));
      if (w === next[c]) return;
      next[c] = w;
      setDragWidths([...next]);
    };
    const up = () => {
      endDrag.current?.();
      if (next[c] !== w0) onWidths.current(next);
      if (dragged.current)
        setTimeout(() => {
          dragged.current = false;
        }, 0);
    };
    endDrag.current = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("z-grid-resizing");
      setDragWidths(null);
      endDrag.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.classList.add("z-grid-resizing");
  };

  const headerLabel = (c: number): string =>
    header && table.rows.length > 0 ? textOf(0, c) : columnLabel(c);
  const headerMasked = (c: number): boolean =>
    header && table.rows.length > 0 && cellHidden(table.rows[0], c, hidden);

  /** Fits column c to the widest cell in view (header included). */
  const fitColumn = (c: number) => {
    const [v0, v1] = uniformRange(nRows, rowH, realTop, bodyH, 0);
    let chars = headerLabel(c).length;
    for (let r = v0; r < v1; r++)
      chars = Math.max(chars, textOf(order[r], c).length);
    const w = clamp(Math.round(chars * cpx + FIT_PAD), FIT_MIN, FIT_MAX);
    const next = [...colWidths];
    next[c] = w;
    onWidths.current(next);
  };

  const needle = filter?.trim() ?? "";
  const content = (value: string, masked: boolean): ReactNode => {
    if (masked || !needle) return value;
    const parts = splitMatches(value, needle);
    if (parts.length === 1) return value;
    return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
  };

  const ed = editing.editor;
  // A header cell's editor lives in the sticky header row, a data cell's
  // before the rows: either way the header, corner and gutter stay on top.
  const editor = ed && (
    <CellEditor
      key={`${ed.pos}:${ed.col}`}
      value={ed.value}
      top={ed.pos < 0 ? 0 : headerH + ed.pos * rowH + shift}
      left={gutterW + (colOffsets[ed.col] ?? colOffsets[nCols])}
      width={colWidths[ed.col] ?? DEFAULT_WIDTH}
      rowHeight={rowH}
      fontSize={fontSize}
      onChange={editing.setEditorValue}
      onCommit={editing.commit}
      onCancel={editing.cancel}
      onLostFocus={focusGrid}
    />
  );
  const leftPad = colOffsets[c0];
  const cols: number[] = [];
  for (let c = c0; c < c1; c++) cols.push(c);

  const rows: ReactNode[] = [];
  for (let r = r0; r < r1; r++) {
    const fileRow = order[r];
    const row = table.rows[fileRow];
    const rowSelected = st.mode === "rows" && inRows(r);
    rows.push(
      <div
        key={fileRow}
        role="row"
        aria-rowindex={r + 2}
        className="z-grid-row"
        style={{
          top: headerH + r * rowH + shift,
          height: rowH,
          width: totalW,
        }}
      >
        <div
          role="rowheader"
          className="z-grid-gutter"
          data-selected={rowSelected ? "" : undefined}
          style={{ width: gutterW, minWidth: gutterW }}
          onMouseDown={(e) => pick(e, { row: r, col: st.active.col }, "rows")}
          onContextMenu={(e) => editing.onGutterMenu(e, r)}
        >
          {recordNumber(fileRow, header)}
        </div>
        <div style={{ width: leftPad, flexShrink: 0 }} />
        {cols.map((c) => {
          const masked = row ? cellHidden(row, c, hidden) : false;
          const value = masked ? HIDDEN_DOTS : (row?.cells[c] ?? "");
          const isSel = inRows(r) && inCols(c);
          const isActive = r === st.active.row && c === st.active.col;
          return (
            <div
              key={c}
              role="gridcell"
              aria-colindex={c + 1}
              aria-selected={isSel}
              data-numeric={numeric[c] ? "" : undefined}
              data-active={isActive ? "" : undefined}
              title={masked || value === "" ? undefined : value}
              className="z-grid-cell"
              style={{ width: colWidths[c] }}
              onMouseDown={(e) => pick(e, { row: r, col: c }, "cell")}
            >
              {content(value, masked)}
            </div>
          );
        })}
      </div>,
    );
  }

  return (
    <div
      ref={scroller}
      role="grid"
      aria-rowcount={nRows + 1}
      aria-colcount={nCols}
      aria-multiselectable
      aria-readonly={props.readOnly || undefined}
      tabIndex={0}
      className="z-grid size-full overflow-auto bg-editor text-text outline-none"
      style={{ fontSize, lineHeight: `${rowH}px` }}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
    >
      <div
        role="presentation"
        className="relative"
        style={{ width: totalW, height: headerH + spaceH }}
      >
        <div
          role="row"
          aria-rowindex={1}
          className="z-grid-head"
          style={{ height: headerH, width: totalW }}
        >
          <div
            className="z-grid-corner"
            style={{ width: gutterW, minWidth: gutterW }}
          />
          <div style={{ width: leftPad, flexShrink: 0 }} />
          {cols.map((c) => {
            const dir = sort?.col === c ? sort.dir : undefined;
            const label = headerLabel(c);
            const colSelected = st.mode === "cols" && inCols(c);
            return (
              <div
                key={c}
                role="columnheader"
                aria-colindex={c + 1}
                aria-sort={
                  dir === "asc"
                    ? "ascending"
                    : dir === "desc"
                      ? "descending"
                      : undefined
                }
                data-numeric={numeric[c] ? "" : undefined}
                data-selected={colSelected ? "" : undefined}
                title={headerMasked(c) ? undefined : label || undefined}
                className="z-grid-hcell"
                style={{ width: colWidths[c] }}
                onContextMenu={(e) => editing.onHeaderMenu(e, c)}
                onClick={() => {
                  if (dragged.current) {
                    dragged.current = false;
                    return;
                  }
                  props.onSortClick(c);
                }}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Select column"
                  className="z-grid-colsel"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    focusGrid();
                    pick(e, { row: st.active.row, col: c }, "cols");
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="z-grid-hlabel">{label}</span>
                {dir && (
                  <span className="z-grid-sort" aria-hidden>
                    {dir === "asc" ? (
                      <ArrowUp size={12} strokeWidth={2.25} />
                    ) : (
                      <ArrowDown size={12} strokeWidth={2.25} />
                    )}
                  </span>
                )}
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize column"
                  className="z-grid-resize"
                  onMouseDown={(e) => startResize(e, c)}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    fitColumn(c);
                  }}
                />
              </div>
            );
          })}
          {ed && ed.pos < 0 && editor}
        </div>
        {ed && ed.pos >= 0 && editor}
        {rows}
      </div>
      {editing.menu && (
        <Menu
          label={editing.menu.label}
          x={editing.menu.x}
          y={editing.menu.y}
          items={editing.menu.items}
          onDismiss={editing.dismissMenu}
        />
      )}
    </div>
  );
}
