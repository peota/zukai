import { useCallback, useEffect, useRef, useState } from "react";
import type { TextBridge } from "../editor/EditorHost";
import type { EditResult } from "./edits";
import { recallTable, rememberTable } from "./gridMemory";
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

/** What a table was read with, besides its text. */
const keyOf = (path: string, override: Delimiter | undefined) =>
  `${path}\0${override ?? ""}`;

/**
 * Keeps a parsed table in sync with a Tab's text. Outside changes (typing,
 * reloads, undo, redo) re-parse; `apply` writes an edit through the bridge and
 * adopts its already-parsed table. While a re-parse is pending the last table
 * stays shown (`busy` while a large one is read off the main thread), and
 * `apply` refuses. A remount over unchanged text adopts the table kept in
 * `gridMemory` without a parse.
 */
export function useTableModel(
  bridge: TextBridge | null,
  id: string,
  path: string,
  override: Delimiter | undefined,
  parse: typeof parseAsync = parseAsync,
): {
  model: TableModel;
  busy: boolean;
  /**
   * The Hidden ranges that line up with the shown table: the live ones,
   * except while a re-parse is pending, when the live ones already point into
   * the new text and the ones captured with the shown table are kept.
   */
  hidden: readonly [number, number][];
  /**
   * Writes `edit`. `base` is the table the edit was built from: refused
   * unless it is the table the model shows now.
   */
  apply(edit: EditResult, base?: ParsedTable): boolean;
} {
  // A table kept from this Tab's last grid, if the text is still the same.
  const [kept] = useState(() => {
    const text = bridge?.text(id) ?? null;
    const table = text === null ? null : recallTable(id, text, path, override);
    return table && text !== null ? { text, table } : null;
  });
  const [model, setModel] = useState<TableModel>(
    kept
      ? { status: "ready", table: kept.table, seq: 0 }
      : { status: "reading" },
  );
  const [busy, setBusy] = useState(false);
  /**
   * While a re-parse is pending: the Hidden ranges captured with the shown
   * table (the live ones already point into the new text). Null otherwise.
   */
  const [frozenHidden, setFrozenHidden] = useState<
    readonly [number, number][] | null
  >(null);
  /** Bumped by every parse request; older parses are stale. */
  const version = useRef(0);
  const seq = useRef(kept ? 0 : -1);
  /** The exact text the current ready table describes, and what with. */
  const parsedFrom = useRef<string | null>(kept?.text ?? null);
  const parsedWith = useRef<string | null>(kept ? keyOf(path, override) : null);
  /** The table the model exposes now (null unless ready). */
  const shown = useRef<ParsedTable | null>(kept?.table ?? null);
  /** True from a parse request until a current parse settles. */
  const pending = useRef(false);
  /** The Hidden ranges as they were for `parsedFrom`. */
  const hiddenFrom = useRef<readonly [number, number][]>(
    kept ? (bridge?.hidden(id) ?? NO_HIDDEN) : NO_HIDDEN,
  );
  const owner = useRef<{ bridge: TextBridge | null; id: string } | null>(
    kept ? { bridge, id } : null,
  );
  const live = useRef({ bridge, id, path, override });
  useEffect(() => {
    live.current = { bridge, id, path, override };
  }, [bridge, id, path, override]);

  useEffect(() => {
    if (!bridge) return;
    if (owner.current?.bridge !== bridge || owner.current.id !== id) {
      owner.current = { bridge, id };
      seq.current = -1;
      parsedFrom.current = null;
      parsedWith.current = null;
      shown.current = null;
      setModel({ status: "reading" });
    }
    pending.current = true;
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    const key = keyOf(path, override);

    const load = (text: string) => {
      const mine = ++version.current;
      pending.current = true;
      setFrozenHidden(hiddenFrom.current);
      // The old table stays shown; a long read says so in the top bar.
      if (text.length > WORKER_THRESHOLD) setBusy(true);
      parse(text, path, override).then(
        (r) => {
          if (!alive || mine !== version.current) return;
          pending.current = false;
          setBusy(false);
          setFrozenHidden(null);
          if (r.ok) {
            parsedFrom.current = text;
            hiddenFrom.current = bridge.hidden(id);
            parsedWith.current = key;
            shown.current = r.table;
            seq.current += 1;
            rememberTable(id, text, path, override, r.table);
            setModel({ status: "ready", table: r.table, seq: seq.current });
          } else {
            parsedFrom.current = null;
            shown.current = null;
            setModel({ status: "unreadable", line: r.line, reason: r.reason });
          }
        },
        () => {
          if (!alive || mine !== version.current) return;
          pending.current = false;
          setBusy(false);
          setFrozenHidden(null);
          parsedFrom.current = null;
          shown.current = null;
          setModel({ status: "reading" });
        },
      );
    };

    bridge.ready(id).then(
      () => {
        if (!alive) return;
        const text = bridge.text(id);
        if (text !== null) {
          if (text === parsedFrom.current && parsedWith.current === key) {
            // Already read (a kept table): nothing to parse.
            hiddenFrom.current = bridge.hidden(id);
            version.current++;
            pending.current = false;
            setBusy(false);
          } else {
            load(text);
          }
        }
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
    (edit: EditResult, base?: ParsedTable): boolean => {
      const { bridge, id, path, override } = live.current;
      if (!bridge || bridge.readOnly(id)) return false;
      if (model.status !== "ready" || pending.current) return false;
      if (!shown.current) return false;
      if (base !== undefined && base !== shown.current) return false;
      if (bridge.text(id) !== parsedFrom.current) return false;
      bridge.change(id, edit.changes);
      const text = bridge.text(id);
      parsedFrom.current = text;
      hiddenFrom.current = bridge.hidden(id);
      shown.current = edit.table;
      if (text !== null) rememberTable(id, text, path, override, edit.table);
      setModel({ status: "ready", table: edit.table, seq: seq.current });
      return true;
    },
    [model.status],
  );

  const hidden = frozenHidden ?? bridge?.hidden(id) ?? NO_HIDDEN;
  return { model, busy, hidden, apply };
}

const NO_HIDDEN: readonly [number, number][] = [];
