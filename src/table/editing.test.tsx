import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deleteColumn,
  deleteRows,
  insertColumn,
  insertRows,
  setCell,
  setCells,
} from "./edits";
import { Grid, type GridProps } from "./Grid";
import { parseTable, type ParsedTable } from "./parse";
import { orderAfterDelete, orderAfterInsert } from "./view";

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

function tableOf(text: string): ParsedTable {
  const r = parseTable(text, ",");
  if (!r.ok) throw new Error("parse failed");
  return r.table;
}

function setup(
  text: string,
  over: Partial<GridProps> = {},
  o: { strict?: boolean } = {},
) {
  const table = over.table ?? tableOf(text);
  const header = over.header ?? false;
  const order =
    over.order ??
    Array.from(
      { length: table.rows.length - (header ? 1 : 0) },
      (_, i) => i + (header ? 1 : 0),
    );
  const apply = vi.fn<GridProps["edit"]["apply"]>(() => true);
  const undo = vi.fn();
  const redo = vi.fn();
  const props: GridProps = {
    table,
    seq: 0,
    order,
    header,
    widths: Array.from({ length: table.width }, () => 100),
    onWidths: vi.fn(),
    onSortClick: vi.fn(),
    onSort: vi.fn(),
    hidden: [],
    readOnly: false,
    focused: true,
    fontSize: 13,
    edit: { apply, undo, redo },
    ...over,
  };
  const wrap = (g: React.ReactElement) =>
    o.strict ? <StrictMode>{g}</StrictMode> : g;
  const utils = render(wrap(<Grid {...props} />));
  const grid = screen.getByRole("grid");
  grid.focus();
  const rerender = (p: Partial<GridProps>) =>
    utils.rerender(wrap(<Grid {...props} {...p} />));
  return { ...utils, rerender, props, grid, table, order, apply, undo, redo };
}

const selected = (grid: HTMLElement) =>
  Array.from(
    grid.querySelectorAll('[role="gridcell"][aria-selected="true"]'),
  ).map((e) => e.textContent);

const cell = (text: string) =>
  screen
    .getAllByRole("gridcell")
    .find((e) => e.textContent === text) as HTMLElement;
const gutter = (n: string) =>
  screen.getAllByRole("rowheader").find((e) => e.textContent === n)!;
const editor = () =>
  screen.queryByRole("textbox", { name: "Edit cell" }) as HTMLTextAreaElement;
/** A menu item by label (a disabled one's name also holds its reason). */
const item = (label: string) =>
  screen.getByRole("menuitem", { name: new RegExp(`^${label}`) });

describe("Grid editing", () => {
  it("Enter and F2 open the editor with the full value; Esc cancels", () => {
    const { grid, apply } = setup("alpha,b\nc,d\n");
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(editor().value).toBe("alpha");
    expect(document.activeElement).toBe(editor());
    fireEvent.change(editor(), { target: { value: "zzz" } });
    fireEvent.keyDown(editor(), { key: "Escape" });
    expect(editor()).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(grid);
    fireEvent.keyDown(grid, { key: "F2" });
    expect(editor().value).toBe("alpha");
  });

  it("typing a printable character opens the editor with it", () => {
    const { grid } = setup("alpha,b\n");
    fireEvent.keyDown(grid, { key: "q" });
    expect(editor().value).toBe("q");
  });

  it("Enter commits through setCell and moves down", () => {
    const { grid, apply, table } = setup("a,b\nc,d\ne,f\n");
    fireEvent.mouseDown(cell("b"));
    fireEvent.keyDown(grid, { key: "Enter" });
    fireEvent.change(editor(), { target: { value: "x,y" } });
    fireEvent.keyDown(editor(), { key: "Enter" });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toEqual(setCell(table, 0, 1, "x,y"));
    expect(editor()).toBeNull();
    expect(selected(grid)).toEqual(["d"]);
  });

  it("Tab commits and moves right", () => {
    const { grid, apply, table } = setup("a,b\n");
    fireEvent.keyDown(grid, { key: "F2" });
    fireEvent.change(editor(), { target: { value: "A" } });
    fireEvent.keyDown(editor(), { key: "Tab" });
    expect(apply.mock.calls[0][0]).toEqual(setCell(table, 0, 0, "A"));
    expect(selected(grid)).toEqual(["b"]);
  });

  it("losing focus commits in place, once", () => {
    const { grid, apply, table } = setup("a\nb\n");
    fireEvent.keyDown(grid, { key: "F2" });
    fireEvent.change(editor(), { target: { value: "x" } });
    fireEvent.blur(editor());
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toEqual(setCell(table, 0, 0, "x"));
    expect(editor()).toBeNull();
    expect(selected(grid)).toEqual(["a"]);
  });

  it("an unchanged value commits without an apply", () => {
    const { grid, apply } = setup("a\nb\n");
    fireEvent.keyDown(grid, { key: "Enter" });
    fireEvent.keyDown(editor(), { key: "Enter" });
    expect(apply).not.toHaveBeenCalled();
    expect(selected(grid)).toEqual(["b"]);
  });

  it("Mod+S commits first, then reaches the app's window listener", () => {
    const { grid, apply, table } = setup("a\nb\n");
    const seen: number[] = [];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "s") seen.push(apply.mock.calls.length);
    };
    window.addEventListener("keydown", onKey);
    try {
      fireEvent.keyDown(grid, { key: "F2" });
      fireEvent.change(editor(), { target: { value: "x" } });
      fireEvent.keyDown(editor(), { key: "s", code: "KeyS", ctrlKey: true });
      expect(seen).toEqual([1]);
      expect(apply.mock.calls[0][0]).toEqual(setCell(table, 0, 0, "x"));
      expect(editor()).toBeNull();
    } finally {
      window.removeEventListener("keydown", onKey);
    }
  });

  it("F-keys commit and bubble; text keys stay in the editor", () => {
    const { grid, apply } = setup("a\nb\n");
    const keys: string[] = [];
    const onKey = (e: KeyboardEvent) => keys.push(e.key);
    window.addEventListener("keydown", onKey);
    try {
      fireEvent.keyDown(grid, { key: "F2" });
      keys.length = 0;
      fireEvent.keyDown(editor(), { key: "ArrowLeft" });
      fireEvent.keyDown(editor(), { key: "q" });
      fireEvent.keyDown(editor(), { key: "Home", shiftKey: true });
      expect(keys).toEqual([]);
      fireEvent.change(editor(), { target: { value: "y" } });
      fireEvent.keyDown(editor(), { key: "F5" });
      expect(keys).toEqual(["F5"]);
      expect(apply).toHaveBeenCalledTimes(1);
      expect(editor()).toBeNull();
    } finally {
      window.removeEventListener("keydown", onKey);
    }
  });

  it("Mod+Z, Mod+A and clipboard keys stay native in the editor", () => {
    const { grid, apply, undo, redo } = setup("a\nb\n");
    const keys: string[] = [];
    const onKey = (e: KeyboardEvent) => keys.push(e.key);
    window.addEventListener("keydown", onKey);
    try {
      fireEvent.keyDown(grid, { key: "F2" });
      keys.length = 0;
      fireEvent.change(editor(), { target: { value: "x" } });
      for (const k of ["z", "y", "a", "c", "x", "v"])
        fireEvent.keyDown(editor(), {
          key: k,
          code: `Key${k.toUpperCase()}`,
          ctrlKey: true,
        });
      fireEvent.keyDown(editor(), {
        key: "Z",
        code: "KeyZ",
        ctrlKey: true,
        shiftKey: true,
      });
      expect(keys).toEqual([]);
      expect(undo).not.toHaveBeenCalled();
      expect(redo).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
      expect(editor()).not.toBeNull();
    } finally {
      window.removeEventListener("keydown", onKey);
    }
  });

  it("a blur commit leaves focus where the user put it", () => {
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    try {
      const { grid, apply } = setup("a\nb\n");
      fireEvent.keyDown(grid, { key: "F2" });
      fireEvent.change(editor(), { target: { value: "x" } });
      act(() => outside.focus());
      expect(apply).toHaveBeenCalledTimes(1);
      expect(editor()).toBeNull();
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  it("draws a header cell's editor inside the sticky header row", () => {
    setup("name,age\nann,3\n", { header: true });
    fireEvent.contextMenu(screen.getAllByRole("columnheader")[0]);
    fireEvent.click(item("Rename column"));
    expect(editor().parentElement).toHaveClass("z-grid-head");
  });

  it("Alt+Enter inserts a line break in the editor", () => {
    const { grid, apply } = setup("ab\n");
    fireEvent.keyDown(grid, { key: "F2" });
    const ta = editor();
    ta.setSelectionRange(1, 1);
    fireEvent.keyDown(ta, { key: "Enter", altKey: true });
    expect(editor().value).toBe("a\nb");
    expect(apply).not.toHaveBeenCalled();
  });

  it("a refused apply closes the editor and keeps the selection", () => {
    const { grid, apply } = setup("a\nb\n");
    apply.mockReturnValue(false);
    fireEvent.keyDown(grid, { key: "F2" });
    fireEvent.change(editor(), { target: { value: "x" } });
    fireEvent.keyDown(editor(), { key: "Enter" });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(editor()).toBeNull();
    expect(selected(grid)).toEqual(["a"]);
    fireEvent.keyDown(grid, { key: "F2" });
    expect(editor().value).toBe("a");
  });

  it("edits the File-order row in a sorted, filtered grid", () => {
    const text = "h\nr1\nr2\nr3\nr4\n";
    const { grid, apply, table } = setup(text, {
      header: true,
      order: [4, 2, 1],
    });
    fireEvent.mouseDown(cell("r2"));
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(editor().value).toBe("r2");
    fireEvent.change(editor(), { target: { value: "X" } });
    fireEvent.keyDown(editor(), { key: "Enter" });
    expect(apply.mock.calls[0][0]).toEqual(setCell(table, 2, 0, "X"));
  });

  it("renames a header cell through setCell on row 0", () => {
    const { apply, table } = setup("name,age\nann,3\n", { header: true });
    fireEvent.contextMenu(screen.getAllByRole("columnheader")[1]);
    fireEvent.click(item("Rename column"));
    expect(editor().value).toBe("age");
    fireEvent.change(editor(), { target: { value: "years" } });
    fireEvent.keyDown(editor(), { key: "Enter" });
    expect(apply.mock.calls[0][0]).toEqual(setCell(table, 0, 1, "years"));
  });

  it("Delete clears the selected cells as one apply", () => {
    const { grid, apply, table } = setup("a,b,c\nd,e,f\ng,h,i\n", {
      order: [2, 0, 1],
    });
    fireEvent.mouseDown(cell("g"));
    fireEvent.mouseDown(cell("b"), { shiftKey: true });
    fireEvent.keyDown(grid, { key: "Delete" });
    expect(apply).toHaveBeenCalledTimes(1);
    const [edit] = apply.mock.calls[0];
    expect(edit).toEqual(
      setCells(table, [
        { row: 0, col: 0, value: "" },
        { row: 0, col: 1, value: "" },
        { row: 2, col: 0, value: "" },
        { row: 2, col: 1, value: "" },
      ]),
    );
    const froms = edit.changes.map((c) => c.from);
    expect(froms).toEqual([...froms].sort((x, y) => x - y));
  });

  it("row menu: Insert row below places the row after the shown row", () => {
    const order = [3, 1, 0, 2];
    const { apply, table } = setup("a\nb\nc\nd\n", { order });
    fireEvent.contextMenu(gutter("2"));
    fireEvent.click(item("Insert row below"));
    expect(apply).toHaveBeenCalledWith(
      insertRows(table, 2, 1),
      orderAfterInsert(order, 2, 1, 1),
      undefined,
      table,
    );
  });

  it("row menu: Insert row above uses the shown row's File index", () => {
    const order = [3, 1, 0, 2];
    const { apply, table } = setup("a\nb\nc\nd\n", { order });
    fireEvent.contextMenu(gutter("2"));
    fireEvent.click(item("Insert row above"));
    expect(apply).toHaveBeenCalledWith(
      insertRows(table, 1, 1),
      orderAfterInsert(order, 1, 1, 0),
      undefined,
      table,
    );
  });

  it("row menu: Delete rows removes both File-order rows", () => {
    const order = [3, 1, 0, 2];
    const { apply, table } = setup("a\nb\nc\nd\n", { order });
    fireEvent.mouseDown(gutter("4"));
    fireEvent.mouseDown(gutter("1"), { ctrlKey: true });
    fireEvent.contextMenu(gutter("1"));
    fireEvent.click(item("Delete rows"));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      deleteRows(table, [0, 3]),
      orderAfterDelete(order, [0, 3]),
      undefined,
      table,
    );
  });

  it("column menu: Insert column right, then the new header cell is edited", () => {
    const { apply, table } = setup("a,b\n1,2\n", { header: true });
    fireEvent.contextMenu(screen.getAllByRole("columnheader")[0]);
    fireEvent.click(item("Insert column right"));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toEqual(insertColumn(table, 1));
    expect(apply.mock.calls[0][1]).toBeUndefined();
    expect(apply.mock.calls[0][2]).toEqual({ at: 1, op: "insert" });
    expect(editor()).not.toBeNull();
    expect(editor().value).toBe("");
    expect(document.activeElement).toBe(editor());
  });

  it("column menu: Insert column left without a header selects the new column", () => {
    const { grid, apply, table } = setup("a,b\n1,2\n");
    fireEvent.contextMenu(screen.getAllByRole("columnheader")[1]);
    fireEvent.click(item("Insert column left"));
    expect(apply.mock.calls[0][0]).toEqual(insertColumn(table, 1));
    expect(editor()).toBeNull();
    expect(selected(grid)).toEqual(["b"]);
  });

  it("column menu: Delete column and Sort", () => {
    const { apply, table, props } = setup("a,b\n1,2\n", { header: true });
    fireEvent.contextMenu(screen.getAllByRole("columnheader")[1]);
    fireEvent.click(item("Delete column"));
    expect(apply).toHaveBeenCalledWith(
      deleteColumn(table, 1),
      undefined,
      { at: 1, op: "delete" },
      table,
    );
    fireEvent.contextMenu(screen.getAllByRole("columnheader")[1]);
    fireEvent.click(item("Sort descending"));
    expect(props.onSort).toHaveBeenCalledWith({ col: 1, dir: "desc" });
  });

  it("Mod+Z and Mod+Shift+Z undo and redo", () => {
    const { grid, undo, redo } = setup("a\n");
    fireEvent.keyDown(grid, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(grid, {
      key: "Z",
      code: "KeyZ",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it("readOnly: no editor, no clearing, edit menu items disabled", () => {
    const { grid, apply } = setup("a,b\n1,2\n", { readOnly: true });
    fireEvent.keyDown(grid, { key: "Enter" });
    fireEvent.keyDown(grid, { key: "F2" });
    fireEvent.keyDown(grid, { key: "x" });
    fireEvent.keyDown(grid, { key: "Delete" });
    expect(editor()).toBeNull();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.contextMenu(gutter("1"));
    for (const name of ["Insert row above", "Insert row below", "Delete row"])
      expect(item(name)).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.contextMenu(screen.getAllByRole("columnheader")[0]);
    for (const name of [
      "Insert column left",
      "Insert column right",
      "Delete column",
    ])
      expect(item(name)).toHaveAttribute("aria-disabled", "true");
    expect(item("Sort ascending")).not.toHaveAttribute("aria-disabled");
  });

  it("a new table with a higher seq closes the editor without applying", () => {
    const { grid, apply, rerender } = setup("a\nb\n");
    fireEvent.keyDown(grid, { key: "F2" });
    fireEvent.change(editor(), { target: { value: "typed" } });
    rerender({ table: tableOf("a\nb\nc\n"), seq: 1 });
    expect(editor()).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it("a new order collapses a row selection to the active cell", () => {
    const { grid, rerender } = setup("a\nb\nc\n");
    fireEvent.mouseDown(gutter("1"));
    fireEvent.mouseDown(gutter("3"), { shiftKey: true });
    expect(selected(grid)).toEqual(["a", "b", "c"]);
    rerender({ order: [2, 1, 0] });
    // The active cell stays on its record ("a"), now at the bottom.
    expect(selected(grid)).toEqual(["a"]);
  });

  it("a Sort or Filter keeps the active cell on its record and scrolls to it", () => {
    let text = "";
    for (let i = 0; i < 100; i++) text += `r${String(i).padStart(2, "0")}\n`;
    const { grid, rerender, order } = setup(text);
    fireEvent.mouseDown(cell("r03"));
    rerender({ order: [...order].reverse() });
    expect(selected(grid)).toEqual(["r03"]);
    // Position 96 of 100 rows of 28px, in a 600px viewport.
    expect(grid.scrollTop).toBeGreaterThan(0);
    // A Filter that hides the record: the position clamps.
    rerender({ order: [10, 11] });
    expect(selected(grid)).toEqual(["r11"]);
  });

  it("a header right-click tints the column only while its menu is open", () => {
    const { grid } = setup("a,b\n1,2\n", { header: true });
    fireEvent.mouseDown(cell("1"));
    const h = screen.getAllByRole("columnheader")[1];
    fireEvent.contextMenu(h);
    expect(h).toHaveAttribute("data-selected");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(h).not.toHaveAttribute("data-selected");
    expect(selected(grid)).toEqual(["1"]);
  });

  it("a header right-click keeps a column that was already selected", () => {
    const { grid } = setup("a,b\n1,2\n3,4\n", { header: true });
    const h = screen.getAllByRole("columnheader")[1];
    fireEvent.mouseDown(h.querySelector(".z-grid-colsel")!);
    expect(selected(grid)).toEqual(["2", "4"]);
    fireEvent.contextMenu(h);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(h).toHaveAttribute("data-selected");
    expect(selected(grid)).toEqual(["2", "4"]);
  });

  it("the header menu offers File order while a Sort is on", () => {
    const { props } = setup("a,b\n1,2\n", {
      header: true,
      sort: { col: 0, dir: "asc" },
    });
    fireEvent.contextMenu(screen.getAllByRole("columnheader")[1]);
    fireEvent.click(item("File order"));
    expect(props.onSort).toHaveBeenCalledWith(undefined);
  });

  it("no File order item without a Sort", () => {
    setup("a,b\n1,2\n", { header: true });
    fireEvent.contextMenu(screen.getAllByRole("columnheader")[1]);
    expect(screen.queryByRole("menuitem", { name: /^File order/ })).toBeNull();
  });

  it("the editor takes its cell's width and a numeric column's alignment", () => {
    const { grid } = setup("a,b\n1,x\n", {
      header: true,
      widths: [70, 90],
    });
    fireEvent.mouseDown(cell("1"));
    fireEvent.keyDown(grid, { key: "F2" });
    expect(editor().style.width).toBe("70px");
    expect(editor().style.textAlign).toBe("right");
    fireEvent.keyDown(editor(), { key: "Escape" });
    fireEvent.mouseDown(cell("x"));
    fireEvent.keyDown(grid, { key: "F2" });
    expect(editor().style.width).toBe("90px");
    expect(editor().style.textAlign).toBe("");
  });

  it("double-clicking a data cell edits it", () => {
    setup("a,b\nc,d\n");
    fireEvent.mouseDown(cell("d"));
    fireEvent.doubleClick(cell("d"));
    expect(editor().value).toBe("d");
    expect(document.activeElement).toBe(editor());
  });

  it("double-clicking a header cell renames it and leaves the Sort as it was", () => {
    const { props } = setup("name,age\nann,3\n", { header: true });
    const head = screen.getAllByRole("columnheader")[1];
    fireEvent.click(head, { detail: 1 });
    fireEvent.click(head, { detail: 2 });
    fireEvent.doubleClick(head);
    expect(props.onSortClick).toHaveBeenCalledTimes(1);
    expect(props.onSort).toHaveBeenLastCalledWith(undefined);
    expect(editor().value).toBe("age");
    expect(editor().parentElement).toHaveClass("z-grid-head");
  });

  it("double-clicking a header without a header row only sorts", () => {
    const { props } = setup("a,b\n1,2\n");
    const head = screen.getAllByRole("columnheader")[0];
    fireEvent.click(head, { detail: 1 });
    fireEvent.click(head, { detail: 2 });
    fireEvent.doubleClick(head);
    expect(props.onSortClick).toHaveBeenCalledTimes(1);
    expect(props.onSort).not.toHaveBeenCalled();
    expect(editor()).toBeNull();
  });

  it("Shift+F10 or the ContextMenu key opens the column menu at the active cell", () => {
    const { grid } = setup("name,age\nann,3\n", { header: true });
    fireEvent.mouseDown(cell("3"));
    fireEvent.keyDown(grid, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu", { name: "Column" })).toBeTruthy();
    fireEvent.click(item("Rename column"));
    expect(editor().value).toBe("age");
    fireEvent.keyDown(editor(), { key: "Escape" });
    fireEvent.keyDown(grid, { key: "ContextMenu" });
    expect(screen.getByRole("menu", { name: "Column" })).toBeTruthy();
  });

  it("with whole rows selected, the menu key opens the row menu", () => {
    const { grid, apply, table } = setup("a\nb\nc\n");
    fireEvent.mouseDown(gutter("2"));
    fireEvent.keyDown(grid, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu", { name: "Row" })).toBeTruthy();
    fireEvent.click(item("Delete row"));
    expect(apply.mock.calls[0][0]).toEqual(deleteRows(table, [1]));
  });

  it("every apply names the table its edit was built from", () => {
    const { grid, apply, table } = setup("name,age\nann,3\nbob,4\n", {
      header: true,
    });
    fireEvent.keyDown(grid, { key: "F2" });
    fireEvent.change(editor(), { target: { value: "x" } });
    fireEvent.keyDown(editor(), { key: "Enter" });
    fireEvent.keyDown(grid, { key: "Delete" });
    fireEvent.contextMenu(gutter("1"));
    fireEvent.click(item("Insert row below"));
    fireEvent.contextMenu(gutter("1"));
    fireEvent.click(item("Delete row"));
    fireEvent.contextMenu(screen.getAllByRole("columnheader")[0]);
    fireEvent.click(item("Delete column"));
    expect(apply).toHaveBeenCalledTimes(5);
    for (const call of apply.mock.calls) expect(call[3]).toBe(table);
  });

  it("Mod text-editing keys stay in the editor (no commit)", () => {
    const { grid, apply } = setup("a\nb\n");
    const keys: string[] = [];
    const onKey = (e: KeyboardEvent) => keys.push(e.key);
    window.addEventListener("keydown", onKey);
    try {
      fireEvent.keyDown(grid, { key: "F2" });
      fireEvent.change(editor(), { target: { value: "half" } });
      keys.length = 0;
      const names = [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "Backspace",
        "Delete",
      ];
      for (const key of names)
        for (const shiftKey of [false, true]) {
          fireEvent.keyDown(editor(), { key, ctrlKey: true, shiftKey });
          fireEvent.keyDown(editor(), { key, metaKey: true, shiftKey });
        }
      // Option+arrows and Option+Backspace (macOS word moves).
      fireEvent.keyDown(editor(), { key: "ArrowLeft", altKey: true });
      fireEvent.keyDown(editor(), { key: "Backspace", altKey: true });
      expect(keys).toEqual([]);
      expect(apply).not.toHaveBeenCalled();
      expect(editor()).not.toBeNull();
      // Another Mod combo still commits and goes through.
      fireEvent.keyDown(editor(), { key: "s", code: "KeyS", ctrlKey: true });
      expect(apply).toHaveBeenCalledTimes(1);
      expect(keys).toEqual(["s"]);
    } finally {
      window.removeEventListener("keydown", onKey);
    }
  });

  it("an IME Enter with keyCode 229 (WebKit) doesn't commit", () => {
    const { grid, apply } = setup("a\nb\n");
    fireEvent.keyDown(grid, { key: "F2" });
    fireEvent.change(editor(), { target: { value: "日" } });
    fireEvent.keyDown(editor(), { key: "Enter", keyCode: 229 });
    expect(editor()).not.toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it("an IME key (Process / 229) on a selected cell opens an empty editor", () => {
    const { grid } = setup("alpha\nb\n");
    const down = new KeyboardEvent("keydown", {
      key: "Process",
      keyCode: 229,
      bubbles: true,
      cancelable: true,
    } as KeyboardEventInit);
    act(() => {
      grid.dispatchEvent(down);
    });
    expect(editor()).not.toBeNull();
    expect(editor().value).toBe("");
    expect(document.activeElement).toBe(editor());
    // The composition must land in the editor: the key isn't cancelled.
    expect(down.defaultPrevented).toBe(false);
  });

  describe("under React.StrictMode (dev)", () => {
    it("Enter commits and moves down", () => {
      const { grid, apply, table } = setup("a\nb\n", {}, { strict: true });
      fireEvent.keyDown(grid, { key: "F2" });
      fireEvent.change(editor(), { target: { value: "x" } });
      fireEvent.keyDown(editor(), { key: "Enter" });
      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply.mock.calls[0][0]).toEqual(setCell(table, 0, 0, "x"));
      expect(editor()).toBeNull();
      expect(selected(grid)).toEqual(["b"]);
    });

    it("Esc cancels", () => {
      const { grid, apply } = setup("a\nb\n", {}, { strict: true });
      fireEvent.keyDown(grid, { key: "F2" });
      fireEvent.change(editor(), { target: { value: "x" } });
      fireEvent.keyDown(editor(), { key: "Escape" });
      expect(editor()).toBeNull();
      expect(apply).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(grid);
    });

    it("blur commits in place", () => {
      const { grid, apply, table } = setup("a\nb\n", {}, { strict: true });
      fireEvent.keyDown(grid, { key: "F2" });
      fireEvent.change(editor(), { target: { value: "x" } });
      fireEvent.blur(editor());
      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply.mock.calls[0][0]).toEqual(setCell(table, 0, 0, "x"));
      expect(editor()).toBeNull();
    });
  });
});
