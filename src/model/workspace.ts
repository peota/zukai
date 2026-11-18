import type { Kind } from "./kinds";
import type { TabState, WorkspaceState } from "./types";

export function newTabState(id: string, kind: Kind = "text"): TabState {
  return {
    id,
    kind,
    title: "Untitled",
    renamed: false,
    language: "plaintext",
    languagePicked: false,
    languageGuessed: false,
    selection: { anchor: 0, head: 0 },
    scrollTop: 0,
    wrap: false,
  };
}

export function newTab(
  s: WorkspaceState,
  id: string,
  kind: Kind = "text",
): WorkspaceState {
  const at = s.tabs.findIndex((t) => t.id === s.activeId) + 1;
  const tabs = [
    ...s.tabs.slice(0, at),
    newTabState(id, kind),
    ...s.tabs.slice(at),
  ];
  return { ...s, tabs, activeId: id };
}

export function findByPath(
  s: WorkspaceState,
  key: string,
  keyOf: (path: string) => string,
): TabState | undefined {
  return s.tabs.find((t) => t.file !== undefined && keyOf(t.file.path) === key);
}

/** Insert after the active Tab and activate it. */
export function openFileTab(s: WorkspaceState, tab: TabState): WorkspaceState {
  const at = s.tabs.findIndex((t) => t.id === s.activeId) + 1;
  const tabs = [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)];
  return { ...s, tabs, activeId: tab.id };
}

export function closeTab(
  s: WorkspaceState,
  id: string,
  isEmpty: boolean,
  now: number,
  keyOf: (path: string) => string,
): { state: WorkspaceState; effect: "deleted" | "closed" } {
  const index = s.tabs.findIndex((t) => t.id === id);
  if (index === -1) return { state: s, effect: "deleted" };
  const tab = s.tabs[index];
  const tabs = s.tabs.filter((t) => t.id !== id);
  let activeId = s.activeId;
  if (s.activeId === id) {
    activeId = (tabs[index] ?? tabs[index - 1])?.id ?? "";
  }
  // Closing a path again replaces its older Recently Closed entry.
  const key = tab.file ? keyOf(tab.file.path) : null;
  const older =
    key === null
      ? s.closed
      : s.closed.filter((e) => !e.tab.file || keyOf(e.tab.file.path) !== key);
  const closed = isEmpty ? s.closed : [{ tab, index, closedAt: now }, ...older];
  return {
    state: { tabs, activeId, closed },
    effect: isEmpty ? "deleted" : "closed",
  };
}

export function ensureOneTab(
  s: WorkspaceState,
  freshId: string,
): WorkspaceState {
  if (s.tabs.length > 0) return s;
  return { ...s, tabs: [newTabState(freshId)], activeId: freshId };
}

/** `index` is into `closed`, newest first. */
export function reopenClosed(
  s: WorkspaceState,
  index = 0,
): {
  state: WorkspaceState;
  reopened: TabState | null;
} {
  const entry = s.closed[index];
  if (!entry) return { state: s, reopened: null };
  const closed = s.closed.filter((_, i) => i !== index);
  const at = Math.min(entry.index, s.tabs.length);
  const tabs = [...s.tabs.slice(0, at), entry.tab, ...s.tabs.slice(at)];
  return {
    state: { tabs, activeId: entry.tab.id, closed },
    reopened: entry.tab,
  };
}

export function activate(s: WorkspaceState, id: string): WorkspaceState {
  if (!s.tabs.some((t) => t.id === id)) return s;
  return { ...s, activeId: id };
}

export function activateIndex(s: WorkspaceState, n: number): WorkspaceState {
  if (s.tabs.length === 0) return s;
  const tab =
    n === 9
      ? s.tabs[s.tabs.length - 1]
      : n >= 1 && n <= 8
        ? s.tabs[n - 1]
        : undefined;
  return tab ? { ...s, activeId: tab.id } : s;
}

export function cycle(s: WorkspaceState, dir: 1 | -1): WorkspaceState {
  const len = s.tabs.length;
  if (len === 0) return s;
  const cur = s.tabs.findIndex((t) => t.id === s.activeId);
  const next = (cur + dir + len) % len;
  return { ...s, activeId: s.tabs[next].id };
}

export function moveTab(
  s: WorkspaceState,
  id: string,
  toIndex: number,
): WorkspaceState {
  const from = s.tabs.findIndex((t) => t.id === id);
  if (from === -1) return s;
  const rest = s.tabs.filter((t) => t.id !== id);
  const to = Math.max(0, Math.min(toIndex, rest.length));
  return {
    ...s,
    tabs: [...rest.slice(0, to), s.tabs[from], ...rest.slice(to)],
  };
}

export function rename(
  s: WorkspaceState,
  id: string,
  name: string,
  derived: string,
): WorkspaceState {
  const trimmed = name.trim();
  const patch: Partial<TabState> = trimmed
    ? { title: trimmed, renamed: true }
    : { title: derived, renamed: false };
  return updateTab(s, id, patch);
}

export function updateTab(
  s: WorkspaceState,
  id: string,
  patch: Partial<TabState>,
): WorkspaceState {
  return {
    ...s,
    tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  };
}

/**
 * `path` with `from` (or any path under it) moved to `to`, or null when it
 * isn't at or under `from`. Compared by `keyOf`, so another spelling of the
 * same prefix matches; the rest of the path is kept as it was.
 */
export function movedPath(
  path: string,
  from: string,
  to: string,
  keyOf: (p: string) => string,
): string | null {
  const p = keyOf(path);
  const f = keyOf(from);
  if (p === f) return to;
  const c = path[from.length];
  if (p.startsWith(f) && (c === "/" || c === "\\")) {
    return to + path.slice(from.length);
  }
  return null;
}

const lastName = (p: string) =>
  p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);

/**
 * After a Library rename or move: every open Tab and Recently Closed entry
 * whose File path is a key of `moved` (old path → new path, exactly as Rust
 * granted it) gets the new path; any other path is left alone. A File
 * whose name changed is retitled; held state (shadows are keyed by Tab id)
 * is kept.
 */
export function rewritePaths(
  s: WorkspaceState,
  moved: ReadonlyMap<string, string>,
): WorkspaceState {
  const fix = (t: TabState): TabState => {
    if (!t.file) return t;
    const path = moved.get(t.file.path);
    if (path === undefined || path === t.file.path) return t;
    const name = lastName(path);
    const title = name !== lastName(t.file.path) ? name : t.title;
    return { ...t, title, file: { ...t.file, path } };
  };
  const tabs = s.tabs.map(fix);
  const closed = s.closed.map((e) => {
    const tab = fix(e.tab);
    return tab === e.tab ? e : { ...e, tab };
  });
  const same =
    tabs.every((t, i) => t === s.tabs[i]) &&
    closed.every((e, i) => e === s.closed[i]);
  return same ? s : { ...s, tabs, closed };
}
