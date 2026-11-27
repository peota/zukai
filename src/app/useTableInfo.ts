import { useCallback, useEffect, useRef, useState } from "react";
import type { TableInfo, TableUnreadable, TabState } from "../model/types";
import type { Delimiter } from "../table/parse";

interface Entry {
  /** Rows and columns, while they are still the text's. */
  info: TableInfo | null;
  /** The Delimiter last read, kept for the status bar's chip. */
  delimiter?: Delimiter;
}

/** `m` without the keys `keep` doesn't hold; `m` itself when none go. */
function pruned<T>(
  m: Readonly<Record<string, T>>,
  keep: ReadonlySet<string>,
): Readonly<Record<string, T>> {
  const gone = Object.keys(m).filter((id) => !keep.has(id));
  if (gone.length === 0) return m;
  const next = { ...m };
  for (const id of gone) delete next[id];
  return next;
}

/**
 * Each Table Tab's rows, columns and Delimiter, as its grid reported them,
 * and its Unreadable notice. The counts hold only while the grid watches the
 * text: switching to raw text drops them (raw edits would leave them stale),
 * and they come back when the grid reads the text again. Outside changes in
 * the grid are re-read and re-reported by the grid itself. A closed Tab's
 * entries go, with what its grid kept in `gridMemory`.
 */
export function useTableInfo(tabs: readonly TabState[]) {
  const [entries, setEntries] = useState<Readonly<Record<string, Entry>>>({});
  const [notices, setNotices] = useState<
    Readonly<Record<string, TableUnreadable>>
  >({});
  const raw = tabs
    .filter((t) => t.kind === "table" && t.tableView === "raw")
    .map((t) => t.id)
    .join("|");
  const rawIds = raw ? raw.split("|") : [];
  const onTableInfo = useCallback(
    (id: string, info: TableInfo | null) =>
      setEntries((m) => {
        const was = m[id];
        const delimiter = info?.delimiter ?? was?.delimiter;
        if (was && was.info === info && was.delimiter === delimiter) return m;
        return { ...m, [id]: { info, delimiter } };
      }),
    [],
  );
  const onTableNotice = useCallback(
    (id: string, notice: TableUnreadable | null) =>
      setNotices((m) => {
        const was = m[id];
        if (!notice) {
          if (!was) return m;
          const next = { ...m };
          delete next[id];
          return next;
        }
        if (was?.line === notice.line && was.reason === notice.reason) return m;
        return { ...m, [id]: notice };
      }),
    [],
  );
  // In raw text the counts go, even a late one from a grid on its way out:
  // back in the grid, nothing shows until the grid reads the text again.
  if (rawIds.some((id) => entries[id]?.info)) {
    const next = { ...entries };
    for (const id of rawIds) {
      if (next[id]?.info) next[id] = { ...next[id], info: null };
    }
    setEntries(next);
  }
  // A closed Tab's entries go.
  const open = new Set(tabs.map((t) => t.id));
  const keptEntries = pruned(entries, open);
  if (keptEntries !== entries) setEntries(keptEntries);
  const keptNotices = pruned(notices, open);
  if (keptNotices !== notices) setNotices(keptNotices);

  // A closed Table Tab's grid memory goes too. Only Table Tabs: closing a
  // Text Tab never loads the Table code.
  const tableIds = tabs
    .filter((t) => t.kind === "table")
    .map((t) => t.id)
    .join("|");
  const openIds = tabs.map((t) => t.id).join("|");
  /** Every Table Tab seen and still open (one may have become Text). */
  const seenTables = useRef<string[]>([]);
  useEffect(() => {
    const ids = new Set(openIds.split("|"));
    const gone = seenTables.current.filter((id) => !ids.has(id));
    const kept = seenTables.current.filter((id) => ids.has(id));
    for (const id of tableIds ? tableIds.split("|") : [])
      if (!kept.includes(id)) kept.push(id);
    seenTables.current = kept;
    if (gone.length === 0) return;
    void import("../table/gridMemory").then(
      (m) => gone.forEach((id) => m.forget(id)),
      () => {},
    );
  }, [openIds, tableIds]);

  const infoOf = (id: string): TableInfo | undefined =>
    rawIds.includes(id) ? undefined : (entries[id]?.info ?? undefined);
  const delimiterOf = (id: string): Delimiter | undefined =>
    entries[id]?.delimiter;
  const noticeOf = (id: string): TableUnreadable | null => notices[id] ?? null;
  return { onTableInfo, infoOf, delimiterOf, onTableNotice, noticeOf };
}
