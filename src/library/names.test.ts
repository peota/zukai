import { describe, expect, it } from "vitest";
import type { LanguageId, TabState } from "../model/types";
import { extFor, sanitizeFileName, suggestedFileName } from "./names";

const tab = (over: Partial<TabState>): TabState => ({
  id: "t",
  kind: "text",
  title: "Notes",
  renamed: false,
  language: "plaintext",
  languagePicked: false,
  languageGuessed: false,
  selection: { anchor: 0, head: 0 },
  scrollTop: 0,
  wrap: true,
  ...over,
});

describe("names", () => {
  it("sanitizeStripsIllegalAndEmptyBecomesUntitled", () => {
    expect(sanitizeFileName("a/b: c?")).toBe("a b c");
    expect(sanitizeFileName("  ...  ")).toBe("Untitled");
    expect(sanitizeFileName("")).toBe("Untitled");
    expect(sanitizeFileName("bad\u0001\u007fname.")).toBe("bad name");
    expect(sanitizeFileName("x  \t y")).toBe("x y");
  });

  it("sanitizeAvoidsWindowsReservedNames", () => {
    expect(sanitizeFileName("CON")).toBe("CON_");
    expect(sanitizeFileName("nul")).toBe("nul_");
    expect(sanitizeFileName("com1")).toBe("com1_");
    expect(sanitizeFileName("LPT9.txt")).toBe("LPT9.txt_");
    expect(sanitizeFileName("console")).toBe("console");
    expect(sanitizeFileName("com10")).toBe("com10");
  });

  it("extForEachLanguageAndCanvas", () => {
    const want: Record<LanguageId, string> = {
      plaintext: ".txt",
      markdown: ".md",
      json: ".json",
      sql: ".sql",
      python: ".py",
      yaml: ".yaml",
      javascript: ".js",
      typescript: ".ts",
      html: ".html",
      xml: ".xml",
      css: ".css",
      shell: ".sh",
    };
    for (const [language, ext] of Object.entries(want)) {
      expect(extFor(tab({ language: language as LanguageId }))).toBe(ext);
    }
    expect(extFor(tab({ kind: "canvas" }))).toBe(".excalidraw");
    expect(suggestedFileName(tab({ title: "a/b", language: "markdown" }))).toBe(
      "a b.md",
    );
  });
});
