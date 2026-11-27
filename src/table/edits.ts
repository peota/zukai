import type { Delimiter, Eol, ParsedTable, Row } from "./parse";

/** Offsets are into the original text; changes are sorted and non-overlapping. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** `table` equals the parse of the text after `changes` are applied. */
export interface EditResult {
  changes: TextChange[];
  table: ParsedTable;
}

export function encodeCell(
  value: string,
  delimiter: Delimiter,
  quote: boolean,
): string {
  const needs =
    quote ||
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");
  return needs ? `"${value.replace(/"/g, '""')}"` : value;
}

export function applyChanges(
  text: string,
  changes: readonly TextChange[],
): string {
  let out = "";
  let pos = 0;
  for (const c of changes) {
    out += text.slice(pos, c.from) + c.insert;
    pos = c.to;
  }
  return out + text.slice(pos);
}

function shift(row: Row, d: number): Row {
  if (d === 0) return row;
  return {
    ...row,
    start: row.start + d,
    end: row.end + d,
    cellStart: row.cellStart.map((p) => p + d),
    cellEnd: row.cellEnd.map((p) => p + d),
  };
}

function finish(t: ParsedTable, rows: Row[]): ParsedTable {
  let width = 0;
  let allQuoted = rows.length > 0;
  for (const r of rows) {
    width = Math.max(width, r.cells.length);
    if (allQuoted && !r.quoted.every(Boolean)) allQuoted = false;
  }
  return { rows, delimiter: t.delimiter, allQuoted, width };
}

/** A row edited in its own original coordinates, plus the one change that did it. */
interface RowEdit {
  row: Row;
  change: TextChange;
}

function editRows(
  t: ParsedTable,
  edit: (row: Row, index: number) => RowEdit | null,
): EditResult {
  const changes: TextChange[] = [];
  const rows: Row[] = [];
  let delta = 0;
  t.rows.forEach((row, i) => {
    const e = edit(row, i);
    if (!e) {
      rows.push(shift(row, delta));
      return;
    }
    changes.push(e.change);
    rows.push(shift(e.row, delta));
    delta += e.change.insert.length - (e.change.to - e.change.from);
  });
  return { changes, table: finish(t, rows) };
}

export function setCell(
  t: ParsedTable,
  row: number,
  col: number,
  value: string,
): EditResult {
  const d = t.delimiter;
  return editRows(t, (r, i) => {
    if (i !== row) return null;
    if (col < r.cells.length) {
      const raw = encodeCell(value, d, r.quoted[col]);
      const delta = raw.length - (r.cellEnd[col] - r.cellStart[col]);
      const cells = r.cells.slice();
      cells[col] = value;
      const quoted = r.quoted.slice();
      quoted[col] = raw.startsWith('"');
      return {
        row: {
          ...r,
          end: r.end + delta,
          cells,
          quoted,
          cellStart: r.cellStart.map((p, k) => (k > col ? p + delta : p)),
          cellEnd: r.cellEnd.map((p, k) => (k >= col ? p + delta : p)),
        },
        change: { from: r.cellStart[col], to: r.cellEnd[col], insert: raw },
      };
    }
    // Pad the short row up to `col`, then fill it.
    const cells = r.cells.slice();
    const quoted = r.quoted.slice();
    const cellStart = r.cellStart.slice();
    const cellEnd = r.cellEnd.slice();
    let insert = "";
    let pos = r.end;
    for (let k = r.cells.length; k <= col; k++) {
      const v = k === col ? value : "";
      const raw = encodeCell(v, d, t.allQuoted);
      insert += d + raw;
      pos += 1;
      cells.push(v);
      quoted.push(raw.startsWith('"'));
      cellStart.push(pos);
      pos += raw.length;
      cellEnd.push(pos);
    }
    return {
      row: { ...r, end: pos, cells, quoted, cellStart, cellEnd },
      change: { from: r.end, to: r.end, insert },
    };
  });
}

/** New empty rows (t.width cells, or 1 if width 0) inserted so the first one gets File-order index `at`. */
export function insertRows(
  t: ParsedTable,
  at: number,
  count: number,
): EditResult {
  const d = t.delimiter;
  const w = t.width || 1;
  const cellText = encodeCell("", d, t.allQuoted);
  const rowText = Array<string>(w).fill(cellText).join(d);
  const n = t.rows.length;
  const prev = at > 0 ? t.rows[at - 1] : undefined;
  const tailNoEol = prev !== undefined && at === n && prev.eol === "";
  // The line ending the new rows use: the previous row's, else the file's first.
  let eol: Eol = prev?.eol || t.rows.find((r) => r.eol)?.eol || "\n";
  if (n === 0) eol = "\n";

  const from = tailNoEol
    ? prev.end
    : at < n
      ? t.rows[at].start
      : prev
        ? prev.end + prev.eol.length
        : 0;
  let cursor = tailNoEol ? prev.end + eol.length : from;
  let insert = tailNoEol ? eol : "";
  const added: Row[] = [];
  for (let k = 0; k < count; k++) {
    const last = tailNoEol && k === count - 1;
    const start = cursor;
    const cellStart: number[] = [];
    const cellEnd: number[] = [];
    for (let c = 0; c < w; c++) {
      cellStart.push(cursor);
      cursor += cellText.length;
      cellEnd.push(cursor);
      if (c < w - 1) cursor += d.length;
    }
    const rowEol: Eol = last ? "" : eol;
    added.push({
      start,
      end: cursor,
      eol: rowEol,
      cells: Array<string>(w).fill(""),
      cellStart,
      cellEnd,
      quoted: Array<boolean>(w).fill(cellText.startsWith('"')),
    });
    cursor += rowEol.length;
    insert += rowText + rowEol;
  }
  const total = insert.length;
  const before = t.rows.slice(0, at);
  if (tailNoEol) before[at - 1] = { ...prev, eol };
  const after = t.rows.slice(at).map((r) => shift(r, total));
  return {
    changes: [{ from, to: from, insert }],
    table: finish(t, [...before, ...added, ...after]),
  };
}

export function deleteRows(
  t: ParsedTable,
  rows: readonly number[],
): EditResult {
  const doomed = new Set(rows);
  const n = t.rows.length;
  const changes: TextChange[] = [];
  const kept: Row[] = [];
  let delta = 0;
  for (let i = 0; i < n;) {
    if (!doomed.has(i)) {
      kept.push(shift(t.rows[i], delta));
      i++;
      continue;
    }
    let b = i;
    while (b + 1 < n && doomed.has(b + 1)) b++;
    const last = t.rows[b];
    let from = t.rows[i].start;
    const to = last.end + last.eol.length;
    if (last.eol === "" && i > 0) {
      // The kept row before the run becomes the last row: drop its line ending.
      const p = kept[kept.length - 1];
      from = t.rows[i - 1].end;
      kept[kept.length - 1] = { ...p, eol: "" };
    }
    changes.push({ from, to, insert: "" });
    delta -= to - from;
    i = b + 1;
  }
  return { changes, table: finish(t, kept) };
}

/** An empty cell at index `at` in every row with ≥ at cells; `name` fills it in row 0. */
export function insertColumn(
  t: ParsedTable,
  at: number,
  name = "",
): EditResult {
  const d = t.delimiter;
  return editRows(t, (r, i) => {
    if (r.cells.length < at) return null;
    const value = i === 0 ? name : "";
    const raw = encodeCell(value, d, t.allQuoted);
    const quotedNew = raw.startsWith('"');
    const cells = r.cells.slice();
    const quoted = r.quoted.slice();
    cells.splice(at, 0, value);
    quoted.splice(at, 0, quotedNew);
    if (at < r.cells.length) {
      const len = raw.length + d.length;
      const cellStart = r.cellStart.slice();
      const cellEnd = r.cellEnd.slice();
      cellStart.splice(at, 0, r.cellStart[at]);
      cellEnd.splice(at, 0, r.cellStart[at] + raw.length);
      for (let k = at + 1; k < cellStart.length; k++) {
        cellStart[k] += len;
        cellEnd[k] += len;
      }
      return {
        row: { ...r, end: r.end + len, cells, quoted, cellStart, cellEnd },
        change: {
          from: r.cellStart[at],
          to: r.cellStart[at],
          insert: raw + d,
        },
      };
    }
    const start = r.end + d.length;
    return {
      row: {
        ...r,
        end: start + raw.length,
        cells,
        quoted,
        cellStart: [...r.cellStart, start],
        cellEnd: [...r.cellEnd, start + raw.length],
      },
      change: { from: r.end, to: r.end, insert: d + raw },
    };
  });
}

export function deleteColumn(t: ParsedTable, col: number): EditResult {
  return editRows(t, (r) => {
    const n = r.cells.length;
    if (col >= n) return null;
    if (n === 1) {
      return {
        row: {
          ...r,
          end: r.start,
          cells: [""],
          quoted: [false],
          cellStart: [r.start],
          cellEnd: [r.start],
        },
        change: { from: r.cellStart[0], to: r.cellEnd[0], insert: "" },
      };
    }
    const cells = r.cells.slice();
    const quoted = r.quoted.slice();
    cells.splice(col, 1);
    quoted.splice(col, 1);
    if (col < n - 1) {
      // Cell and the delimiter after it.
      const len = r.cellStart[col + 1] - r.cellStart[col];
      return {
        row: {
          ...r,
          end: r.end - len,
          cells,
          quoted,
          cellStart: r.cellStart
            .map((p, k) => (k > col ? p - len : p))
            .filter((_, k) => k !== col),
          cellEnd: r.cellEnd
            .map((p, k) => (k > col ? p - len : p))
            .filter((_, k) => k !== col),
        },
        change: {
          from: r.cellStart[col],
          to: r.cellStart[col + 1],
          insert: "",
        },
      };
    }
    // Last cell and the delimiter before it.
    const from = r.cellEnd[col - 1];
    return {
      row: {
        ...r,
        end: from,
        cells,
        quoted,
        cellStart: r.cellStart.slice(0, -1),
        cellEnd: r.cellEnd.slice(0, -1),
      },
      change: { from, to: r.cellEnd[col], insert: "" },
    };
  });
}
