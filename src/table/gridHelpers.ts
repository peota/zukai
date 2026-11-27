import type { Row } from "./parse";

/** What a hidden cell shows, on screen and when copied. */
export const HIDDEN_DOTS = "••••";

/** Spreadsheet-style column label: 0 → A, 25 → Z, 26 → AA. */
export function columnLabel(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** The gutter number of File-order row `fileIndex`: 1 is the first data row. */
export const recordNumber = (fileIndex: number, header: boolean): number =>
  header ? fileIndex : fileIndex + 1;

/** Whether cell `col` of `row` overlaps any hidden range (UTF-16 offsets). */
export function cellHidden(
  row: Row,
  col: number,
  hidden: readonly (readonly [number, number])[],
): boolean {
  if (hidden.length === 0 || col >= row.cells.length) return false;
  const start = row.cellStart[col];
  const end = row.cellEnd[col];
  for (const [from, to] of hidden) {
    if (start === end ? from <= start && start < to : from < end && to > start)
      return true;
  }
  return false;
}

/** One TSV field: quoted, inner quotes doubled, when it holds a tab, line break or quote. */
export function tsvField(value: string): string {
  return /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Rows of fields to TSV: cells joined by tabs, rows by "\n". */
export const toTsv = (rows: readonly (readonly string[])[]): string =>
  rows.map((r) => r.map(tsvField).join("\t")).join("\n");

/**
 * Splits `value` into plain and matching parts for a case-insensitive
 * substring `needle` (already trimmed). Odd indices are matches.
 */
export function splitMatches(value: string, needle: string): string[] {
  if (!needle) return [value];
  const hay = value.toLowerCase();
  const n = needle.toLowerCase();
  // Lowercasing can change length (e.g. "İ"); then offsets don't line up.
  if (hay.length !== value.length) return [value];
  const out: string[] = [];
  let pos = 0;
  for (;;) {
    const i = hay.indexOf(n, pos);
    if (i < 0) break;
    out.push(value.slice(pos, i), value.slice(i, i + n.length));
    pos = i + n.length;
  }
  if (out.length === 0) return [value];
  out.push(value.slice(pos));
  return out;
}
