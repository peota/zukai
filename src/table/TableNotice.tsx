import { useEffect, useRef, useState } from "react";
import type { TextBridge } from "../editor/EditorHost";
import type { TableUnreadable, TabState } from "../model/types";
import { Bar, BarButton } from "../ui/FileBar";
import { checkAsync } from "./parseAsync";

export interface TableNoticeProps {
  tab: TabState;
  bridge: TextBridge | null;
  notice: TableUnreadable | null;
  /**
   * Read the text again once it's ready and after each outside change (the
   * raw text View): an Unreadable Table restored in raw text gets its notice
   * back, and fixing the text by hand clears it.
   */
  check: boolean;
  /** A new reading failure, or null once the text reads as a table. */
  onNotice(notice: TableUnreadable | null): void;
  onTabPatch(id: string, patch: Partial<TabState>): void;
}

/** Typing in raw text is read again after this pause. */
const RECHECK_MS = 300;

const WHY: Record<TableUnreadable["reason"], string> = {
  unclosedQuote: "a quote is never closed",
  inconsistent: "the columns don't line up",
};

/**
 * An Unreadable Table's notice, above either View. Try table view reads the
 * text again (with the Tab's Delimiter) and opens the grid only if it reads.
 */
export default function TableNotice(p: TableNoticeProps) {
  const { tab, bridge, notice, check } = p;
  const id = tab.id;
  const path = tab.file?.path ?? tab.title;
  const delimiter = tab.delimiter;
  const [busy, setBusy] = useState(false);
  const onNotice = useRef(p.onNotice);
  useEffect(() => {
    onNotice.current = p.onNotice;
  });

  useEffect(() => {
    if (!check || !bridge) return;
    let alive = true;
    let version = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    const run = (text: string) => {
      const mine = ++version;
      checkAsync(text, path, delimiter).then(
        (r) => {
          if (!alive || mine !== version) return;
          onNotice.current(r.ok ? null : { line: r.line, reason: r.reason });
        },
        () => {},
      );
    };
    bridge.ready(id).then(
      () => {
        if (!alive) return;
        const text = bridge.text(id);
        if (text !== null) run(text);
        unsubscribe = bridge.onOutsideChange(id, (t) => {
          clearTimeout(timer);
          timer = setTimeout(() => run(t), RECHECK_MS);
        });
      },
      () => {},
    );
    return () => {
      alive = false;
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [check, bridge, id, path, delimiter]);

  const retry = () => {
    const text = bridge?.text(tab.id);
    if (text === null || text === undefined || busy) return;
    setBusy(true);
    checkAsync(text, tab.file?.path ?? tab.title, tab.delimiter)
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

  if (!notice) return null;
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
