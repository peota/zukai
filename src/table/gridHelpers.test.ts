import { describe, expect, it } from "vitest";
import {
  cellHidden,
  columnLabel,
  rangeOf,
  recordNumber,
  splitMatches,
  toggleSorted,
  uniformRange,
  toTsv,
  tsvField,
} from "./gridHelpers";
import { parseTable } from "./parse";

describe("gridHelpers", () => {
  it("labels columns like a spreadsheet", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLabel)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
      "ZZ",
      "AAA",
    ]);
  });

  it("numbers records from 1, skipping the header row", () => {
    expect(recordNumber(1, true)).toBe(1);
    expect(recordNumber(0, false)).toBe(1);
    expect(recordNumber(5, false)).toBe(6);
  });

  it("tests cells against hidden ranges", () => {
    const r = parseTable("ab,cd,,e\n", ",");
    if (!r.ok) throw new Error();
    const row = r.table.rows[0];
    // ab 0..2, cd 3..5, "" 6..6, e 7..8
    expect(cellHidden(row, 0, [[2, 3]])).toBe(false);
    expect(cellHidden(row, 1, [[2, 4]])).toBe(true);
    expect(cellHidden(row, 1, [[5, 7]])).toBe(false);
    expect(cellHidden(row, 2, [[5, 7]])).toBe(true);
    expect(cellHidden(row, 3, [])).toBe(false);
    expect(cellHidden(row, 9, [[0, 99]])).toBe(false);
  });

  it("quotes TSV fields that need it", () => {
    expect(tsvField("a")).toBe("a");
    expect(tsvField("a\tb")).toBe('"a\tb"');
    expect(tsvField("a\nb")).toBe('"a\nb"');
    expect(tsvField('say "hi"')).toBe('"say ""hi"""');
    expect(
      toTsv([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe("a\tb\nc\td");
  });

  it("splits a value around case-insensitive matches", () => {
    expect(splitMatches("Banana", "AN")).toEqual(["B", "an", "", "an", "a"]);
    expect(splitMatches("pear", "x")).toEqual(["pear"]);
    expect(splitMatches("pear", "")).toEqual(["pear"]);
  });

  it("windows uniform rows in closed form", () => {
    expect(uniformRange(0, 28, 0, 600, 6)).toEqual([0, 0]);
    expect(uniformRange(100, 28, 0, 560, 0)).toEqual([0, 20]);
    expect(uniformRange(100, 28, 0, 561, 0)).toEqual([0, 21]);
    expect(uniformRange(100, 28, 30, 560, 2)).toEqual([0, 24]);
    expect(uniformRange(100, 28, 2800, 560, 2)).toEqual([97, 100]);
    expect(uniformRange(1_000_000, 28, 28 * 500_000, 280, 6)).toEqual([
      499_994, 500_016,
    ]);
    expect(uniformRange(5, 28, 0, 0, 0)).toEqual([0, 1]);
  });

  it("builds ranges and toggles sorted lists", () => {
    expect(rangeOf(4, 2)).toEqual([2, 3, 4]);
    expect(rangeOf(3, 3)).toEqual([3]);
    expect(toggleSorted([1, 5], 3)).toEqual([1, 3, 5]);
    expect(toggleSorted([1, 3, 5], 3)).toEqual([1, 5]);
  });
});
