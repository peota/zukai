import { describe, expect, it } from "vitest";
import { StringStream } from "@codemirror/language";
import { csharp } from "@codemirror/legacy-modes/mode/clike";
import { withRawStrings } from "./csharp";

const parser = withRawStrings(csharp);

/** Each line's tokens as [text, style] pairs, whitespace left out. */
function tokens(src: string): [string, string | null][][] {
  const state = parser.startState!(2);
  return src.split("\n").map((line) => {
    const stream = new StringStream(line, 4, 2);
    const out: [string, string | null][] = [];
    while (!stream.eol()) {
      stream.start = stream.pos;
      const style = parser.token(stream, state);
      const text = stream.current();
      if (text.trim()) out.push([text, style]);
    }
    return out;
  });
}

describe("withRawStrings", () => {
  it("reads a one-line raw string and the code after it", () => {
    const [line] = tokens('var s = """a "quoted" {x}"""; int y;');
    expect(line).toContainEqual(['"""a "quoted" {x}"""', "string"]);
    expect(line).toContainEqual(["int", "type"]);
  });

  it("reads an interpolated raw string over several lines", () => {
    const lines = tokens('var s = $$"""\n  {{x}} { y\n  """;\nint z;');
    expect(lines[0]).toContainEqual(['$$"""', "string"]);
    expect(lines[1]).toEqual([["  {{x}} { y", "string"]]);
    expect(lines[2][0]).toEqual(['  """', "string"]);
    expect(lines[3]).toContainEqual(["int", "type"]);
  });

  it("closes only on as many quotes as opened it", () => {
    const lines = tokens('var s = """"\n""" still\n"""";');
    expect(lines[1]).toEqual([['""" still', "string"]]);
    expect(lines[2][0]).toEqual(['""""', "string"]);
  });

  it("leaves ordinary and verbatim strings to the C# mode", () => {
    const [line] = tokens('var a = ""; var b = @"x";');
    expect(line).toContainEqual(['""', "string"]);
    expect(line).toContainEqual(['@"x"', "string"]);
  });
});
