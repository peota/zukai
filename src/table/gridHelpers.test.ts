import { describe, expect, it } from "vitest";
import {
  cellHidden,
  columnLabel,
  recordNumber,
  splitMatches,
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
});
