import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TextBridge } from "../editor/EditorHost";
import { fakeBridge } from "../rich/richTestKit";
import type { EditResult } from "./edits";
import { readTable, type Delimiter, type ParseResult } from "./parse";
import { forget, MAX_TABLES, recallTable, rememberTable } from "./gridMemory";
import { WORKER_THRESHOLD } from "./parseAsync";
import { useTableModel } from "./useTableModel";

afterEach(() => forget("a"));

function setup(text: string) {
  const texts: Record<string, string> = { a: text };
  const listeners = new Set<(t: string) => void>();
  const base = fakeBridge(texts);
  const bridge: TextBridge = {
    ...base,
    onOutsideChange: (_id, cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  bridge.change = (id, changes) => {
    base.change(id, changes);
    let t = texts[id];
    for (const c of [...changes].reverse())
      t = t.slice(0, c.from) + c.insert + t.slice(c.to ?? c.from);
    texts[id] = t;
  };
  const outside = (t: string) => {
    texts.a = t;
    listeners.forEach((cb) => cb(t));
  };
  return { bridge, base, outside, listeners };
}

const sync = vi.fn(async (t: string, p: string, o?: Delimiter) =>
  readTable(t, p, o),
);

describe("useTableModel", () => {
  it("keeps the hidden ranges of the shown table while a re-parse is pending", async () => {
    // "a,secret\n": the hidden range [2, 8) covers row 0's second cell.
    const { bridge, outside } = setup("a,secret\n");
    let ranges: [number, number][] = [[2, 8]];
    bridge.hidden = () => ranges;
    let release: (() => void) | undefined;
    const slow = vi.fn(
      (t: string, p: string, o?: Delimiter) =>
        new Promise<ParseResult>((res) => {
          release = () => res(readTable(t, p, o));
        }),
    );
    const { result, rerender } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, slow),
    );
    await waitFor(() => expect(slow).toHaveBeenCalledTimes(1));
    await act(async () => release?.());
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    expect(result.current.hidden).toEqual([[2, 8]]);

    // An outside change inserts a row above: the live range moves to [9, 15),
    // which means nothing for the table still shown.
    act(() => {
      ranges = [[9, 15]];
      outside("x,y\na,secret\n");
    });
    rerender();
    expect(result.current.hidden).toEqual([[2, 8]]);

    // Once the new text is read, the live ranges apply.
    await waitFor(() => expect(slow).toHaveBeenCalledTimes(2));
    await act(async () => release?.());
    await waitFor(() => {
      const m = result.current.model;
      expect(m.status === "ready" && m.table.rows.length).toBe(2);
    });
    expect(result.current.hidden).toEqual([[9, 15]]);
  });

  it("follows live hidden ranges while nothing is pending", async () => {
    const { bridge } = setup("a,secret\n");
    let ranges: [number, number][] = [];
    bridge.hidden = () => ranges;
    const { result, rerender } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    ranges = [[2, 8]];
    rerender();
    expect(result.current.hidden).toEqual([[2, 8]]);
  });

  it("reports reading, then ready", async () => {
    sync.mockClear();
    const { bridge } = setup("a,b\n1,2\n");
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    expect(result.current.model.status).toBe("reading");
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    const m = result.current.model;
    expect(m.status === "ready" && m.seq).toBe(0);
  });

  it("stays reading when ready rejects", async () => {
    const { bridge } = setup("a\n");
    bridge.ready = () => Promise.reject(new Error("closed"));
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    await act(async () => {});
    expect(result.current.model.status).toBe("reading");
  });

  it("reports an unclosed quote as unreadable", async () => {
    const { bridge } = setup('a,b\n1,"2\n');
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    await waitFor(() => expect(result.current.model.status).toBe("unreadable"));
    expect(result.current.model).toMatchObject({
      reason: "unclosedQuote",
      line: 2,
    });
  });

  it("apply changes the text and the table without re-parsing", async () => {
    const { bridge, base } = setup("a,b\n1,2\n");
    sync.mockClear();
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    expect(sync).toHaveBeenCalledTimes(1);
    const r = readTable("a,b\n1,3\n", "x.csv");
    if (!r.ok) throw new Error("bad");
    const edit: EditResult = {
      changes: [{ from: 6, to: 7, insert: "3" }],
      table: r.table,
    };
    act(() => result.current.apply(edit));
    expect(base.change).toHaveBeenCalledWith("a", edit.changes);
    const m = result.current.model;
    expect(m.status === "ready" && m.table).toBe(r.table);
    expect(m.status === "ready" && m.seq).toBe(0);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("apply does nothing on a read-only view", async () => {
    const { bridge, base } = setup("a,b\n1,2\n");
    bridge.readOnly = () => true;
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    const before = result.current.model;
    const r = readTable("a,b\n1,3\n", "x.csv");
    if (!r.ok) throw new Error("bad");
    act(() =>
      result.current.apply({
        changes: [{ from: 6, to: 7, insert: "3" }],
        table: r.table,
      }),
    );
    expect(base.change).not.toHaveBeenCalled();
    expect(result.current.model).toBe(before);
  });

  it("re-parses an outside change and bumps seq; breaking it is unreadable", async () => {
    const { bridge, outside } = setup("a,b\n1,2\n");
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    act(() => outside("a,b\n1,2\n3,4\n"));
    await waitFor(() => {
      const m = result.current.model;
      expect(m.status === "ready" && m.seq).toBe(1);
    });
    const m = result.current.model;
    expect(m.status === "ready" && m.table.rows).toHaveLength(3);
    act(() => outside('a,b\n"1,2\n'));
    await waitFor(() => expect(result.current.model.status).toBe("unreadable"));
  });

  it("re-parses with a changed override", async () => {
    const { bridge } = setup("a;b\n1;2\n");
    const { result, rerender } = renderHook(
      ({ o }: { o: ";" | undefined }) =>
        useTableModel(bridge, "a", "x.csv", o, sync),
      { initialProps: { o: undefined as ";" | undefined } },
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    rerender({ o: ";" });
    await waitFor(() => {
      const m = result.current.model;
      expect(m.status === "ready" && m.seq).toBe(1);
    });
    const m = result.current.model;
    expect(m.status === "ready" && m.table.delimiter).toBe(";");
  });

  it("discards a stale parse", async () => {
    const { bridge, outside } = setup("a,b\n1,2\n");
    const pending: Array<(r: ParseResult) => void> = [];
    let first = true;
    const slow = vi.fn(async (t: string, p: string) => {
      if (first) {
        first = false;
        return readTable(t, p);
      }
      return new Promise<ParseResult>((res) => {
        pending.push(() => res(readTable(t, p)));
      });
    });
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, slow as never),
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    act(() => outside("a,b\n1,2\n3,4\n"));
    act(() => outside("a,b\n1,2\n3,4\n5,6\n"));
    expect(pending).toHaveLength(2);
    await act(async () => {
      pending[1](null as never);
      await Promise.resolve();
    });
    await act(async () => {
      pending[0](null as never);
      await Promise.resolve();
    });
    const m = result.current.model;
    expect(m.status === "ready" && m.table.rows).toHaveLength(4);
  });

  function edit(text: string): EditResult {
    const r = readTable(text, "x.csv");
    if (!r.ok) throw new Error("bad");
    return { changes: [{ from: 6, to: 7, insert: "9" }], table: r.table };
  }

  /** A parser whose calls after the first wait for release(). */
  function gated() {
    const waiting: Array<() => void> = [];
    let first = true;
    const fn = vi.fn((t: string, p: string, o?: Delimiter) => {
      if (first) {
        first = false;
        return Promise.resolve(readTable(t, p, o));
      }
      return new Promise<ParseResult>((res, rej) => {
        waiting.push(() => res(readTable(t, p, o)));
        void rej;
      });
    });
    return { fn, release: () => waiting.splice(0).forEach((f) => f()) };
  }

  it("refuses apply while an outside re-parse is pending", async () => {
    const { bridge, base, outside } = setup("a,b\n1,2\n");
    const g = gated();
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, g.fn),
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    act(() => outside("a,b\n1,2\n3,4\n"));
    let ok = true;
    act(() => {
      ok = result.current.apply(edit("a,b\n1,9\n"));
    });
    expect(ok).toBe(false);
    expect(base.change).not.toHaveBeenCalled();
    await act(async () => g.release());
    const m = result.current.model;
    expect(m.status === "ready" && m.table.rows).toHaveLength(3);
  });

  it("refuses apply while an override re-parse is pending", async () => {
    const { bridge, base } = setup("a;b\n1;2\n");
    const g = gated();
    const { result, rerender } = renderHook(
      ({ o }: { o: Delimiter | undefined }) =>
        useTableModel(bridge, "a", "x.csv", o, g.fn),
      { initialProps: { o: undefined as Delimiter | undefined } },
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    rerender({ o: ";" });
    await act(async () => {});
    let ok = true;
    act(() => {
      ok = result.current.apply(edit("a;b\n1;9\n"));
    });
    expect(ok).toBe(false);
    expect(base.change).not.toHaveBeenCalled();
    await act(async () => g.release());
    const m = result.current.model;
    expect(m.status === "ready" && m.table.delimiter).toBe(";");
  });

  it("refuses apply on an unreadable model", async () => {
    const { bridge, base } = setup('a,b\n1,"2\n');
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    await waitFor(() => expect(result.current.model.status).toBe("unreadable"));
    let ok = true;
    act(() => {
      ok = result.current.apply(edit("a,b\n1,9\n"));
    });
    expect(ok).toBe(false);
    expect(base.change).not.toHaveBeenCalled();
  });

  it("goes to reading when a current re-parse fails", async () => {
    const { bridge, base, outside } = setup("a,b\n1,2\n");
    let first = true;
    const flaky = vi.fn(async (t: string, p: string) => {
      if (first) {
        first = false;
        return readTable(t, p);
      }
      throw new Error("worker died");
    });
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, flaky),
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    act(() => outside("a,b\n1,2\n3,4\n"));
    await waitFor(() => expect(result.current.model.status).toBe("reading"));
    let ok = true;
    act(() => {
      ok = result.current.apply(edit("a,b\n1,9\n"));
    });
    expect(ok).toBe(false);
    expect(base.change).not.toHaveBeenCalled();
  });

  it("refuses apply when the text changed out of band", async () => {
    const { bridge, base } = setup("a,b\n1,2\n");
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    bridge.text = () => "something else";
    let ok = true;
    act(() => {
      ok = result.current.apply(edit("a,b\n1,9\n"));
    });
    expect(ok).toBe(false);
    expect(base.change).not.toHaveBeenCalled();
  });

  it("allows a second apply after a successful one", async () => {
    const { bridge, base } = setup("a,b\n1,2\n");
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    let ok1 = false;
    let ok2 = false;
    act(() => {
      ok1 = result.current.apply(edit("a,b\n1,9\n"));
    });
    act(() => {
      ok2 = result.current.apply(edit("a,b\n1,9\n"));
    });
    expect(ok1 && ok2).toBe(true);
    expect(base.change).toHaveBeenCalledTimes(2);
  });

  it("a large outside change keeps the old table while it is read (busy)", async () => {
    const { bridge, outside } = setup("a,b\n1,2\n");
    const waiting: Array<() => void> = [];
    let first = true;
    const fn = vi.fn((t: string, p: string) => {
      if (first) {
        first = false;
        return Promise.resolve(readTable(t, p));
      }
      return new Promise<ParseResult>((res) =>
        waiting.push(() => res(readTable("a,b\n1,2\n3,4\n", p))),
      );
    });
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, fn),
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    const before = result.current.model;
    act(() => outside("a,b\n" + "1,2\n".repeat(WORKER_THRESHOLD / 4 + 1)));
    expect(result.current.model).toBe(before);
    expect(result.current.busy).toBe(true);
    let ok = true;
    act(() => {
      ok = result.current.apply(edit("a,b\n1,9\n"));
    });
    expect(ok).toBe(false);
    await act(async () => waiting.splice(0).forEach((f) => f()));
    expect(result.current.busy).toBe(false);
    const m = result.current.model;
    expect(m.status === "ready" && m.seq).toBe(1);
  });

  it("a remount over unchanged text adopts the kept table without a parse", async () => {
    const { bridge } = setup("a,b\n1,2\n");
    const parse = vi.fn(sync);
    const first = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, parse),
    );
    await waitFor(() =>
      expect(first.result.current.model.status).toBe("ready"),
    );
    const table =
      first.result.current.model.status === "ready" &&
      first.result.current.model.table;
    first.unmount();
    parse.mockClear();
    const again = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, parse),
    );
    // Ready on the first render: no Reading table… flash.
    const m = again.result.current.model;
    expect(m.status === "ready" && m.table).toBe(table);
    await act(async () => {});
    expect(parse).not.toHaveBeenCalled();
    // An edit still goes through.
    let ok = false;
    act(() => {
      ok = again.result.current.apply(edit("a,b\n1,9\n"));
    });
    expect(ok).toBe(true);
  });

  it("a remount over changed text (or another override) parses again", async () => {
    const { bridge, outside } = setup("a,b\n1,2\n");
    const parse = vi.fn(sync);
    const first = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, parse),
    );
    await waitFor(() =>
      expect(first.result.current.model.status).toBe("ready"),
    );
    first.unmount();
    outside("a,b\n1,2\n3,4\n");
    parse.mockClear();
    const again = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, parse),
    );
    expect(again.result.current.model.status).toBe("reading");
    await waitFor(() =>
      expect(again.result.current.model.status).toBe("ready"),
    );
    expect(parse).toHaveBeenCalledTimes(1);
    again.unmount();
    parse.mockClear();
    const third = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", ";", parse),
    );
    expect(third.result.current.model.status).toBe("reading");
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
  });

  it("forget drops the kept table", async () => {
    const { bridge } = setup("a,b\n1,2\n");
    const first = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    await waitFor(() =>
      expect(first.result.current.model.status).toBe("ready"),
    );
    first.unmount();
    forget("a");
    const again = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    expect(again.result.current.model.status).toBe("reading");
  });

  it("keeps at most a few tables", () => {
    const r = readTable("a\n", "x.csv");
    if (!r.ok) throw new Error("bad");
    for (let i = 0; i <= MAX_TABLES; i++)
      rememberTable(`k${i}`, "a\n", "x.csv", undefined, r.table);
    expect(recallTable("k0", "a\n", "x.csv", undefined)).toBeNull();
    expect(recallTable(`k${MAX_TABLES}`, "a\n", "x.csv", undefined)).toBe(
      r.table,
    );
    for (let i = 0; i <= MAX_TABLES; i++) forget(`k${i}`);
  });

  it("refuses an edit built from a table the model no longer shows", async () => {
    const { bridge, base } = setup("a,b\n1,2\n");
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    const m = result.current.model;
    const shown = m.status === "ready" ? m.table : null;
    const stale = readTable("a,b\n1,2\n", "x.csv");
    if (!stale.ok || !shown) throw new Error("bad");
    let ok = true;
    act(() => {
      ok = result.current.apply(edit("a,b\n1,9\n"), stale.table);
    });
    expect(ok).toBe(false);
    expect(base.change).not.toHaveBeenCalled();
    act(() => {
      ok = result.current.apply(edit("a,b\n1,9\n"), shown);
    });
    expect(ok).toBe(true);
  });

  it("apply reads the text once before and once after the change", async () => {
    const { bridge } = setup("a,b\n1,2\n");
    const { result } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    const text = vi.spyOn(bridge, "text");
    act(() => {
      result.current.apply(edit("a,b\n1,9\n"));
    });
    expect(text.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("unsubscribes on unmount", async () => {
    const { bridge, listeners } = setup("a\n");
    const { result, unmount } = renderHook(() =>
      useTableModel(bridge, "a", "x.csv", undefined, sync),
    );
    await waitFor(() => expect(result.current.model.status).toBe("ready"));
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
