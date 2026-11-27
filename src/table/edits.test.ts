import { describe, expect, it } from "vitest";
import {
  applyChanges,
  deleteColumn,
  deleteRows,
  insertColumn,
  insertRows,
  setCell,
  type EditResult,
} from "./edits";
import { parseTable, type Delimiter, type ParsedTable } from "./parse";

const parse = (s: string, d: Delimiter = ","): ParsedTable =>
  (parseTable(s, d) as { table: ParsedTable }).table;

type Affected = number | [number, number];

/**
 * Asserts the new text, the oracle, and that each change falls within one
 * affected row's [start, end+eol.length] (or, for a [first, last] pair, within
 * that contiguous run of rows).
 */
function check(
  text: string,
  r: EditResult,
  expected: string,
  affected: Affected[],
  d: Delimiter = ",",
) {
  const next = applyChanges(text, r.changes);
  expect(next).toBe(expected);
  expect(r.table).toEqual(parse(next, d));
  const rows = parse(text, d).rows;
  for (const c of r.changes) {
    const ok = affected.some((a) => {
      const [first, last] = typeof a === "number" ? [a, a] : a;
      return (
        c.from >= rows[first].start &&
        c.to <= rows[last].end + rows[last].eol.length
      );
    });
    expect(ok, `change ${JSON.stringify(c)} outside affected rows`).toBe(true);
  }
}

describe("setCell", () => {
  it("bare to bare", () => {
    const text = "a,b\n1,2\n";
    const r = setCell(parse(text), 1, 1, "9");
    check(text, r, "a,b\n1,9\n", [1]);
    expect(r.changes).toEqual([{ from: 6, to: 7, insert: "9" }]);
  });

  it("keeps quotes", () => {
    const text = 'a,"b"\n';
    check(text, setCell(parse(text), 0, 1, "c"), 'a,"c"\n', [0]);
  });

  it("quotes only when needed", () => {
    const text = "a\nb\n";
    const t = parse(text);
    check(text, setCell(t, 1, 0, "x,y"), 'a\n"x,y"\n', [1]);
    check(text, setCell(t, 1, 0, 'say "hi"'), 'a\n"say ""hi"""\n', [1]);
    check(text, setCell(t, 1, 0, "l1\nl2"), 'a\n"l1\nl2"\n', [1]);
    check(text, setCell(t, 1, 0, "plain"), "a\nplain\n", [1]);
  });

  it("uses the table's delimiter", () => {
    const text = "a;b\n1;2,3\n";
    check(
      text,
      setCell(parse(text, ";"), 1, 0, "x,y"),
      "a;b\nx,y;2,3\n",
      [1],
      ";",
    );
    check(
      text,
      setCell(parse(text, ";"), 1, 0, "x;y"),
      'a;b\n"x;y";2,3\n',
      [1],
      ";",
    );
  });

  it("edits a multi-line quoted cell", () => {
    const text = 'a,"l1\nl2"\n3,4\n';
    check(text, setCell(parse(text), 0, 1, "z"), 'a,"z"\n3,4\n', [0]);
  });

  it("in an allQuoted file writes quoted", () => {
    const t1 = '"a",""\n';
    check(t1, setCell(parse(t1), 0, 1, "x"), '"a","x"\n', [0]);
    check(t1, setCell(parse(t1), 0, 1, ""), '"a",""\n', [0]);
    const t2 = '"a","b"\n"1"\n';
    check(t2, setCell(parse(t2), 1, 1, "x"), '"a","b"\n"1","x"\n', [1]);
    check(t2, setCell(parse(t2), 1, 2, "x"), '"a","b"\n"1","","x"\n', [1]);
  });

  it("pads a ragged row", () => {
    const text = "a,b,c\n1\n";
    check(text, setCell(parse(text), 1, 2, "x"), "a,b,c\n1,,x\n", [1]);
  });

  it("works after an emoji", () => {
    const text = "😀,b\n";
    check(text, setCell(parse(text), 0, 1, "c"), "😀,c\n", [0]);
  });

  it("fills a blank line and the last row without newline", () => {
    const text = "a,b\n\n1,2";
    check(text, setCell(parse(text), 1, 0, "x"), "a,b\nx\n1,2", [1]);
    check(text, setCell(parse(text), 2, 1, "9"), "a,b\n\n1,9", [2]);
  });

  it("emptying the only cell leaves a blank line; quoting can make allQuoted", () => {
    const text = "a\nb\n";
    check(text, setCell(parse(text), 0, 0, ""), "\nb\n", [0]);
    const mixed = '"a"\nb\n';
    check(mixed, setCell(parse(mixed), 1, 0, "x,y"), '"a"\n"x,y"\n', [1]);
  });
});

describe("insertRows", () => {
  it("middle", () => {
    const text = "a,b\n1,2\n";
    check(text, insertRows(parse(text), 1, 1), "a,b\n,\n1,2\n", [1]);
  });

  it("at start and several at once", () => {
    const text = "a,b\n1,2\n";
    check(text, insertRows(parse(text), 0, 2), ",\n,\na,b\n1,2\n", [0]);
  });

  it("uses the previous row's eol", () => {
    const crlf = "a,b\r\n1,2\r\n";
    check(crlf, insertRows(parse(crlf), 2, 1), "a,b\r\n1,2\r\n,\r\n", [1]);
    const mixed = "a\r\nb\nc\n";
    check(mixed, insertRows(parse(mixed), 2, 1), "a\r\nb\n\nc\n", [1, 2]);
  });

  it("at the end with no final newline", () => {
    const text = "a,b\n1,2";
    check(text, insertRows(parse(text), 2, 1), "a,b\n1,2\n,", [1]);
    check(text, insertRows(parse(text), 2, 2), "a,b\n1,2\n,\n,", [1]);
  });

  it("at the end after a final newline", () => {
    const text = "a,b\n1,2\n";
    check(text, insertRows(parse(text), 2, 1), "a,b\n1,2\n,\n", [1]);
  });

  it("in an allQuoted file", () => {
    const text = '"a","b"\n';
    check(text, insertRows(parse(text), 1, 1), '"a","b"\n"",""\n', [0]);
  });

  it("into an empty table", () => {
    const r = insertRows(parse(""), 0, 2);
    expect(r.changes).toEqual([{ from: 0, to: 0, insert: "\n\n" }]);
    expect(r.table).toEqual(parse("\n\n"));
  });
});

describe("deleteRows", () => {
  it("one row", () => {
    const text = "a\nb\nc\n";
    check(text, deleteRows(parse(text), [1]), "a\nc\n", [1]);
  });

  it("the last row without final newline", () => {
    const text = "a\nb";
    check(text, deleteRows(parse(text), [1]), "a", [[0, 1]]);
  });

  it("first and last, unsorted with duplicates", () => {
    const text = "a\nb\nc\n";
    check(text, deleteRows(parse(text), [2, 0, 2]), "b\n", [0, 2]);
  });

  it("everything", () => {
    const text = "a\nb";
    check(text, deleteRows(parse(text), [0, 1]), "", [[0, 1]]);
  });

  it("a multi-line quoted record", () => {
    const text = 'a\n"x\ny"\nc\n';
    check(text, deleteRows(parse(text), [1]), "a\nc\n", [1]);
  });
});

describe("insertColumn", () => {
  const text = "a,b\n1,2\n";
  it("in the middle", () => {
    check(text, insertColumn(parse(text), 1, "n"), "a,n,b\n1,,2\n", [0, 1]);
  });
  it("at the end", () => {
    check(text, insertColumn(parse(text), 2, "n"), "a,b,n\n1,2,\n", [0, 1]);
  });
  it("leaves short rows untouched", () => {
    const ragged = "a,b,c\n1\n";
    check(ragged, insertColumn(parse(ragged), 2, "n"), "a,b,n,c\n1\n", [0]);
  });
  it("quotes a name that needs it, and fills quoted in allQuoted files", () => {
    check(
      text,
      insertColumn(parse(text), 0, "x,y"),
      '"x,y",a,b\n,1,2\n',
      [0, 1],
    );
    const q = '"a"\n"b"\n';
    check(q, insertColumn(parse(q), 1, "n"), '"a","n"\n"b",""\n', [0, 1]);
  });
  it("without a name", () => {
    check(text, insertColumn(parse(text), 0), ",a,b\n,1,2\n", [0, 1]);
  });
});

describe("deleteColumn", () => {
  const text = "a,b,c\n1,2,3\n";
  it("middle", () => {
    check(text, deleteColumn(parse(text), 1), "a,c\n1,3\n", [0, 1]);
  });
  it("first", () => {
    check(text, deleteColumn(parse(text), 0), "b,c\n2,3\n", [0, 1]);
  });
  it("last", () => {
    check(text, deleteColumn(parse(text), 2), "a,b\n1,2\n", [0, 1]);
  });
  it("leaves rows without that cell untouched", () => {
    const ragged = "a,b,c\n1\n";
    check(ragged, deleteColumn(parse(ragged), 2), "a,b\n1\n", [0]);
  });
  it("keeps quoted cells and multi-line cells intact", () => {
    const q = '"a,1","b\nx",c\n';
    check(q, deleteColumn(parse(q), 0), '"b\nx",c\n', [0]);
    check(q, deleteColumn(parse(q), 1), '"a,1",c\n', [0]);
  });
  it("the only column leaves an empty line", () => {
    const one = "a\nb\n";
    check(one, deleteColumn(parse(one), 0), "\n\n", [0, 1]);
    const q = '"a"\n"b"\n';
    check(q, deleteColumn(parse(q), 0), "\n\n", [0, 1]);
  });
});

describe("blank last row without a line ending", () => {
  it("insertRows writes an empty quoted cell", () => {
    check("a\nb", insertRows(parse("a\nb"), 2, 1), 'a\nb\n""', [1]);
    check("a", insertRows(parse("a"), 1, 1), 'a\n""', [0]);
    check("a\nb", insertRows(parse("a\nb"), 2, 2), 'a\nb\n\n""', [1]);
  });

  it("insertRows with wider rows needs no exception", () => {
    check("a,b\n1,2", insertRows(parse("a,b\n1,2"), 2, 1), "a,b\n1,2\n,", [1]);
  });

  it("setCell to empty writes an empty quoted cell", () => {
    check("a\nb", setCell(parse("a\nb"), 1, 0, ""), 'a\n""', [1]);
    check("a", setCell(parse("a"), 0, 0, ""), '""', [0]);
  });

  it("setCell to empty with a final newline stays blank", () => {
    check("a\nb\n", setCell(parse("a\nb\n"), 1, 0, ""), "a\n\n", [1]);
  });

  it("deleteColumn drops the vanished row from table", () => {
    check("a\nb", deleteColumn(parse("a\nb"), 0), "\n", [0, 1]);
    check("a,b\n1", deleteColumn(parse("a,b\n1"), 0), "b\n", [0, 1]);
  });

  it("deleteRows drops the vanished row from table", () => {
    check("a\n\nb", deleteRows(parse("a\n\nb"), [2]), "a\n", [[1, 2]]);
    check("\nb", deleteRows(parse("\nb"), [1]), "", [[0, 1]]);
  });
});

describe("range checks", () => {
  const t = parse("a,b\n1,2\n");
  it("setCell", () => {
    expect(() => setCell(t, -1, 0, "x")).toThrow(Error);
    expect(() => setCell(t, 2, 0, "x")).toThrow(Error);
    expect(() => setCell(t, 0, -1, "x")).toThrow(Error);
  });
  it("insertRows", () => {
    expect(() => insertRows(t, -1, 1)).toThrow(Error);
    expect(() => insertRows(t, 3, 1)).toThrow(Error);
    expect(() => insertRows(t, 1, 0)).toThrow(Error);
  });
  it("columns", () => {
    expect(() => insertColumn(t, -1)).toThrow(Error);
    expect(() => deleteColumn(t, -1)).toThrow(Error);
  });
});

describe("insertColumn pads the header", () => {
  it("names a column past a short header row", () => {
    const text = "a\n1,2,3\n";
    check(text, insertColumn(parse(text), 2, "n"), "a,,n\n1,2,,3\n", [0, 1]);
  });
  it("in an allQuoted file pads quoted", () => {
    const text = '"a"\n"1","2"\n';
    check(
      text,
      insertColumn(parse(text), 2, "n"),
      '"a","","n"\n"1","2",""\n',
      [0, 1],
    );
  });
});
