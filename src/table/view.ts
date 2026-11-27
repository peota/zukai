import type { ParsedTable } from "./parse";

export type SortDir = "asc" | "desc";
export interface TableSort {
  col: number;
  dir: SortDir;
}

const WIDTH_SAMPLE_ROWS = 200;
const MIN_WIDTH = 56;
const MAX_WIDTH = 360;
const PADDING = 16;

const cellAt = (t: ParsedTable, row: number, col: number): string =>
  t.rows[row].cells[col] ?? "";

/** A column is numeric when every non-empty data cell parses as a finite number (Number(), after trimming; "" ignored) and at least one does. */
export function numericColumns(t: ParsedTable, header: boolean): boolean[] {
  const out: boolean[] = [];
  for (let c = 0; c < t.width; c++) {
    let seen = false;
    let ok = true;
    for (let r = header ? 1 : 0; r < t.rows.length; r++) {
      const v = cellAt(t, r, c).trim();
      if (v === "") continue;
      if (!Number.isFinite(Number(v))) {
        ok = false;
        break;
      }
      seen = true;
    }
    out.push(ok && seen);
  }
  return out;
}

/** File-order indices of the data rows shown (header row excluded when `header`). */
export function rowOrder(
  t: ParsedTable,
  o: { header: boolean; sort?: TableSort; filter?: string },
): number[] {
  let order: number[] = [];
  for (let r = o.header ? 1 : 0; r < t.rows.length; r++) order.push(r);

  const needle = o.filter?.trim().toLowerCase();
  if (needle) {
    order = order.filter((r) =>
      t.rows[r].cells.some((c) => c.toLowerCase().includes(needle)),
    );
  }

  const sort = o.sort;
  if (sort) {
    const numeric = numericColumns(t, o.header)[sort.col] ?? false;
    const sign = sort.dir === "asc" ? 1 : -1;
    const collator = new Intl.Collator(undefined, {
      sensitivity: "base",
      numeric: true,
    });
    const keyed = order.map((r) => {
      const v = cellAt(t, r, sort.col);
      return { r, v, empty: v.trim() === "", n: numeric ? Number(v) : 0 };
    });
    // Array.prototype.sort is stable.
    keyed.sort((a, b) => {
      if (a.empty || b.empty) return Number(a.empty) - Number(b.empty);
      const d = numeric ? a.n - b.n : collator.compare(a.v, b.v);
      return sign * d;
    });
    order = keyed.map((k) => k.r);
  }
  return order;
}

/** Shift indices >= at by count, then place at..at+count-1 right after position `afterShown` (-1 = front). */
export function orderAfterInsert(
  order: number[],
  at: number,
  count: number,
  afterShown: number,
): number[] {
  const shifted = order.map((i) => (i >= at ? i + count : i));
  const added = Array.from({ length: count }, (_, k) => at + k);
  shifted.splice(afterShown + 1, 0, ...added);
  return shifted;
}

export function orderAfterDelete(
  order: number[],
  deleted: readonly number[],
): number[] {
  const gone = new Set(deleted);
  const sorted = [...gone].sort((a, b) => a - b);
  return order
    .filter((i) => !gone.has(i))
    .map((i) => {
      let below = 0;
      for (const d of sorted) {
        if (d < i) below++;
        else break;
      }
      return i - below;
    });
}

/** Initial widths in px from the header and the first 200 rows; each clamped to 56..360. */
export function guessWidths(
  t: ParsedTable,
  header: boolean,
  charPx: number,
): number[] {
  const out: number[] = [];
  const last = Math.min(t.rows.length, (header ? 1 : 0) + WIDTH_SAMPLE_ROWS);
  for (let c = 0; c < t.width; c++) {
    let chars = 0;
    if (header && t.rows.length > 0)
      chars = Math.max(chars, cellAt(t, 0, c).length);
    for (let r = header ? 1 : 0; r < last; r++)
      chars = Math.max(chars, cellAt(t, r, c).length);
    out.push(
      Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, chars * charPx + PADDING)),
    );
  }
  return out;
}

export const NEXT_SORT = (
  s: TableSort | undefined,
  col: number,
): TableSort | undefined => {
  if (!s || s.col !== col) return { col, dir: "asc" };
  return s.dir === "asc" ? { col, dir: "desc" } : undefined;
};
