import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TextBridge } from "../editor/EditorHost";
import type { TableInfo, TableUnreadable, TabState } from "../model/types";
import { TabPane, type TabPaneProps } from "../app/TabPane";
import TableHost, { type TableHostProps } from "./TableHost";
import type { TextChange } from "./edits";

vi.mock("../app/shortcuts", async (orig) => ({
  ...(await orig<typeof import("../app/shortcuts")>()),
  detectPlatform: () => "windows",
}));

const saved: Record<string, PropertyDescriptor | undefined> = {};
beforeAll(() => {
  for (const [k, v] of [
    ["clientHeight", 600],
    ["clientWidth", 800],
  ] as const) {
    saved[k] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, k);
    Object.defineProperty(HTMLElement.prototype, k, {
      configurable: true,
      get: () => v,
    });
  }
});
afterAll(() => {
  for (const k of ["clientHeight", "clientWidth"]) {
    const d = saved[k];
    if (d) Object.defineProperty(HTMLElement.prototype, k, d);
    else
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
  }
});

/** A bridge over one Tab's text; `outside` plays a disk reload or raw typing. */
function fakeBridge(
  text: string,
  o: { readOnly?: boolean; ready?: boolean } = {},
) {
  let current = text;
  const listeners = new Set<(t: string) => void>();
  const change = vi.fn((_id: string, changes: readonly TextChange[]) => {
    for (const c of [...changes].reverse())
      current = current.slice(0, c.from) + c.insert + current.slice(c.to);
  });
  const bridge: TextBridge = {
    text: () => current,
    replace: vi.fn(),
    change,
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    onOutsideChange: (_id, cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    clearHistory: vi.fn(),
    readOnly: () => o.readOnly ?? false,
    hidden: () => [],
    ready: () =>
      o.ready === false ? new Promise<void>(() => {}) : Promise.resolve(),
  };
  const outside = (t: string) =>
    act(async () => {
      current = t;
      listeners.forEach((cb) => cb(t));
    });
  /** Changes the text without telling anyone (raw typing seen later). */
  const set = (t: string) => {
    current = t;
  };
  return { bridge, change, outside, set, text: () => current };
}

const baseTab = (over: Partial<TabState> = {}): TabState =>
  ({
    id: "t",
    kind: "table",
    title: "t.csv",
    language: "plaintext",
    file: { path: "/t.csv", held: null },
    ...over,
  }) as unknown as TabState;

/** TableHost with its Tab kept in state, as App does. */
function host(
  text: string,
  over: Partial<TabState> = {},
  o: {
    readOnly?: boolean;
    ready?: boolean;
    filterSignal?: number;
    focused?: boolean;
    focusSignal?: number;
    focusSeen?: number;
  } = {},
) {
  const b = fakeBridge(text, o);
  const patches: Partial<TabState>[] = [];
  const infos: (TableInfo | null)[] = [];
  const notices: (TableUnreadable | null)[] = [];
  let tab = baseTab(over);
  let setSignal: (n: number) => void = () => {};
  let setFocus: (n: number) => void = () => {};
  let patchTab: (p: Partial<TabState>) => void = () => {};
  function Wrapper() {
    const [t, setT] = useState(tab);
    const [signal, setS] = useState(o.filterSignal ?? 0);
    setSignal = setS;
    const [focusSignal, setF] = useState(o.focusSignal ?? 0);
    setFocus = setF;
    patchTab = (p) => {
      tab = { ...tab, ...p };
      setT(tab);
    };
    const props: TableHostProps = {
      tab: t,
      bridge: b.bridge,
      focused: o.focused ?? true,
      fontSize: 13,
      filterSignal: signal,
      focusSignal,
      focusSeen: o.focusSeen,
      onTabPatch: (_id, p) => {
        patches.push(p);
        patchTab(p);
      },
      onInfo: (i) => infos.push(i),
      onNotice: (n) => notices.push(n),
    };
    return <TableHost {...props} />;
  }
  const utils = render(<Wrapper />);
  return {
    ...utils,
    ...b,
    patches,
    infos,
    notices,
    tab: () => tab,
    signal: (n: number) => act(() => setSignal(n)),
    focus: (n: number) => act(() => setFocus(n)),
    patch: (p: Partial<TabState>) => act(() => patchTab(p)),
  };
}

/** The shown data rows' first cells, top to bottom. */
const column0 = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelectorAll('[role="gridcell"]')[0]?.textContent);
const activeCell = () =>
  document.querySelector('[role="gridcell"][data-active]')?.textContent;
const cell = (text: string) =>
  screen.getAllByRole("gridcell").find((e) => e.textContent === text)!;
const headerCell = (label: string) =>
  screen.getAllByRole("columnheader").find((e) => e.textContent === label)!;
const ready = () => screen.findByRole("grid");
const last = <T,>(a: T[]): T | undefined => a[a.length - 1];

describe("TableHost", () => {
  it("shows Reading table… until the text is parsed", () => {
    host("a,b\n1,2\n", {}, { ready: false });
    expect(screen.getByText("Reading table…")).toBeTruthy();
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("top bar: Raw text switches the View", async () => {
    const h = host("a,b\n1,2\n");
    await ready();
    const grid = screen.getByRole("button", { name: "Grid" });
    expect(grid).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Raw text" }));
    expect(h.patches).toContainEqual({ tableView: "raw" });
  });

  it("Filter: typing filters after 150 ms and patches the Tab", async () => {
    const h = host("name\nann\nbob\ncarl\n");
    await ready();
    const box = screen.getByPlaceholderText("Filter rows…");
    fireEvent.change(box, { target: { value: "a" } });
    expect(h.patches).not.toContainEqual({ filter: "a" });
    expect(column0()).toEqual(["ann", "bob", "carl"]);
    await waitFor(() => expect(h.patches).toContainEqual({ filter: "a" }));
    expect(column0()).toEqual(["ann", "carl"]);
  });

  it("a filterSignal bump focuses the Filter box", async () => {
    const h = host("name\nann\n");
    await ready();
    const box = screen.getByPlaceholderText("Filter rows…");
    expect(document.activeElement).not.toBe(box);
    h.signal(1);
    expect(document.activeElement).toBe(box);
  });

  it("a filterSignal back to 0 (a request for another Tab) doesn't focus it", async () => {
    const h = host("name\nann\n", {}, { filterSignal: 3 });
    await ready();
    const box = screen.getByPlaceholderText("Filter rows…");
    expect(document.activeElement).not.toBe(box);
    h.signal(0);
    expect(document.activeElement).not.toBe(box);
    h.signal(5);
    expect(document.activeElement).toBe(box);
  });

  it("a focusSignal bump gives the grid the keyboard", async () => {
    const h = host("name\nann\n");
    await ready();
    const grid = screen.getByRole("grid");
    expect(document.activeElement).not.toBe(grid);
    h.focus(1);
    expect(document.activeElement).toBe(grid);
  });

  it("a focusSignal bump in the other Split half's grid doesn't take focus", async () => {
    const h = host("name\nann\n", {}, { focused: false });
    await ready();
    h.focus(1);
    expect(document.activeElement).not.toBe(screen.getByRole("grid"));
  });

  it("a grid mounted with a newer focusSignal (Raw text → Grid) takes focus once read", async () => {
    host("name\nann\n", {}, { focusSignal: 4, focusSeen: 3 });
    await ready();
    expect(document.activeElement).toBe(screen.getByRole("grid"));
  });

  it("a grid mounted with nothing pending leaves focus alone", async () => {
    host("name\nann\n", {}, { focusSignal: 4, focusSeen: 4 });
    await ready();
    expect(document.activeElement).not.toBe(screen.getByRole("grid"));
  });

  it("header click cycles Sort and patches it", async () => {
    const h = host("name\nb\na\nc\n");
    await ready();
    fireEvent.click(headerCell("name"));
    expect(h.tab().sort).toEqual({ col: 0, dir: "asc" });
    expect(column0()).toEqual(["a", "b", "c"]);
    fireEvent.click(headerCell("name"));
    expect(h.tab().sort).toEqual({ col: 0, dir: "desc" });
    expect(column0()).toEqual(["c", "b", "a"]);
    fireEvent.click(headerCell("name"));
    expect(h.tab().sort).toBeUndefined();
    expect(column0()).toEqual(["b", "a", "c"]);
  });

  it("restores Sort, Filter and widths from the Tab", async () => {
    host("name,n\nann,1\nbob,2\namy,3\n", {
      sort: { col: 1, dir: "desc" },
      filter: "a",
      colWidths: [77, 88],
    });
    await ready();
    expect(column0()).toEqual(["amy", "ann"]);
    expect(screen.getByPlaceholderText("Filter rows…")).toHaveValue("a");
    expect(headerCell("name").style.width).toBe("77px");
    expect(headerCell("n").style.width).toBe("88px");
  });

  it("an own edit keeps the row where it is; a sort change re-sorts", async () => {
    const h = host("name\nb\na\nc\n", { sort: { col: 0, dir: "asc" } });
    await ready();
    expect(column0()).toEqual(["a", "b", "c"]);
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.mouseDown(cell("a"));
    fireEvent.keyDown(grid, { key: "Enter" });
    const ed = screen.getByRole("textbox", { name: "Edit cell" });
    fireEvent.change(ed, { target: { value: "z" } });
    fireEvent.keyDown(ed, { key: "Enter" });
    expect(h.change).toHaveBeenCalledTimes(1);
    expect(h.text()).toBe("name\nb\nz\nc\n");
    expect(column0()).toEqual(["z", "b", "c"]);
    // Changing the Sort recomputes.
    fireEvent.click(headerCell("name"));
    fireEvent.click(headerCell("name"));
    fireEvent.click(headerCell("name"));
    expect(h.tab().sort).toEqual({ col: 0, dir: "asc" });
    expect(column0()).toEqual(["b", "c", "z"]);
  });

  it("an own row insert adopts the grid's order", async () => {
    host("name\nb\na\nc\n", { sort: { col: 0, dir: "asc" } });
    await ready();
    const gutter = screen
      .getAllByRole("rowheader")
      .find((e) => e.textContent === "2")!; // "a"
    fireEvent.contextMenu(gutter);
    fireEvent.click(
      screen.getByRole("menuitem", { name: /^Insert row below/ }),
    );
    // The new row sits right below "a", not sorted to the top.
    expect(column0()).toEqual(["a", "", "b", "c"]);
  });

  it("an outside re-parse keeps Sort, Filter and widths, and the active row", async () => {
    const h = host("name\nd\nb\na\nc\n", {
      sort: { col: 0, dir: "asc" },
      colWidths: [90],
    });
    await ready();
    expect(column0()).toEqual(["a", "b", "c", "d"]);
    fireEvent.mouseDown(cell("b")); // File row 2
    expect(activeCell()).toBe("b");
    // Row 2 becomes "e": it sorts last, and the active cell follows it.
    await h.outside("name\nd\ne\na\nc\n");
    expect(column0()).toEqual(["a", "c", "d", "e"]);
    expect(activeCell()).toBe("e");
    expect(h.tab().sort).toEqual({ col: 0, dir: "asc" });
    expect(headerCell("name").style.width).toBe("90px");
    // The row is gone: the active cell clamps to the last shown row.
    await h.outside("name\na\n");
    expect(column0()).toEqual(["a"]);
    expect(activeCell()).toBe("a");
  });

  it("an outside re-parse keeps the Filter", async () => {
    const h = host("name\nann\nbob\n", { filter: "b" });
    await ready();
    expect(column0()).toEqual(["bob"]);
    await h.outside("name\nann\nbob\nbea\n");
    expect(column0()).toEqual(["bob", "bea"]);
    expect(h.tab().filter).toBe("b");
  });

  it("dragging a column border patches colWidths", async () => {
    const h = host("name,n\nann,1\n", { colWidths: [100, 100] });
    await ready();
    const sep = screen.getAllByRole("separator", { name: "Resize column" })[0];
    fireEvent.mouseDown(sep, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 140 });
    fireEvent.mouseUp(window, { clientX: 140 });
    expect(h.tab().colWidths).toEqual([140, 100]);
  });

  it("inserting and deleting a column splices colWidths", async () => {
    const h = host("name,n\nann,1\n", { colWidths: [70, 90] });
    await ready();
    fireEvent.contextMenu(headerCell("name"));
    fireEvent.click(
      screen.getByRole("menuitem", { name: /^Insert column left/ }),
    );
    const w = h.tab().colWidths!;
    expect(w).toHaveLength(3);
    expect(w.slice(1)).toEqual([70, 90]);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Edit cell" }), {
      key: "Escape",
    });
    fireEvent.contextMenu(screen.getAllByRole("columnheader")[1]);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Delete column/ }));
    expect(h.tab().colWidths).toEqual([w[0], 90]);
  });

  it("onInfo reports rows, shown, cols, delimiter and header", async () => {
    const h = host("a;b\n1;2\n3;4\n5;6\n", { filter: "3" });
    await ready();
    await waitFor(() =>
      expect(last(h.infos)).toEqual({
        rows: 3,
        shown: 1,
        cols: 2,
        delimiter: ";",
        header: true,
      }),
    );
    h.patch({ header: false });
    await waitFor(() =>
      expect(last(h.infos)).toMatchObject({ rows: 4, header: false }),
    );
  });

  it("Add row shows only with no shown rows, and adds one at the end", async () => {
    const h = host("a,b\n");
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    expect(h.text()).toBe("a,b\n,\n");
    expect(screen.queryByRole("button", { name: "Add row" })).toBeNull();
    expect(screen.getAllByRole("rowheader")).toHaveLength(1);
  });

  it("no Add row when read-only", async () => {
    host("a,b\n", {}, { readOnly: true });
    await ready();
    expect(screen.queryByRole("button", { name: "Add row" })).toBeNull();
  });

  it("undo and redo go through the bridge", async () => {
    const h = host("a\nb\n");
    await ready();
    const grid = screen.getByRole("grid");
    grid.focus();
    fireEvent.keyDown(grid, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(h.bridge.undo).toHaveBeenCalledWith("t");
    fireEvent.keyDown(grid, { key: "y", code: "KeyY", ctrlKey: true });
    expect(h.bridge.redo).toHaveBeenCalledWith("t");
  });

  it("unreadable at open: falls back to raw text and reports the notice", async () => {
    const h = host('a,b\n1,"2\n');
    await waitFor(() => expect(h.patches).toContainEqual({ tableView: "raw" }));
    expect(last(h.notices)).toEqual({ line: 2, reason: "unclosedQuote" });
    expect(h.change).not.toHaveBeenCalled();
  });

  it("a readable parse clears the notice", async () => {
    const h = host("a,b\n1,2\n");
    await ready();
    await waitFor(() => expect(last(h.notices)).toBeNull());
  });
});

/** TabPane over a Table Tab, with App's Tab and notice state. */
function pane(text: string, over: Partial<TabState> = {}) {
  const b = fakeBridge(text);
  let tab = baseTab(over);
  let patchTab: (p: Partial<TabState>) => void = () => {};
  function Wrapper() {
    const [t, setT] = useState(tab);
    const [notice, setNotice] = useState<TableUnreadable | null>(null);
    patchTab = (p) => {
      tab = { ...tab, ...p };
      setT(tab);
    };
    return (
      <TabPane
        {...({
          tab: t,
          focused: true,
          tabs: [],
          slotRef: () => {},
          reloadSeq: 0,
          onImageInfo: () => {},
          mode: null,
          bridge: b.bridge,
          fontSize: 13,
          isReadOnly: () => false,
          onTabPatch: (_id: string, p: Partial<TabState>) => patchTab(p),
          onTableInfo: () => {},
          tableNotice: notice,
          onTableNotice: (_id: string, n: TableUnreadable | null) =>
            setNotice(n),
          filterSignal: 0,
        } as unknown as TabPaneProps)}
      />
    );
  }
  const utils = render(<Wrapper />);
  return {
    ...utils,
    ...b,
    tab: () => tab,
    patch: (p: Partial<TabState>) => act(() => patchTab(p)),
  };
}

const UNCLOSED = "Can't read this as a table: a quote is never closed (line 2)";

describe("Unreadable Table", () => {
  it("restored in raw text over unreadable text, shows the notice", async () => {
    const p = pane('a,b\n1,"2\n', { tableView: "raw" });
    expect(await screen.findByText(UNCLOSED)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try table view" })).toBeTruthy();
    expect(p.tab().tableView).toBe("raw");
    expect(p.change).not.toHaveBeenCalled();
  });

  it("fixing the text in raw text clears the notice", async () => {
    const p = pane('a,b\n1,"2\n', { tableView: "raw" });
    await screen.findByText(UNCLOSED);
    await p.outside("a,b\n1,2\n");
    await waitFor(() => expect(screen.queryByText(UNCLOSED)).toBeNull());
    expect(p.tab().tableView).toBe("raw");
  });

  it("breaking the text in raw text shows the notice", async () => {
    const p = pane("a,b\n1,2\n", { tableView: "raw" });
    await act(async () => {});
    await p.outside('a,b\n1,"2\n');
    expect(await screen.findByText(UNCLOSED)).toBeTruthy();
  });

  it("readable text in raw text shows no notice", async () => {
    pane("a,b\n1,2\n", { tableView: "raw" });
    await act(async () => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Can't read this as a table/)).toBeNull();
  });

  it("unreadable at open shows the notice in raw text with Try table view", async () => {
    const p = pane('a,b\n1,"2\n');
    expect(await screen.findByText(UNCLOSED)).toBeTruthy();
    expect(p.tab().tableView).toBe("raw");
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.getByRole("button", { name: "Try table view" })).toBeTruthy();
    expect(p.change).not.toHaveBeenCalled();
  });

  it("names the columns that don't line up", async () => {
    pane("a,b\n1,2,3\nx\n");
    expect(
      await screen.findByText(
        "Can't read this as a table: the columns don't line up (line 1)",
      ),
    ).toBeTruthy();
  });

  it("an outside change that breaks the text falls back from the grid", async () => {
    const p = pane("a,b\n1,2\n");
    await screen.findByRole("grid");
    await p.outside('a,b\n1,"2\n');
    expect(await screen.findByText(UNCLOSED)).toBeTruthy();
    expect(p.tab().tableView).toBe("raw");
    expect(screen.queryByRole("grid")).toBeNull();
    expect(p.change).not.toHaveBeenCalled();
  });

  it("Try table view stays in raw text while the text doesn't parse", async () => {
    const p = pane('a,b\n1,"2\n');
    await screen.findByText(UNCLOSED);
    fireEvent.click(screen.getByRole("button", { name: "Try table view" }));
    await act(async () => {});
    expect(p.tab().tableView).toBe("raw");
    expect(screen.getByText(UNCLOSED)).toBeTruthy();
  });

  it("Try table view re-parses with the Tab's Delimiter and returns to the grid", async () => {
    const p = pane("a,b\n1,2,3\nx\n");
    await screen.findByText(/columns don't line up/);
    p.patch({ delimiter: "," });
    fireEvent.click(screen.getByRole("button", { name: "Try table view" }));
    expect(await screen.findByRole("grid")).toBeTruthy();
    expect(p.tab().tableView).toBe("grid");
    expect(screen.queryByText(/columns don't line up/)).toBeNull();
  });

  it("Try table view after a fix in raw text returns to the grid", async () => {
    const p = pane('a,b\n1,"2\n');
    await screen.findByText(UNCLOSED);
    p.set("a,b\n1,2\n");
    fireEvent.click(screen.getByRole("button", { name: "Try table view" }));
    expect(await screen.findByRole("grid")).toBeTruthy();
    expect(screen.queryByText(UNCLOSED)).toBeNull();
  });

  it("switching to the grid on unreadable text falls back again", async () => {
    const p = pane('a,b\n1,"2\n');
    await screen.findByText(UNCLOSED);
    p.patch({ tableView: "grid" });
    await waitFor(() => expect(p.tab().tableView).toBe("raw"));
    expect(screen.getByText(UNCLOSED)).toBeTruthy();
    expect(screen.queryByRole("grid")).toBeNull();
    expect(p.change).not.toHaveBeenCalled();
  });
});
