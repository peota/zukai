import { useCallback, useEffect, useRef, useState } from "react";
import type { TextBridge } from "../editor/EditorHost";
import type { EditResult } from "./edits";
import type { Delimiter, ParsedTable } from "./parse";
import { parseAsync } from "./parseAsync";

export type TableModel =
  | { status: "reading" }
  | {
      status: "unreadable";
      line: number;
      reason: "unclosedQuote" | "inconsistent";
    }
  | { status: "ready"; table: ParsedTable; seq: number }; // seq bumps on every outside re-parse

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
): { model: TableModel; apply(edit: EditResult): void } {
  const [model, setModel] = useState<TableModel>({ status: "reading" });
  /** Bumped by every parse request and every apply; older parses are stale. */
  const version = useRef(0);
  const seq = useRef(-1);
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
      setModel({ status: "reading" });
    }
    let alive = true;
    let unsubscribe: (() => void) | undefined;

    const load = (text: string) => {
      const mine = ++version.current;
      parse(text, path, override).then(
        (r) => {
          if (!alive || mine !== version.current) return;
          if (r.ok) {
            seq.current += 1;
            setModel({ status: "ready", table: r.table, seq: seq.current });
          } else {
            setModel({ status: "unreadable", line: r.line, reason: r.reason });
          }
        },
        () => {},
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

  const apply = useCallback((edit: EditResult) => {
    const { bridge, id } = live.current;
    if (!bridge || bridge.readOnly(id)) return;
    bridge.change(id, edit.changes);
    version.current += 1;
    setModel((m) =>
      m.status === "ready"
        ? { status: "ready", table: edit.table, seq: m.seq }
        : m,
    );
  }, []);

  return { model, apply };
}
