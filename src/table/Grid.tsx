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
import type { EditResult } from "./edits";
import {
  cellHidden,
  columnLabel,
  HIDDEN_DOTS,
  recordNumber,
  splitMatches,
  toTsv,
} from "./gridHelpers";
import type { ParsedTable } from "./parse";
import { numericColumns, type TableSort } from "./view";
import { visibleRange } from "./windowing";
import "./table.css";

/** row = position in `order`; rows only → whole rows, cols only → whole columns, both → a block. */
export interface GridSelection {
  row: number;
  col: number;
  rows?: [number, number];
  cols?: [number, number];
}

export interface GridEditHandlers {
  apply(edit: EditResult, order?: number[]): void;
  undo(): void;
  redo(): void;
}

export interface GridProps {
  table: ParsedTable;
  order: number[];
  header: boolean;
  widths: number[];
  onWidths(w: number[]): void;
  sort?: TableSort;
  onSortClick(col: number): void;
  hidden: readonly [number, number][];
  filter?: string;
  readOnly: boolean;
  focused: boolean;
  fontSize: number;
  edit: GridEditHandlers;
  onSelection?(sel: GridSelection): void;
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

/** Average character width used for width guesses and fitting. */
export const charPx = (fontSize: number): number => fontSize * 0.6;

const platform = detectPlatform();

interface Pos {
  row: number;
  col: number;
}
type Mode = "cell" | "rows" | "cols";
/** `active` is the anchor (the active cell); `head` is the moving end of a range. */
interface SelState {
  active: Pos;
  head: Pos;
  mode: Mode;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const span = (a: number, b: number): [number, number] =>
  a <= b ? [a, b] : [b, a];

function toSelection(s: SelState): GridSelection {
  const { active, head, mode } = s;
  const base = { row: active.row, col: active.col };
  if (mode === "rows") return { ...base, rows: span(active.row, head.row) };
  if (mode === "cols") return { ...base, cols: span(active.col, head.col) };
  if (head.row === active.row && head.col === active.col) return base;
  return {
    ...base,
    rows: span(active.row, head.row),
    cols: span(active.col, head.col),
  };
}

/** The selection as a block of positions: [rowFrom, rowTo] × [colFrom, colTo]. */
function block(
  sel: GridSelection,
  rowCount: number,
  colCount: number,
): [number, number, number, number] {
  const [r0, r1] =
    sel.rows ?? (sel.cols ? [0, rowCount - 1] : [sel.row, sel.row]);
  const [c0, c1] =
    sel.cols ?? (sel.rows ? [0, colCount - 1] : [sel.col, sel.col]);
  return [r0, r1, c0, c1];
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
  const [view, setView] = useState({ top: 0, left: 0, w: 0, h: 0 });

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
    setView((v) =>
      v.top === el.scrollTop && v.left === el.scrollLeft
        ? v
        : { ...v, top: el.scrollTop, left: el.scrollLeft },
    );
  };

  const colWidths = useMemo(
    () => Array.from({ length: nCols }, (_, c) => widths[c] ?? DEFAULT_WIDTH),
    [widths, nCols],
  );
  const colOffsets = useMemo(() => {
    const out = [0];
    for (const w of colWidths) out.push(out[out.length - 1] + w);
    return out;
  }, [colWidths]);
  const rowOffsets = useMemo(
    () => Array.from({ length: nRows + 1 }, (_, i) => i * rowH),
    [nRows, rowH],
  );
  const numeric = useMemo(() => numericColumns(table, header), [table, header]);

  const digits = String(Math.max(1, table.rows.length)).length;
  const gutterW = Math.round(Math.max(2, digits) * cpx + 24);
  const totalW = gutterW + colOffsets[nCols];
  const bodyH = Math.max(0, view.h - headerH);
  const bodyW = Math.max(0, view.w - gutterW);
  const [r0, r1] = visibleRange(rowOffsets, view.top, bodyH, ROW_OVERSCAN);
  const [c0, c1] = visibleRange(colOffsets, view.left, bodyW, COL_OVERSCAN);
  const pageRows = Math.max(1, Math.floor(bodyH / rowH));

  // Selection, clamped to the current shape.
  const [rawSel, setSel] = useState<SelState>({
    active: { row: 0, col: 0 },
    head: { row: 0, col: 0 },
    mode: "cell",
  });
  const fit = (p: Pos): Pos => ({
    row: clamp(p.row, 0, Math.max(0, nRows - 1)),
    col: clamp(p.col, 0, Math.max(0, nCols - 1)),
  });
  const st: SelState = {
    active: fit(rawSel.active),
    head: fit(rawSel.head),
    mode: rawSel.mode,
  };
  const sel = toSelection(st);
  const [sr0, sr1, sc0, sc1] = block(sel, nRows, nCols);

  const onSelection = useRef(props.onSelection);
  useEffect(() => {
    onSelection.current = props.onSelection;
  });
  const selKey = JSON.stringify(sel);
  useEffect(() => {
    onSelection.current?.(JSON.parse(selKey) as GridSelection);
  }, [selKey]);

  /** Scrolls so (row, col) is fully in view. */
  const reveal = (p: Pos) => {
    const el = scroller.current;
    let { top, left } = view;
    const rowTop = p.row * rowH;
    if (rowTop < top) top = rowTop;
    else if (rowTop + rowH > top + bodyH) top = rowTop + rowH - bodyH;
    const colLeft = colOffsets[p.col] ?? 0;
    const colRight = colOffsets[p.col + 1] ?? colLeft;
    if (colLeft < left) left = colLeft;
    else if (colRight > left + bodyW)
      left = Math.min(colLeft, colRight - bodyW);
    top = Math.max(0, top);
    left = Math.max(0, left);
    if (top === view.top && left === view.left) return;
    if (el) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }
    setView((v) => ({ ...v, top, left }));
  };

  const textOf = (fileRow: number, col: number): string => {
    const row = table.rows[fileRow];
    if (!row) return "";
    if (cellHidden(row, col, hidden)) return HIDDEN_DOTS;
    return row.cells[col] ?? "";
  };

  const copy = () => {
    if (nRows === 0 || nCols === 0) return;
    const out: string[][] = [];
    for (let r = sr0; r <= sr1; r++) {
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
    if (e.key === "Escape" && (sel.rows || sel.cols)) {
      e.preventDefault();
      setSel({ active: st.active, head: st.active, mode: "cell" });
      return;
    }
    if (nRows === 0 || nCols === 0) return;
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
    if (e.shiftKey) setSel({ ...st, head: to });
    else setSel({ active: to, head: to, mode: "cell" });
    reveal(to);
  };

  const pick = (e: ReactMouseEvent, p: Pos, mode: Mode) => {
    if (e.button !== 0) return;
    if (e.shiftKey) {
      const keep = mode === st.mode ? st : { ...st, mode };
      setSel({ ...keep, head: p, mode });
    } else {
      setSel({ active: p, head: p, mode });
    }
  };

  // Column resize by dragging a header border.
  const onWidths = useRef(props.onWidths);
  useEffect(() => {
    onWidths.current = props.onWidths;
  });
  const endDrag = useRef<(() => void) | null>(null);
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
      const w = Math.max(RESIZE_MIN, Math.round(w0 + ev.clientX - x0));
      if (w === next[c]) return;
      next[c] = w;
      onWidths.current([...next]);
    };
    const up = () => endDrag.current?.();
    endDrag.current = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("z-grid-resizing");
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
    const [v0, v1] = visibleRange(rowOffsets, view.top, bodyH, 0);
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

  const focusGrid = useCallback(() => {
    scroller.current?.focus({ preventScroll: true });
  }, []);

  const leftPad = colOffsets[c0];
  const cols: number[] = [];
  for (let c = c0; c < c1; c++) cols.push(c);
  const inRows = (r: number) => r >= sr0 && r <= sr1;
  const inCols = (c: number) => c >= sc0 && c <= sc1;

  const rows: ReactNode[] = [];
  for (let r = r0; r < r1; r++) {
    const fileRow = order[r];
    const row = table.rows[fileRow];
    const rowSelected = sel.rows !== undefined && !sel.cols && inRows(r);
    rows.push(
      <div
        key={fileRow}
        role="row"
        aria-rowindex={r + 2}
        className="z-grid-row"
        style={{ top: headerH + r * rowH, height: rowH, width: totalW }}
      >
        <div
          role="rowheader"
          className="z-grid-gutter"
          data-selected={rowSelected ? "" : undefined}
          style={{ width: gutterW, minWidth: gutterW }}
          onMouseDown={(e) => pick(e, { row: r, col: st.active.col }, "rows")}
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
        style={{ width: totalW, height: headerH + nRows * rowH }}
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
            const colSelected =
              sel.cols !== undefined && !sel.rows && inCols(c);
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
                onClick={() => props.onSortClick(c)}
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
        </div>
        {rows}
      </div>
    </div>
  );
}
