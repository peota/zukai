import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { indentUnit } from "@codemirror/language";
import { detectIndentUnit } from "./indentUnit";

describe("detectIndentUnit", () => {
  it("falls back to 4 spaces (PEP 8)", () => {
    expect(detectIndentUnit("")).toBe("    ");
    expect(detectIndentUnit("x = 1\n")).toBe("    ");
  });

  it("reads the step the file indents by", () => {
    const four = "def f():\n    if x:\n        pass\n    return 1\n";
    expect(detectIndentUnit(four)).toBe("    ");
    const two = "def f():\n  if x:\n    pass\n  return 1\n";
    expect(detectIndentUnit(two)).toBe("  ");
  });

  it("uses a tab when the file indents with tabs", () => {
    expect(detectIndentUnit("def f():\n\treturn 1\n")).toBe("\t");
  });

  it("ignores blank lines and odd one-space continuations", () => {
    const text = "def f():\n\n    x = (1,\n     2)\n    return x\n";
    expect(detectIndentUnit(text)).toBe("    ");
  });
});

describe("Python Enter with the detected unit", () => {
  const enter = (doc: string) => {
    let st = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [python(), indentUnit.of(detectIndentUnit(doc))],
    });
    insertNewlineAndIndent({ state: st, dispatch: (tr) => (st = tr.state) });
    return st.doc.toString().slice(doc.length);
  };

  it("indents a new block by 4 spaces", () => {
    expect(enter("def f():")).toBe("\n    ");
  });

  it("keeps the body's column after a body line", () => {
    expect(enter("def f():\n    x = 1")).toBe("\n    ");
  });
});
