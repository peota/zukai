import type { WorkspaceState } from "./types";

/** How many Tab ids the Session keeps; the sidebar shows fewer. */
export const RECENT_KEEP = 20;

/**
 * `recent` (Tab ids, newest first) with `id` moved to the front. Ids that are
 * neither an open Tab nor in Recently Closed are dropped.
 */
export function touchRecent(
  recent: readonly string[],
  id: string,
  s: WorkspaceState,
): string[] {
  const known = new Set([
    ...s.tabs.map((t) => t.id),
    ...s.closed.map((e) => e.tab.id),
  ]);
  return [id, ...recent.filter((r) => r !== id)]
    .filter((r) => known.has(r))
    .slice(0, RECENT_KEEP);
}
