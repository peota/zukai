import { describe, expect, it } from "vitest";
import { LANGUAGES, loadLanguage } from "./languages";
import type { LanguageId } from "../model/types";

const ALL_IDS: LanguageId[] = [
  "plaintext",
  "markdown",
  "json",
  "javascript",
  "typescript",
  "html",
  "xml",
  "css",
  "sql",
  "python",
  "yaml",
  "shell",
];

describe("LANGUAGES", () => {
  it("lists exactly the 12 LanguageIds, in menu order", () => {
    expect(LANGUAGES.map((l) => l.id)).toEqual(ALL_IDS);
    expect(LANGUAGES.map((l) => l.label)).toEqual([
      "Plain Text",
      "Markdown",
      "JSON",
      "JavaScript",
      "TypeScript",
      "HTML",
      "XML",
      "CSS",
      "SQL",
      "Python",
      "YAML",
      "Shell",
    ]);
  });

  it.each(ALL_IDS)("loadLanguage(%s) resolves", async (id) => {
    await expect(loadLanguage(id)).resolves.toBeDefined();
  });

  it("plaintext resolves to no extension", async () => {
    expect(await loadLanguage("plaintext")).toEqual([]);
  });
});
