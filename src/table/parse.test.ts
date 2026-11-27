import { describe, expect, it } from "vitest";
import { guessDelimiter, parseTable, readTable } from "./parse";

function table(text: string, delimiter: "," | ";" | "\t" | "|" = ",") {
  const result = parseTable(text, delimiter);
  if (!result.ok) throw new Error("expected ok");
  return result.table;
}

describe("parseTable", () => {
  it("parses simple rows", () => {
    const t = table("a,b\n1,2\n");
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(t.rows[0]).toMatchObject({ start: 0, end: 3, eol: "\n" });
    expect(t.rows[0].cellStart).toEqual([0, 2]);
    expect(t.rows[0].cellEnd).toEqual([1, 3]);
  });

  it("handles quoted cells with delimiter, doubled quote and line break", () => {
    const text = 'x,"a,b","say ""hi""","l1\nl2"\n';
    const t = table(text);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].cells).toEqual(["x", "a,b", 'say "hi"', "l1\nl2"]);
    expect(t.rows[0].quoted).toEqual([false, true, true, true]);
    expect(t.rows[0].end).toBe(text.length - 1);
  });

  it("handles CRLF and no final newline", () => {
    const t = table("a,b\r\n1,2");
    expect(t.rows[0].eol).toBe("\r\n");
    expect(t.rows[0].end).toBe(3);
    expect(t.rows[1].eol).toBe("");
  });

  it("reads an empty file and a header-only file", () => {
    const empty = table("");
    expect(empty.rows).toHaveLength(0);
    expect(empty.allQuoted).toBe(false);
    expect(table("name\n").rows).toHaveLength(1);
  });

  it("accepts ragged rows", () => {
    const t = table("a,b,c\n1\n1,2,3,4\n");
    expect(t.rows.map((r) => r.cells.length)).toEqual([3, 1, 4]);
    expect(t.width).toBe(4);
  });

  it("names the line of an unclosed quote", () => {
    expect(parseTable('a,b\n1,"oops\n2,3\n', ",")).toEqual({
      ok: false,
      reason: "unclosedQuote",
      line: 2,
    });
  });

  it("reports allQuoted", () => {
    expect(table('"a","b"\n"1","2"\n').allQuoted).toBe(true);
    expect(table('"a",b\n').allQuoted).toBe(false);
  });

  it("counts offsets in UTF-16 units", () => {
    const t = table("😀,b\n");
    expect(t.rows[0].cellStart).toEqual([0, 3]);
  });
});

describe("guessDelimiter", () => {
  it("uses tab for .tsv regardless of content", () => {
    expect(guessDelimiter("a,b\n1,2\n", "x/data.tsv")).toBe("\t");
  });

  it("finds semicolon and pipe", () => {
    expect(guessDelimiter("a;b;c\n1;2;3\n", "a.csv")).toBe(";");
    expect(guessDelimiter("a|b\n1|2\n", "a.csv")).toBe("|");
  });

  it("falls back to comma for one column", () => {
    expect(guessDelimiter("id\n17\n42\n", "a.csv")).toBe(",");
  });

  it("breaks ties toward comma", () => {
    expect(guessDelimiter("a,b;c\n1,2;3\n", "a.csv")).toBe(",");
  });

  it("ignores delimiters inside quotes", () => {
    expect(guessDelimiter('"a,b,c";d\n"1,2,3";4\n', "a.csv")).toBe(";");
  });

  it("returns null when no candidate is consistent", () => {
    expect(guessDelimiter("a,b\n1,2,3,4,5\nx\n1;2\n", "a.csv")).toBeNull();
  });
});

describe("readTable", () => {
  it("is inconsistent when the guess is null", () => {
    expect(readTable("a,b\n1,2,3,4,5\nx\n1;2\n", "a.csv")).toEqual({
      ok: false,
      reason: "inconsistent",
      line: 1,
    });
  });

  it("honours an override", () => {
    const r = readTable("a;b\n", "a.csv", ",");
    expect(r.ok && r.table.rows[0].cells).toEqual(["a;b"]);
  });
});
