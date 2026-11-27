import { useState } from "react";
import type { TextBridge } from "../editor/EditorHost";
import type { TableUnreadable, TabState } from "../model/types";
import { Bar, BarButton } from "../ui/FileBar";
import { parseAsync } from "./parseAsync";

export interface TableNoticeProps {
  tab: TabState;
  bridge: TextBridge | null;
  notice: TableUnreadable;
  /** A new reading failure, or null once the text reads as a table. */
  onNotice(notice: TableUnreadable | null): void;
  onTabPatch(id: string, patch: Partial<TabState>): void;
}

const WHY: Record<TableUnreadable["reason"], string> = {
  unclosedQuote: "a quote is never closed",
  inconsistent: "the columns don't line up",
};

/**
 * An Unreadable Table's notice, above either View. Try table view reads the
 * text again (with the Tab's Delimiter) and opens the grid only if it reads.
 */
export default function TableNotice(p: TableNoticeProps) {
  const { tab, bridge, notice } = p;
  const [busy, setBusy] = useState(false);

  const retry = () => {
    const text = bridge?.text(tab.id);
    if (text === null || text === undefined || busy) return;
    setBusy(true);
    parseAsync(text, tab.file?.path ?? tab.title, tab.delimiter)
      .then((r) => {
        if (r.ok) {
          p.onNotice(null);
          p.onTabPatch(tab.id, { tableView: "grid" });
        } else {
          p.onNotice({ line: r.line, reason: r.reason });
        }
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  return (
    <Bar
      kind="info"
      actions={
        <BarButton disabled={busy} onClick={retry}>
          Try table view
        </BarButton>
      }
    >
      {`Can't read this as a table: ${WHY[notice.reason]} (line ${notice.line})`}
    </Bar>
  );
}
