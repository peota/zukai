import { describe, expect, it } from "vitest";
import { parseTable } from "./parse";
import {
  NEXT_SORT,
  guessWidths,
  numericColumns,
  orderAfterDelete,
  orderAfterInsert,
  rowOrder,
} from "./view";

function table(text: string) {
  const r = parseTable(text, ",");
  if (!r.ok) throw new Error("parse");
  return r.table;
}

describe("rowOrder", () => {
  const t = table("n\nb\nA\nc\n");
  it("excludes the header row when header is on", () => {
    expect(rowOrder(t, { header: true })).toEqual([1, 2, 3]);
  });
  it("includes row 0 without a header", () => {
    expect(rowOrder(t, { header: false })).toEqual([0, 1, 2, 3]);
  });
  it("sorts text case-insensitively, asc and desc", () => {
    expect(rowOrder(t, { header: true, sort: { col: 0, dir: "asc" } })).toEqual(
      [2, 1, 3],
    );
    expect(
      rowOrder(t, { header: true, sort: { col: 0, dir: "desc" } }),
    ).toEqual([3, 1, 2]);
  });
  it("is stable on ties and sorts numeric-aware", () => {
    const u = table("h\nx\nX\nx2\nx10\n");
    expect(rowOrder(u, { header: true, sort: { col: 0, dir: "asc" } })).toEqual(
      [1, 2, 3, 4],
    );
  });
  it("puts empty cells last in both directions", () => {
    const u = table("h\nb\n\na\n");
    // blank line is a row with one empty cell
    expect(rowOrder(u, { header: true, sort: { col: 0, dir: "asc" } })).toEqual(
      [3, 1, 2],
    );
    expect(
      rowOrder(u, { header: true, sort: { col: 0, dir: "desc" } }),
    ).toEqual([1, 3, 2]);
  });
  it("sorts a numeric column numerically", () => {
    const u = table("h\n10\n9\n\n-1.5\n");
    expect(numericColumns(u, true)).toEqual([true]);
    expect(rowOrder(u, { header: true, sort: { col: 0, dir: "asc" } })).toEqual(
      [4, 2, 1, 3],
    );
    expect(
      rowOrder(u, { header: true, sort: { col: 0, dir: "desc" } }),
    ).toEqual([1, 2, 4, 3]);
  });
  it("treats missing cells as empty", () => {
    const u = table("a,b\n1\n2,z\n3,y\n");
    expect(rowOrder(u, { header: true, sort: { col: 1, dir: "asc" } })).toEqual(
      [3, 2, 1],
    );
  });
  it("filters case-insensitively over any cell", () => {
    const u = table("a,b\nfoo,1\nbar,FOO\nbaz,2\n");
    expect(rowOrder(u, { header: true, filter: "foo" })).toEqual([1, 2]);
    expect(rowOrder(u, { header: true, filter: "  " })).toEqual([1, 2, 3]);
    expect(
      rowOrder(u, {
        header: true,
        filter: "FOO",
        sort: { col: 0, dir: "asc" },
      }),
    ).toEqual([2, 1]);
  });
});

describe("numericColumns", () => {
  it("needs every non-empty cell numeric and at least one", () => {
    const t = table("a,b,c\n1,x,\n2,3,\n");
    expect(numericColumns(t, true)).toEqual([true, false, false]);
  });
});

describe("order maintenance", () => {
  it("orderAfterInsert shifts and places", () => {
    expect(orderAfterInsert([5, 2, 9], 3, 1, 1)).toEqual([6, 2, 3, 10]);
    expect(orderAfterInsert([5, 2, 9], 3, 2, -1)).toEqual([3, 4, 7, 2, 11]);
  });
  it("orderAfterDelete drops and shifts", () => {
    expect(orderAfterDelete([5, 2, 9], [2])).toEqual([4, 8]);
  });
});

describe("NEXT_SORT", () => {
  it("cycles asc, desc, none and restarts on a new column", () => {
    const a = NEXT_SORT(undefined, 2);
    expect(a).toEqual({ col: 2, dir: "asc" });
    const d = NEXT_SORT(a, 2);
    expect(d).toEqual({ col: 2, dir: "desc" });
    expect(NEXT_SORT(d, 2)).toBeUndefined();
    expect(NEXT_SORT(d, 1)).toEqual({ col: 1, dir: "asc" });
  });
});

describe("guessWidths", () => {
  it("clamps to 56..360", () => {
    const t = table(`a,${"x".repeat(100)}\n1,2\n`);
    expect(guessWidths(t, true, 8)).toEqual([56, 360]);
  });
  it("sizes by content plus padding", () => {
    const t = table("abcd,e\n1,2\n");
    expect(guessWidths(t, true, 10)).toEqual([56, 56]);
    const u = table("abcdefgh,e\n1,2\n");
    expect(guessWidths(u, true, 10)).toEqual([96, 56]);
  });
});
