import type { EditorState } from "@codemirror/state";
import type { SearchQuery } from "@codemirror/search";

export interface MatchCount {
  total: number;
  /** 1-based index of the match equal to the main selection, or 0. */
  current: number;
  /** True when counting stopped at the limit; show `${limit}+`. */
  capped: boolean;
}

/**
 * Count the matches of `query`, stopping at `limit` so a huge document stays
 * responsive. Invalid or empty queries count as zero. Empty regex matches
 * (`^`, `a*`, `\b`) are safe: CodeMirror's cursors step past them.
 */
export function countMatches(
  state: EditorState,
  query: SearchQuery,
  limit = 10_000,
): MatchCount {
  if (!query.valid) return { total: 0, current: 0, capped: false };
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    if (total === limit) return { total, current, capped: true };
    total++;
    if (r.value.from === from && r.value.to === to) current = total;
  }
  return { total, current, capped: false };
}
