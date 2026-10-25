import type { TabState, WorkspaceState } from "./types";

export function newTabState(id: string): TabState {
  return {
    id,
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

export function newTab(s: WorkspaceState, id: string): WorkspaceState {
  const at = s.tabs.findIndex((t) => t.id === s.activeId) + 1;
  const tabs = [...s.tabs.slice(0, at), newTabState(id), ...s.tabs.slice(at)];
  return { ...s, tabs, activeId: id };
}

export function closeTab(
  s: WorkspaceState,
  id: string,
  isEmpty: boolean,
  now: number,
): { state: WorkspaceState; effect: "deleted" | "closed" } {
  const index = s.tabs.findIndex((t) => t.id === id);
  if (index === -1) return { state: s, effect: "deleted" };
  const tab = s.tabs[index];
  const tabs = s.tabs.filter((t) => t.id !== id);
  let activeId = s.activeId;
  if (s.activeId === id) {
    activeId = (tabs[index] ?? tabs[index - 1])?.id ?? "";
  }
  const closed = isEmpty
    ? s.closed
    : [{ tab, index, closedAt: now }, ...s.closed];
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

export function reopenClosed(s: WorkspaceState): {
  state: WorkspaceState;
  reopened: TabState | null;
} {
  if (s.closed.length === 0) return { state: s, reopened: null };
  const [entry, ...closed] = s.closed;
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
