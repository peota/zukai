import { useCallback, useState } from "react";
import type { TableInfo, TabState } from "../model/types";
import type { Delimiter } from "../table/parse";

interface Entry {
  /** Rows and columns, while they are still the text's. */
  info: TableInfo | null;
  /** The Delimiter last read, kept for the status bar's chip. */
  delimiter?: Delimiter;
}

/**
 * Each Table Tab's rows, columns and Delimiter, as its grid reported them.
 * The counts hold only while the grid watches the text: switching to raw text
 * drops them (raw edits would leave them stale), and they come back when the
 * grid reads the text again. Outside changes in the grid are re-read and
 * re-reported by the grid itself.
 */
export function useTableInfo(tabs: readonly TabState[]) {
  const [entries, setEntries] = useState<Readonly<Record<string, Entry>>>({});
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
  // In raw text the counts go, even a late one from a grid on its way out:
  // back in the grid, nothing shows until the grid reads the text again.
  if (rawIds.some((id) => entries[id]?.info)) {
    const next = { ...entries };
    for (const id of rawIds) {
      if (next[id]?.info) next[id] = { ...next[id], info: null };
    }
    setEntries(next);
  }

  const infoOf = (id: string): TableInfo | undefined =>
    rawIds.includes(id) ? undefined : (entries[id]?.info ?? undefined);
  const delimiterOf = (id: string): Delimiter | undefined =>
    entries[id]?.delimiter;
  return { onTableInfo, infoOf, delimiterOf };
}
