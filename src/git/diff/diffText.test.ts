import { describe, expect, it } from "vitest";
import { diff } from "@codemirror/merge";
import { normalizeEol } from "./diffText";

describe("normalizeEol", () => {
  it("turns CRLF and lone CR into LF", () => {
    expect(normalizeEol("a\r\nb\r\n")).toBe("a\nb\n");
    expect(normalizeEol("a\rb\n")).toBe("a\nb\n");
    expect(normalizeEol("a\nb")).toBe("a\nb");
  });

  it("diffLines ignores CR-only differences", () => {
    const committed = "one\r\ntwo\r\nthree\r\n";
    const disk = "one\ntwo\nthree\n";
    expect(normalizeEol(committed)).toBe(normalizeEol(disk));
    expect(diff(normalizeEol(committed), normalizeEol(disk))).toEqual([]);
  });
});
