import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TextBridge } from "../editor/EditorHost";
import type { TableInfo, TableUnreadable, TabState } from "../model/types";
import { insertRows, type EditResult } from "./edits";
import { cellHidden } from "./gridHelpers";
import { charPx, Grid, type ColumnChange, type GridEditHandlers } from "./Grid";
import type { ParsedTable } from "./parse";
import { useTableModel } from "./useTableModel";
import { guessWidths, NEXT_SORT, rowOrder, type TableSort } from "./view";

export interface TableHostProps {
  tab: TabState;
  bridge: TextBridge | null;
  focused: boolean;
  fontSize: number;
  onTabPatch(id: string, patch: Partial<TabState>): void;
  onInfo(info: TableInfo | null): void;
  /**
   * Bumped by Mod+F on this Tab: focus the Filter box. 0 when the last
   * request was for another Tab (never a request).
   */
  filterSignal: number;
  /**
   * The text can't be read as a table (the Tab then goes to raw text), or
   * null once it is read as one. TabPane shows the notice in either View.
   */
  onNotice(notice: TableUnreadable | null): void;
  /**
   * Bumped to give the keyboard back (after a status-bar action): the grid
   * takes it when this Tab is the focused one.
   */
  focusSignal?: number;
  /**
   * The `focusSignal` already handled when this grid mounts; a newer one is
   * a bump that came with the switch to the grid, and the grid takes the
   * keyboard once it's read. Absent: the current `focusSignal`.
   */
  focusSeen?: number;
}

/** Typing in the Filter box applies after this pause. */
const FILTER_DELAY_MS = 150;
const NO_ROWS: number[] = [];
const NO_HIDDEN: readonly [number, number][] = [];

/**
 * Focus the grid may not take when it shows: a field in the sidebar (a new
 * item's name, the search), a dialog, or another text input. EditorHost
 * keeps the same rule for a Text Tab's view.
 */
function focusIsTaken(): boolean {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || a === document.body) return false;
  if (a.closest("[data-z-sidebar]") && a instanceof HTMLInputElement)
    return true;
  if (a.closest('[role="dialog"]')) return true;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement;
}

/** The shown rows, and what they were computed from. */
interface Shown {
  order: number[];
  seq: number;
  sort?: TableSort;
  filter: string;
  header: boolean;
}

/** A Table Tab's grid View: the Filter bar over the grid. */
export default function TableHost(p: TableHostProps) {
  const { tab, bridge, onTabPatch } = p;
  const id = tab.id;
  const path = tab.file?.path ?? tab.title;
  const header = tab.header ?? true;
  const sort = tab.sort;
  const filter = tab.filter ?? "";
  const { model, busy, apply } = useTableModel(bridge, id, path, tab.delimiter);
  const table = model.status === "ready" ? model.table : null;
  const seq = model.status === "ready" ? model.seq : -1;
  const readOnly = bridge ? bridge.readOnly(id) : true;

  const hidden = bridge?.hidden(id) ?? NO_HIDDEN;
  // The row order changes with the Sort, Filter, Header row or a re-parse,
  // never after the grid's own edit (an edited row stays put).
  const [shown, setShown] = useState<Shown | null>(null);
  let order = shown?.order ?? NO_ROWS;
  if (
    table &&
    (!shown ||
      shown.seq !== seq ||
      shown.sort !== sort ||
      shown.filter !== filter ||
      shown.header !== header)
  ) {
    // The Filter never looks into a Hidden cell: it would tell which rows
    // hold the hidden text.
    const isMasked =
      hidden.length > 0
        ? (r: number, c: number) => cellHidden(table.rows[r], c, hidden)
        : undefined;
    order = rowOrder(table, { header, sort, filter, isMasked });
    setShown({ order, seq, sort, filter, header });
  }

  // Widths: the Tab's, else guessed once per parse (not on every own edit).
  const cpx = charPx(p.fontSize);
  const [guess, setGuess] = useState<{
    seq: number;
    header: boolean;
    cpx: number;
    widths: number[];
  } | null>(null);
  let guessed = guess?.widths ?? NO_ROWS;
  if (
    table &&
    (!guess ||
      guess.seq !== seq ||
      guess.header !== header ||
      guess.cpx !== cpx)
  ) {
    guessed = guessWidths(table, header, cpx);
    setGuess({ seq, header, cpx, widths: guessed });
  }
  const width = table?.width ?? 0;
  const colWidths = tab.colWidths;
  const widths = useMemo(
    () =>
      Array.from(
        { length: width },
        (_, c) => colWidths?.[c] ?? guessed[c] ?? cpx * 8,
      ),
    [width, colWidths, guessed, cpx],
  );

  // Latest values for the edit handlers, which the grid may hold on to.
  const live = useRef({ widths, header, cpx, apply, onTabPatch });
  useEffect(() => {
    live.current = { widths, header, cpx, apply, onTabPatch };
  });

  const edit = useMemo<GridEditHandlers>(
    () => ({
      apply(
        e: EditResult,
        next?: number[],
        column?: ColumnChange,
        base?: ParsedTable,
      ) {
        const l = live.current;
        if (!l.apply(e, base)) return false;
        if (next) setShown((s) => s && { ...s, order: next });
        if (column) {
          const w = [...l.widths];
          if (column.op === "insert") {
            const g = guessWidths(e.table, l.header, l.cpx)[column.at];
            w.splice(column.at, 0, g ?? l.cpx * 8);
          } else {
            w.splice(column.at, 1);
          }
          l.onTabPatch(id, { colWidths: w });
        }
        return true;
      },
      undo: () => void bridge?.undo(id),
      redo: () => void bridge?.redo(id),
    }),
    [bridge, id, setShown],
  );

  // An Unreadable Table goes to raw text, where TabPane shows the notice.
  const report = useRef({ onNotice: p.onNotice, onTabPatch });
  useEffect(() => {
    report.current = { onNotice: p.onNotice, onTabPatch };
  });
  useEffect(() => {
    const r = report.current;
    if (model.status === "unreadable") {
      r.onNotice({ line: model.line, reason: model.reason });
      r.onTabPatch(id, { tableView: "raw" });
    } else if (model.status === "ready") {
      r.onNotice(null);
    }
  }, [model, id]);

  const rows = table
    ? table.rows.length - (header && table.rows.length ? 1 : 0)
    : 0;
  const delimiter = table?.delimiter;
  const info = useMemo<TableInfo | null>(
    () =>
      delimiter
        ? { rows, shown: order.length, cols: width, delimiter, header }
        : null,
    [rows, order.length, width, delimiter, header],
  );
  const { onInfo } = p;
  useEffect(() => {
    onInfo(info);
  }, [info, onInfo]);

  // The Filter box: typed text applies (and is stored) after a pause.
  const [query, setQuery] = useState(filter);
  useEffect(() => {
    if (query === filter) return;
    const t = setTimeout(
      () => report.current.onTabPatch(id, { filter: query || undefined }),
      FILTER_DELAY_MS,
    );
    return () => clearTimeout(t);
  }, [query, filter, id]);
  // A focusSignal bump in the focused Tab: the grid takes the keyboard as
  // soon as it shows (now, or once the text is read).
  const [focusSeen, setFocusSeen] = useState(p.focusSeen ?? p.focusSignal);
  const [focusGrid, setFocusGrid] = useState(false);
  if (p.focusSignal !== focusSeen) {
    setFocusSeen(p.focusSignal);
    if (p.focused) setFocusGrid(true);
  }
  // Shown in the focused Tab (or its Tab becomes the focused one): the grid
  // takes the keyboard once it's read, as EditorHost does for a Text Tab.
  const [wasFocused, setWasFocused] = useState(p.focused);
  const [showFocus, setShowFocus] = useState(p.focused);
  if (p.focused !== wasFocused) {
    setWasFocused(p.focused);
    setShowFocus(p.focused);
  }
  if (showFocus && table) {
    setShowFocus(false);
    if (p.focused && !focusIsTaken()) setFocusGrid(true);
  }
  const onFocusDone = useCallback(() => setFocusGrid(false), []);
  const filterBox = useRef<HTMLInputElement>(null);
  const signal = useRef(p.filterSignal);
  useEffect(() => {
    if (p.filterSignal === signal.current) return;
    signal.current = p.filterSignal;
    if (!p.filterSignal) return;
    filterBox.current?.focus();
    filterBox.current?.select();
  }, [p.filterSignal]);

  /** With no data row shown, a way to add one: at the end of the file. */
  const addRow = () => {
    if (!table) return;
    const at = table.rows.length;
    // An empty file with a header row needs the header line first.
    const count = header && at === 0 ? 2 : 1;
    let r: EditResult;
    try {
      r = insertRows(table, at, count);
    } catch {
      return;
    }
    edit.apply(r, [...order, at + count - 1], undefined, table);
  };

  /** Empties the Filter box and the Filter at once (no pause). */
  const clearFilter = () => {
    setQuery("");
    if (filter) onTabPatch(id, { filter: undefined });
  };
  const noMatch = table !== null && !!filter && order.length === 0;

  return (
    <div
      data-testid="table-host"
      className="flex size-full min-w-0 flex-col bg-editor"
    >
      <div className="flex h-10 shrink-0 select-none items-center gap-2 border-b border-hairline bg-editor px-3 text-ui-sm">
        <div className="flex h-7 w-72 min-w-0 items-center gap-1 rounded-[6px] bg-sunken pr-0.5 pl-2 focus-within:shadow-[0_0_0_1px_var(--z-accent)]">
          <input
            ref={filterBox}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && (query || filter)) {
                e.preventDefault();
                clearFilter();
              }
            }}
            placeholder="Filter rows…"
            aria-label="Filter rows"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-faint"
          />
          <span
            aria-live="polite"
            className="shrink-0 whitespace-nowrap text-faint tabular-nums"
          >
            {table && filter ? `${order.length} of ${rows}` : ""}
          </span>
          {query && (
            <button
              type="button"
              aria-label="Clear filter"
              title="Clear filter (Esc)"
              onClick={() => {
                clearFilter();
                filterBox.current?.focus();
              }}
              className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-faint hover:bg-row-hover hover:text-text"
            >
              <X size={14} strokeWidth={2} aria-hidden />
            </button>
          )}
        </div>
        {table && busy && (
          <span className="shrink-0 text-muted">Reading table…</span>
        )}
        {table && rows === 0 && !filter && !readOnly && (
          <button
            type="button"
            onClick={addRow}
            className="shrink-0 rounded-[6px] px-2 py-1 text-muted hover:bg-row-hover hover:text-text"
          >
            Add row
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {model.status === "reading" && (
          <div className="flex size-full items-center justify-center text-ui-sm text-muted">
            Reading table…
          </div>
        )}
        {table && (
          <Grid
            table={table}
            seq={seq}
            order={order}
            header={header}
            widths={widths}
            onWidths={(w) => onTabPatch(id, { colWidths: w })}
            sort={sort}
            onSortClick={(col) =>
              onTabPatch(id, { sort: NEXT_SORT(sort, col) })
            }
            onSort={(s) => onTabPatch(id, { sort: s })}
            hidden={hidden}
            filter={filter || undefined}
            readOnly={readOnly}
            focused={p.focused}
            fontSize={p.fontSize}
            edit={edit}
            focusRequest={focusGrid}
            onFocusDone={onFocusDone}
            memory={id}
            empty={
              noMatch ? (
                <div className="flex flex-col items-center gap-2 text-ui-sm text-muted">
                  <span>{`No rows match "${filter}"`}</span>
                  <button
                    type="button"
                    onClick={clearFilter}
                    className="rounded-[6px] px-3 py-1 font-medium text-muted hover:bg-row-hover hover:text-text"
                  >
                    Clear filter
                  </button>
                </div>
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
