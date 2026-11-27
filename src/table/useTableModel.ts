import { useCallback, useEffect, useRef, useState } from "react";
import type { TextBridge } from "../editor/EditorHost";
import type { EditResult } from "./edits";
import type { Delimiter, ParsedTable } from "./parse";
import { WORKER_THRESHOLD, parseAsync } from "./parseAsync";

export type TableModel =
  | { status: "reading" }
  | {
      status: "unreadable";
      line: number;
      reason: "unclosedQuote" | "inconsistent";
    }
  | { status: "ready"; table: ParsedTable; seq: number }; // seq bumps on every re-parse (path, override or outside change); apply never bumps it

/**
 * Keeps a parsed table in sync with a Tab's text. Outside changes (typing,
 * reloads, undo, redo) re-parse; `apply` writes an edit through the bridge and
 * adopts its already-parsed table.
 */
export function useTableModel(
  bridge: TextBridge | null,
  id: string,
  path: string,
  override: Delimiter | undefined,
  parse: typeof parseAsync = parseAsync,
): { model: TableModel; apply(edit: EditResult): boolean } {
  const [model, setModel] = useState<TableModel>({ status: "reading" });
  /** Bumped by every parse request; older parses are stale. */
  const version = useRef(0);
  const seq = useRef(-1);
  /** The exact text the current ready table describes. */
  const parsedFrom = useRef<string | null>(null);
  /** True from a parse request until a current parse settles. */
  const pending = useRef(false);
  const owner = useRef<{ bridge: TextBridge | null; id: string } | null>(null);
  const live = useRef({ bridge, id });
  useEffect(() => {
    live.current = { bridge, id };
  }, [bridge, id]);

  useEffect(() => {
    if (!bridge) return;
    if (owner.current?.bridge !== bridge || owner.current.id !== id) {
      owner.current = { bridge, id };
      seq.current = -1;
      parsedFrom.current = null;
      setModel({ status: "reading" });
    }
    pending.current = true;
    let alive = true;
    let unsubscribe: (() => void) | undefined;

    const load = (text: string) => {
      const mine = ++version.current;
      pending.current = true;
      if (text.length > WORKER_THRESHOLD) setModel({ status: "reading" });
      parse(text, path, override).then(
        (r) => {
          if (!alive || mine !== version.current) return;
          pending.current = false;
          if (r.ok) {
            parsedFrom.current = text;
            seq.current += 1;
            setModel({ status: "ready", table: r.table, seq: seq.current });
          } else {
            setModel({ status: "unreadable", line: r.line, reason: r.reason });
          }
        },
        () => {
          if (!alive || mine !== version.current) return;
          pending.current = false;
          parsedFrom.current = null;
          setModel({ status: "reading" });
        },
      );
    };

    bridge.ready(id).then(
      () => {
        if (!alive) return;
        const text = bridge.text(id);
        if (text !== null) load(text);
        unsubscribe = bridge.onOutsideChange(id, load);
      },
      () => {},
    );
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [bridge, id, path, override, parse]);

  const apply = useCallback(
    (edit: EditResult): boolean => {
      const { bridge, id } = live.current;
      if (!bridge || bridge.readOnly(id)) return false;
      if (model.status !== "ready" || pending.current) return false;
      if (bridge.text(id) !== parsedFrom.current) return false;
      bridge.change(id, edit.changes);
      parsedFrom.current = bridge.text(id);
      setModel({ status: "ready", table: edit.table, seq: model.seq });
      return true;
    },
    [model],
  );

  return { model, apply };
}
