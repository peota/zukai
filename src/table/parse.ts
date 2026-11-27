export type Delimiter = "," | ";" | "\t" | "|";
export type Eol = "" | "\n" | "\r\n";

export interface Row {
  /** The record's text is text.slice(start, end), excluding its line ending. */
  start: number;
  end: number;
  /** The line ending after this record ("" only for a last row with no final newline). */
  eol: Eol;
  /** Unquoted values. */
  cells: string[];
  /** cellStart[i]..cellEnd[i] is cell i's raw text, quotes included. */
  cellStart: number[];
  cellEnd: number[];
  quoted: boolean[];
}

export interface ParsedTable {
  /** File order; rows[0] is the header row when Header row is on. */
  rows: Row[];
  delimiter: Delimiter;
  /** At least one field, and every field of every row is quoted. */
  allQuoted: boolean;
  /** Max cell count over all rows. */
  width: number;
}

export type ParseResult =
  | { ok: true; table: ParsedTable }
  | { ok: false; line: number; reason: "unclosedQuote" | "inconsistent" };

export const DELIMITER_NAMES: Record<Delimiter, string> = {
  ",": "Comma",
  ";": "Semicolon",
  "\t": "Tab",
  "|": "Pipe",
};

/** Tie-break order for the guess. */
const CANDIDATES: Delimiter[] = [",", ";", "\t", "|"];
const GUESS_RECORDS = 100;
const CONSISTENT_SHARE = 0.9;

type Scan =
  | { ok: true; rows: Row[] }
  | { ok: false; line: number; reason: "unclosedQuote" };

/** Single pass over the text; stops after `maxRows` records when given. */
function scan(text: string, delimiter: Delimiter, maxRows = Infinity): Scan {
  const rows: Row[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n && rows.length < maxRows) {
    const row: Row = {
      start: i,
      end: i,
      eol: "",
      cells: [],
      cellStart: [],
      cellEnd: [],
      quoted: [],
    };
    for (;;) {
      // One field, starting at i.
      const fieldStart = i;
      let value = "";
      const quoted = text[i] === '"';
      if (quoted) {
        const openLine = line;
        i++;
        for (;;) {
          if (i >= n)
            return { ok: false, line: openLine, reason: "unclosedQuote" };
          const ch = text[i];
          if (ch === '"') {
            if (text[i + 1] === '"') {
              value += '"';
              i += 2;
              continue;
            }
            i++;
            break;
          }
          if (ch === "\n") line++;
          value += ch;
          i++;
        }
      }
      // Rest of the field (all of it when unquoted).
      while (i < n) {
        const ch = text[i];
        if (ch === delimiter || ch === "\n") break;
        if (ch === "\r" && text[i + 1] === "\n") break;
        value += ch;
        i++;
      }
      row.cells.push(value);
      row.cellStart.push(fieldStart);
      row.cellEnd.push(i);
      row.quoted.push(quoted);
      if (i < n && text[i] === delimiter) {
        i++;
        continue;
      }
      break;
    }
    row.end = i;
    if (text[i] === "\r") {
      row.eol = "\r\n";
      i += 2;
      line++;
    } else if (text[i] === "\n") {
      row.eol = "\n";
      i++;
      line++;
    }
    rows.push(row);
  }
  return { ok: true, rows };
}

export function parseTable(text: string, delimiter: Delimiter): ParseResult {
  const scanned = scan(text, delimiter);
  if (!scanned.ok) return scanned;
  const { rows } = scanned;
  let width = 0;
  let allQuoted = rows.length > 0;
  for (const row of rows) {
    width = Math.max(width, row.cells.length);
    if (allQuoted && !row.quoted.every(Boolean)) allQuoted = false;
  }
  return { ok: true, table: { rows, delimiter, allQuoted, width } };
}

/** The field count a candidate delimiter gives, when consistent; else 0. */
function consistentFields(text: string, delimiter: Delimiter): number {
  const scanned = scan(text, delimiter, GUESS_RECORDS);
  if (!scanned.ok || scanned.rows.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const row of scanned.rows) {
    const k = row.cells.length;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = 0;
  for (const [k, count] of counts) {
    if (k > 1 && count >= CONSISTENT_SHARE * scanned.rows.length) best = k;
  }
  return best;
}

/** null: candidates appear but none is consistent → Unreadable. */
export function guessDelimiter(text: string, path: string): Delimiter | null {
  if (/\.tsv$/i.test(path)) return "\t";
  let best: Delimiter | null = null;
  let bestFields = 0;
  let anyOccurs = false;
  for (const candidate of CANDIDATES) {
    const scanned = scan(text, candidate, GUESS_RECORDS);
    if (scanned.ok && scanned.rows.some((r) => r.cells.length > 1))
      anyOccurs = true;
    const fields = consistentFields(text, candidate);
    if (fields > bestFields) {
      best = candidate;
      bestFields = fields;
    }
  }
  if (best) return best;
  return anyOccurs ? null : ",";
}

/** guessDelimiter (or `override`) then parseTable. */
export function readTable(
  text: string,
  path: string,
  override?: Delimiter,
): ParseResult {
  const delimiter = override ?? guessDelimiter(text, path);
  if (!delimiter) return { ok: false, line: 1, reason: "inconsistent" };
  return parseTable(text, delimiter);
}
