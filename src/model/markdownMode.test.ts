import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import { effectiveMode, tooLargeForRich } from "./markdownMode";
import type { TabState } from "./types";
import { newTabState } from "./workspace";

const file = { path: "C:/n/a.md" } as NonNullable<TabState["file"]>;
const md = (o: Partial<TabState> = {}): TabState => ({
  ...newTabState("a"),
  language: "markdown",
  ...o,
});
const S: Settings = { ...DEFAULT_SETTINGS };

describe("effectiveMode", () => {
  it("a Markdown file is rich by default", () =>
    expect(effectiveMode(md({ file }), S)).toBe("rich"));
  it("a Scratchpad whose language was picked is rich", () =>
    expect(effectiveMode(md({ languagePicked: true }), S)).toBe("rich"));
  it("a guessed Scratchpad is markdown", () =>
    expect(
      effectiveMode(md({ languageGuessed: true, languagePicked: false }), S),
    ).toBe("markdown"));
  it("an explicit markdown beats the rich default", () =>
    expect(effectiveMode(md({ file, markdownMode: "markdown" }), S)).toBe(
      "markdown",
    ));
  it("an explicit mode beats the guess rule", () =>
    expect(effectiveMode(md({ markdownMode: "rich" }), S)).toBe("rich"));
  it("a non-markdown Tab is null", () => {
    expect(effectiveMode({ ...md({ file }), language: "json" }, S)).toBeNull();
    expect(effectiveMode({ ...md({ file }), kind: "canvas" }, S)).toBeNull();
  });
  it("follows a markdown default setting", () =>
    expect(
      effectiveMode(md({ file }), { ...S, markdownDefault: "markdown" }),
    ).toBe("markdown"));
});

describe("tooLargeForRich", () => {
  it("counts UTF-8 bytes", () => {
    expect(tooLargeForRich("a".repeat(1_048_576))).toBe(false);
    expect(tooLargeForRich("a".repeat(1_048_577))).toBe(true);
    expect(tooLargeForRich("é".repeat(524_289))).toBe(true);
    expect(tooLargeForRich("é".repeat(524_288))).toBe(false);
  });

  it("encodes_only_when_the_length_cannot_tell", () => {
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    try {
      // Over the limit in UTF-16 units is over it in bytes; a third of it
      // can't be (3 bytes per unit at most).
      expect(tooLargeForRich("a".repeat(1_048_577))).toBe(true);
      expect(tooLargeForRich("é".repeat(349_525))).toBe(false);
      expect(encode).not.toHaveBeenCalled();
    } finally {
      encode.mockRestore();
    }
  });
});
