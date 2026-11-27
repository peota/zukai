import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { charPx, Grid, type GridProps } from "./Grid";
import { parseTable, type ParsedTable, type Row } from "./parse";
import { visibleRange } from "./windowing";

vi.mock("./windowing", async (orig) => {
  const real = await orig<typeof import("./windowing")>();
  return { ...real, visibleRange: vi.fn(real.visibleRange) };
});

vi.mock("../app/shortcuts", async (orig) => ({
  ...(await orig<typeof import("../app/shortcuts")>()),
  detectPlatform: () => "windows",
}));

const VIEW_H = 600;
const VIEW_W = 800;
const saved: Record<string, PropertyDescriptor | undefined> = {};

beforeAll(() => {
  for (const [k, v] of [
    ["clientHeight", VIEW_H],
    ["clientWidth", VIEW_W],
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

const writeText = vi.fn<(s: string) => Promise<void>>(async () => {});
beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

function tableOf(text: string): ParsedTable {
  const r = parseTable(text, ",");
  if (!r.ok) throw new Error("parse failed");
  return r.table;
}

const noop = () => {};

function setup(text: string, over: Partial<GridProps> = {}) {
  const table = tableOf(text);
  const header = over.header ?? false;
  const order =
    over.order ??
    Array.from(
      { length: table.rows.length - (header ? 1 : 0) },
      (_, i) => i + (header ? 1 : 0),
    );
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
    edit: { apply: () => true, undo: noop, redo: noop },
    ...over,
  };
  const utils = render(<Grid {...props} />);
  const grid = screen.getByRole("grid");
  return { ...utils, props, grid };
}

/** "r0c0,r0c1,…" for `n` rows of `w` columns, no header. */
function labelled(n: number, w: number): string {
  let s = "";
  for (let r = 0; r < n; r++)
    s += Array.from({ length: w }, (_, c) => `r${r}c${c}`).join(",") + "\n";
  return s;
}

const selected = (grid: HTMLElement) =>
  Array.from(
    grid.querySelectorAll('[role="gridcell"][aria-selected="true"]'),
  ).map((e) => e.textContent);

const cell = (text: string) =>
  screen
    .getAllByRole("gridcell")
    .find((e) => e.textContent === text) as HTMLElement;

describe("Grid", () => {
  it("renders only a window of rows for a 10,000-row table", () => {
    let text = "a,b,c\n";
    for (let i = 0; i < 10000; i++) text += `${i},x,y\n`;
    const { grid } = setup(text, { header: true });
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.length).toBeLessThan(100);
    expect(grid).toHaveAttribute("aria-rowcount", "10001");
  });

  it("takes header labels from row 0 when header is on", () => {
    setup("name,age\nann,3\n", { header: true });
    const heads = screen.getAllByRole("columnheader").map((e) => e.textContent);
    expect(heads).toEqual(["name", "age"]);
    expect(screen.queryByRole("gridcell", { name: "name" })).toBeNull();
  });

  it("labels columns A, B… and shows row 0 as data when header is off", () => {
    setup("name,age\nann,3\n", { header: false });
    const heads = screen.getAllByRole("columnheader").map((e) => e.textContent);
    expect(heads).toEqual(["A", "B"]);
    expect(cell("name")).toBeTruthy();
  });

  it("numbers the gutter by record, from File order", () => {
    setup("h\na\nb\nc\n", { header: true, order: [3, 1, 2] });
    const nums = screen.getAllByRole("rowheader").map((e) => e.textContent);
    expect(nums).toEqual(["3", "1", "2"]);
  });

  it("numbers from 1 when header is off", () => {
    setup("a\nb\n", { header: false, order: [1, 0] });
    const nums = screen.getAllByRole("rowheader").map((e) => e.textContent);
    expect(nums).toEqual(["2", "1"]);
  });

  it("marks numeric columns", () => {
    setup("n,s\n1,a\n2.5,b\n", { header: true });
    expect(cell("1")).toHaveAttribute("data-numeric");
    expect(cell("2.5")).toHaveAttribute("data-numeric");
    expect(cell("a")).not.toHaveAttribute("data-numeric");
  });

  it("truncates with a title holding the full value", () => {
    setup("a long value,b\n");
    expect(cell("a long value")).toHaveAttribute("title", "a long value");
  });

  it("moves the active cell with the keyboard", () => {
    const { grid } = setup(labelled(100, 3));
    grid.focus();
    expect(selected(grid)).toEqual(["r0c0"]);
    const key = (key: string, o: object = {}) =>
      fireEvent.keyDown(grid, { key, ...o });
    key("ArrowRight");
    expect(selected(grid)).toEqual(["r0c1"]);
    key("ArrowDown");
    expect(selected(grid)).toEqual(["r1c1"]);
    key("End");
    expect(selected(grid)).toEqual(["r1c2"]);
    key("ArrowRight");
    expect(selected(grid)).toEqual(["r1c2"]);
    key("Home");
    expect(selected(grid)).toEqual(["r1c0"]);
    key("ArrowLeft");
    expect(selected(grid)).toEqual(["r1c0"]);
    key("ArrowUp");
    expect(selected(grid)).toEqual(["r0c0"]);
    key("ArrowUp");
    expect(selected(grid)).toEqual(["r0c0"]);
    // 600px viewport minus the 28px header: 20 whole 28px rows.
    key("PageDown");
    expect(selected(grid)).toEqual(["r20c0"]);
    key("PageUp");
    expect(selected(grid)).toEqual(["r0c0"]);
    key("End", { ctrlKey: true });
    expect(selected(grid)).toEqual(["r99c2"]);
    key("Home", { ctrlKey: true });
    expect(selected(grid)).toEqual(["r0c0"]);
  });

  it("ignores keys when not focused", () => {
    const { grid } = setup(labelled(3, 3), { focused: false });
    grid.focus();
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(selected(grid)).toEqual(["r0c0"]);
  });

  it("selects rows from the gutter, Shift extends", () => {
    const onSelection = vi.fn();
    const { grid } = setup(labelled(8, 2), { onSelection });
    const gutter = (n: string) =>
      screen.getAllByRole("rowheader").find((e) => e.textContent === n)!;
    fireEvent.mouseDown(gutter("4"));
    expect(selected(grid)).toEqual(["r3c0", "r3c1"]);
    fireEvent.mouseDown(gutter("6"), { shiftKey: true });
    expect(selected(grid)).toEqual([
      "r3c0",
      "r3c1",
      "r4c0",
      "r4c1",
      "r5c0",
      "r5c1",
    ]);
    expect(onSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({ rows: [3, 4, 5] }),
    );
  });

  it("sorts on a plain header click; the left edge selects the column", () => {
    const { grid, props } = setup("a,b\n1,2\n3,4\n", { header: true });
    const b = screen.getAllByRole("columnheader")[1];
    fireEvent.click(b);
    expect(props.onSortClick).toHaveBeenCalledWith(1);
    vi.mocked(props.onSortClick).mockClear();
    const zone = within(b).getByLabelText("Select column");
    fireEvent.mouseDown(zone);
    fireEvent.click(zone);
    expect(props.onSortClick).not.toHaveBeenCalled();
    expect(selected(grid)).toEqual(["2", "4"]);
  });

  it("resizes a column by dragging its border; double-click fits", () => {
    const { props } = setup("a,b\nabcdefghij,x\nabc,y\n");
    const handle = screen.getAllByRole("separator", {
      name: "Resize column",
    })[0];
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 130 });
    fireEvent.mouseMove(window, { clientX: 150 });
    // The drag shows live but reports once, on mouseup.
    expect(screen.getAllByRole("columnheader")[0].style.width).toBe("150px");
    expect(props.onWidths).not.toHaveBeenCalled();
    fireEvent.mouseUp(window, { clientX: 150 });
    expect(props.onWidths).toHaveBeenCalledTimes(1);
    expect(props.onWidths).toHaveBeenLastCalledWith([150, 100]);
    vi.mocked(props.onWidths).mockClear();
    fireEvent.doubleClick(handle);
    expect(props.onWidths).toHaveBeenLastCalledWith([
      Math.round(10 * charPx(13) + 16),
      100,
    ]);
  });

  it("shows dots for a cell overlapping a hidden range", () => {
    // "a,secret\n": "secret" is 2..8.
    setup("a,secret\n", { hidden: [[3, 5]] });
    expect(screen.queryByText("secret")).toBeNull();
    const dots = cell("••••");
    expect(dots).toBeTruthy();
    expect(dots).not.toHaveAttribute("title");
    expect(cell("a")).toBeTruthy();
  });

  it("highlights filter matches", () => {
    setup("Apple,pear\n", { filter: "PL" });
    const mark = cell("Apple").querySelector("mark");
    expect(mark?.textContent).toBe("pl");
    expect(cell("pear").querySelector("mark")).toBeNull();
  });

  it("copies the selection as TSV with Mod+C", () => {
    const { grid } = setup("a,b\n");
    grid.focus();
    fireEvent.mouseDown(cell("a"));
    fireEvent.mouseDown(cell("b"), { shiftKey: true });
    fireEvent.keyDown(grid, { key: "c", code: "KeyC", ctrlKey: true });
    expect(writeText).toHaveBeenCalledWith("a\tb");
  });

  it("quotes copied cells holding a tab, newline or quote", () => {
    const { grid } = setup('x,"y\tz"\n"m\nn","q""r"\n');
    grid.focus();
    fireEvent.mouseDown(screen.getAllByRole("rowheader")[0]);
    fireEvent.mouseDown(screen.getAllByRole("rowheader")[1], {
      shiftKey: true,
    });
    fireEvent.keyDown(grid, { key: "c", code: "KeyC", ctrlKey: true });
    expect(writeText).toHaveBeenCalledWith('x\t"y\tz"\n"m\nn"\t"q""r"');
  });

  it("copies a hidden cell as dots", () => {
    const { grid } = setup("a,secret\n", { hidden: [[3, 5]] });
    grid.focus();
    fireEvent.mouseDown(screen.getAllByRole("rowheader")[0]);
    fireEvent.keyDown(grid, { key: "c", code: "KeyC", ctrlKey: true });
    expect(writeText).toHaveBeenCalledWith("a\t••••");
  });

  it("windows 1,000,000 rows without a row offsets array", () => {
    const n = 1_000_000;
    const rows: Row[] = Array.from({ length: n }, (_, i) => ({
      start: 0,
      end: 0,
      eol: "\n",
      cells: [String(i)],
      cellStart: [0],
      cellEnd: [0],
      quoted: [false],
    }));
    const table: ParsedTable = {
      rows,
      delimiter: ",",
      allQuoted: false,
      width: 1,
    };
    const order = Array.from({ length: n }, (_, i) => i);
    vi.mocked(visibleRange).mockClear();
    const { grid } = setup("x\n", { table, order, widths: [100] });
    expect(screen.getAllByRole("row").length).toBeLessThan(100);
    expect(grid).toHaveAttribute("aria-rowcount", String(n + 1));
    grid.focus();
    fireEvent.keyDown(grid, { key: "End", ctrlKey: true });
    expect(selected(grid)).toEqual(["999999"]);
    // visibleRange is only used for columns (offsets of width + 1).
    for (const [offsets] of vi.mocked(visibleRange).mock.calls)
      expect(offsets.length).toBeLessThanOrEqual(2);
  });

  it("reaches every row of 3,000,000 under the browser's height cap", () => {
    const n = 3_000_000;
    const row: Row = {
      start: 0,
      end: 0,
      eol: "\n",
      cells: ["v"],
      cellStart: [0],
      cellEnd: [0],
      quoted: [false],
    };
    const rows: Row[] = new Array<Row>(n).fill(row);
    rows[n - 1] = { ...row, cells: ["last"] };
    rows[n / 2] = { ...row, cells: ["middle"] };
    const table: ParsedTable = {
      rows,
      delimiter: ",",
      allQuoted: false,
      width: 1,
    };
    const order = Array.from({ length: n }, (_, i) => i);
    const { grid } = setup("x\n", { table, order, widths: [100] });
    const content = grid.firstElementChild as HTMLElement;
    const height = parseFloat(content.style.height);
    expect(height).toBeLessThanOrEqual(15_000_000 + 100);
    grid.focus();
    fireEvent.keyDown(grid, { key: "End", ctrlKey: true });
    expect(selected(grid)).toEqual(["last"]);
    // The last row is drawn inside the scroll space, in the viewport.
    const last = cell("last").parentElement as HTMLElement;
    const top = parseFloat(last.style.top);
    expect(top).toBeLessThanOrEqual(height);
    expect(top).toBeGreaterThanOrEqual(grid.scrollTop);
    expect(top + 28).toBeLessThanOrEqual(grid.scrollTop + VIEW_H);
    // Scrolling to the middle of the scroll space shows the middle rows.
    grid.scrollTop = (height - VIEW_H) / 2;
    fireEvent.scroll(grid);
    expect(
      screen.getAllByRole("rowheader").map((e) => e.textContent),
    ).toContain(String(n / 2 + 1));
    // Back to the top with Ctrl+Home, and reveal still works by keyboard.
    fireEvent.keyDown(grid, { key: "Home", ctrlKey: true });
    expect(grid.scrollTop).toBe(0);
    fireEvent.keyDown(grid, { key: "PageDown" });
    fireEvent.keyDown(grid, { key: "PageDown" });
    const active = grid.querySelector("[data-active]")!.parentElement!;
    const at = parseFloat(active.style.top);
    expect(at).toBeGreaterThanOrEqual(grid.scrollTop);
    expect(at + 28).toBeLessThanOrEqual(grid.scrollTop + VIEW_H);
  });

  it("does not sort when a resize drag ends over the header cell", async () => {
    const { props } = setup("a,b\n1,2\n", { header: true });
    const head = screen.getAllByRole("columnheader")[0];
    const handle = within(head).getByRole("separator");
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 40 });
    fireEvent.mouseUp(head, { clientX: 40 });
    fireEvent.click(head);
    expect(props.onSortClick).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(head);
    expect(props.onSortClick).toHaveBeenCalledWith(0);
  });

  it("toggles rows with Mod+click in the gutter", () => {
    const onSelection = vi.fn();
    const { grid } = setup(labelled(8, 1), { onSelection });
    const gutter = (n: string) =>
      screen.getAllByRole("rowheader").find((e) => e.textContent === n)!;
    fireEvent.mouseDown(gutter("2"));
    fireEvent.mouseDown(gutter("5"), { ctrlKey: true });
    expect(selected(grid)).toEqual(["r1c0", "r4c0"]);
    expect(onSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({ rows: [1, 4] }),
    );
    fireEvent.mouseDown(gutter("2"), { ctrlKey: true });
    expect(selected(grid)).toEqual(["r4c0"]);
  });

  it("Shift+click after Mod+click extends from the toggled row", () => {
    const onSelection = vi.fn();
    const { grid } = setup(labelled(8, 1), { onSelection });
    const gutter = (n: string) =>
      screen.getAllByRole("rowheader").find((e) => e.textContent === n)!;
    fireEvent.mouseDown(gutter("2"));
    fireEvent.mouseDown(gutter("5"), { ctrlKey: true });
    fireEvent.mouseDown(gutter("7"), { shiftKey: true });
    expect(selected(grid)).toEqual(["r4c0", "r5c0", "r6c0"]);
    expect(onSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({ rows: [4, 5, 6] }),
    );
  });

  it("copies non-contiguous rows in order", () => {
    const { grid } = setup(labelled(4, 2));
    grid.focus();
    const gutter = (n: string) =>
      screen.getAllByRole("rowheader").find((e) => e.textContent === n)!;
    fireEvent.mouseDown(gutter("3"));
    fireEvent.mouseDown(gutter("1"), { ctrlKey: true });
    fireEvent.keyDown(grid, { key: "c", code: "KeyC", ctrlKey: true });
    expect(writeText).toHaveBeenCalledWith("r0c0\tr0c1\nr2c0\tr2c1");
  });

  it("ignores navigation with Alt, and PageUp/PageDown with Mod", () => {
    const { grid } = setup(labelled(50, 2));
    grid.focus();
    fireEvent.keyDown(grid, { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(grid, { key: "End", altKey: true });
    fireEvent.keyDown(grid, { key: "PageDown", ctrlKey: true });
    expect(selected(grid)).toEqual(["r0c0"]);
  });
});
