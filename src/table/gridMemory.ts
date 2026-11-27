import type { Delimiter, ParsedTable } from "./parse";

/**
 * Per-Tab grid memory for this window's life (never in the Session): where
 * each grid was, and the last table read from each Tab's text. A grid
 * unmounts on every Tab switch or Split change; coming back restores its
 * place and, when the text hasn't changed, its table without a parse.
 */

/** A grid's scroll offsets and its active cell (File-order row, column). */
export interface GridPlace {
  scrollTop: number;
  scrollLeft: number;
  row: number;
  col: number;
}

const places = new Map<string, GridPlace>();

export const placeOf = (id: string): GridPlace | undefined => places.get(id);

export function keepPlace(id: string, place: GridPlace): void {
  places.set(id, place);
}

interface Parsed {
  text: string;
  path: string;
  override: Delimiter | undefined;
  table: ParsedTable;
}

/** Tables kept at most: each holds its text and cells, so few. */
export const MAX_TABLES = 4;
/** Least recently used first (Map keeps insertion order). */
const tables = new Map<string, Parsed>();

/** Remembers `table` as read from `text` (with `path` and `override`). */
export function rememberTable(
  id: string,
  text: string,
  path: string,
  override: Delimiter | undefined,
  table: ParsedTable,
): void {
  tables.delete(id);
  tables.set(id, { text, path, override, table });
  while (tables.size > MAX_TABLES) {
    const oldest = tables.keys().next().value;
    if (oldest === undefined) break;
    tables.delete(oldest);
  }
}

/** The table read from exactly this text, path and override, if kept. */
export function recallTable(
  id: string,
  text: string,
  path: string,
  override: Delimiter | undefined,
): ParsedTable | null {
  const e = tables.get(id);
  if (!e || e.text !== text || e.path !== path || e.override !== override)
    return null;
  tables.delete(id);
  tables.set(id, e);
  return e.table;
}

/** Drops everything kept for a Tab (it closed). */
export function forget(id: string): void {
  places.delete(id);
  tables.delete(id);
}
