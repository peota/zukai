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

describe("long names", () => {
  it("capsStemAndSuggestedName", () => {
    const stem = sanitizeFileName("x".repeat(1000));
    expect(stem.length).toBeLessThanOrEqual(200);
    const t = tab({ title: "y ".repeat(500), language: "typescript" });
    expect(suggestedFileName(t).length).toBeLessThanOrEqual(255);
  });

  it("neverSplitsSurrogatePair", () => {
    for (const pad of [197, 198, 199, 200]) {
      const s = sanitizeFileName("a".repeat(pad) + "😀".repeat(5));
      expect(s.length).toBeLessThanOrEqual(200);
      expect(s).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
      expect(s).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/);
    }
  });

  it("retrimsAfterCut", () => {
    const s = sanitizeFileName("a".repeat(150) + " . . " + "b".repeat(100));
    expect(s.length).toBeLessThanOrEqual(200);
    expect(s).toMatch(/[^ .]$/);
    expect(sanitizeFileName("CON" + ".".repeat(300) + "z")).toBe("CON_");
  });
});
