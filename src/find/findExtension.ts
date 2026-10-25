import type { EditorState, Extension } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";
import { getSearchQuery, search, type SearchQuery } from "@codemirror/search";

export type FindMode = "find" | "replace";

interface Range {
  from: number;
  to: number;
}

/** Backward search scans chunks of this size, growing until it finds one. */
const CHUNK = 10_000;

/**
 * First match starting in [pos, end), skipping the one equal to `skip`.
 * Empty matches equal to the selection are skipped too, so stepping always
 * moves on, even for `^`, `a*` or ``.
 */
function matchFrom(
  state: EditorState,
  query: SearchQuery,
  pos: number,
  end = Infinity,
  skip?: Range,
): Range | null {
  const cursor = query.getCursor(state, pos);
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    const m = r.value;
    if (m.from >= end) return null;
    if (skip && m.from === skip.from && m.to === skip.to) continue;
    return { from: m.from, to: m.to };
  }
  return null;
}

/** Last match starting in [lo, hi), scanning backwards in growing chunks. */
function matchBefore(
  state: EditorState,
  query: SearchQuery,
  lo: number,
  hi: number,
): Range | null {
  for (let size = 1; ; size *= 2) {
    const start = Math.max(lo, hi - size * CHUNK);
    const cursor = query.getCursor(state, start);
    let found: Range | null = null;
    for (
      let r = cursor.next();
      !r.done && r.value.from < hi;
      r = cursor.next()
    ) {
      found = { from: r.value.from, to: r.value.to };
    }
    // A match right at the chunk start may be misaligned; widen and retry.
    if (start === lo || (found && found.from > start + 1000)) return found;
  }
}

/**
 * The first match at or after `pos`, wrapping to the start of the document.
 * Used for incremental search while typing.
 */
export function firstMatchAtOrAfter(
  state: EditorState,
  query: SearchQuery,
  pos: number,
): Range | null {
  if (!query.valid) return null;
  return matchFrom(state, query, pos) ?? matchFrom(state, query, 0, pos);
}

/**
 * Next match after the main selection, wrapping around. Unlike
 * CodeMirror's `findNext`, an empty match equal to the selection is stepped
 * over, so the selection always advances.
 */
export function nextMatch(
  state: EditorState,
  query: SearchQuery,
): Range | null {
  if (!query.valid) return null;
  const { from, to } = state.selection.main;
  return (
    matchFrom(state, query, from, Infinity, { from, to }) ??
    matchFrom(state, query, 0, from + 1)
  );
}

/** Previous match before the main selection, wrapping around. */
export function previousMatch(
  state: EditorState,
  query: SearchQuery,
): Range | null {
  if (!query.valid) return null;
  const { from } = state.selection.main;
  return (
    matchBefore(state, query, 0, from) ??
    matchBefore(state, query, from, state.doc.length + 1)
  );
}

/** Select `range` and scroll it into view. */
export function selectMatch(view: EditorView, range: Range) {
  view.dispatch({
    selection: EditorSelection.single(range.from, range.to),
    effects: EditorView.scrollIntoView(range.from, { y: "center" }),
    userEvent: "select.search",
  });
}

/** Go to the next match of the current query. False if there is none. */
export function findNextMatch(view: EditorView): boolean {
  const r = nextMatch(view.state, getSearchQuery(view.state));
  if (r) selectMatch(view, r);
  return r !== null;
}

/** Go to the previous match of the current query. False if there is none. */
export function findPreviousMatch(view: EditorView): boolean {
  const r = previousMatch(view.state, getSearchQuery(view.state));
  if (r) selectMatch(view, r);
  return r !== null;
}

type UpdateFn = (u: ViewUpdate) => void;
const listeners = new WeakMap<EditorView, Set<UpdateFn>>();

/** Subscribe to a view's updates (the find bar recounts on them). */
export function onViewUpdate(view: EditorView, fn: UpdateFn): () => void {
  let set = listeners.get(view);
  if (!set) listeners.set(view, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

const findTheme = EditorView.theme({
  "&.cm-editor .cm-content .cm-searchMatch": {
    backgroundColor: "var(--z-accent-soft)",
    borderRadius: "2px",
  },
  "&.cm-editor .cm-content .cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--z-search-current)",
  },
  // The default panel is replaced by an empty one; hide its container.
  "&.cm-editor .cm-panels.cm-panels-top": {
    backgroundColor: "transparent",
    border: "none",
  },
});

/** The (empty) CodeMirror search panel; the React FindBar is the UI. */
function emptyPanel() {
  const dom = document.createElement("div");
  dom.className = "z-find-panel";
  dom.style.display = "none";
  return { dom, top: true };
}

/**
 * Search state, match highlighting and F3 / Shift+F3 (which use the last
 * query even while the bar is closed). With no query yet, F3 opens the bar.
 */
export function findExtension(onOpen: (mode: FindMode) => void): Extension {
  const step = (dir: 1 | -1) => (view: EditorView) => {
    if (!getSearchQuery(view.state).valid) {
      onOpen("find");
      return true;
    }
    if (dir === 1) findNextMatch(view);
    else findPreviousMatch(view);
    return true;
  };
  return [
    search({ top: true, literal: true, createPanel: emptyPanel }),
    keymap.of([
      { key: "F3", run: step(1), shift: step(-1), preventDefault: true },
    ]),
    EditorView.updateListener.of((u) => {
      listeners.get(u.view)?.forEach((fn) => fn(u));
    }),
    findTheme,
  ];
}
