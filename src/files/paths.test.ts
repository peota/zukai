import { describe, expect, it } from "vitest";
import { languageOf, languageRename } from "./paths";

describe("languageOf", () => {
  it("reads C# from .cs and .csx", () => {
    expect(languageOf("C:\\src\\Program.cs")).toBe("csharp");
    expect(languageOf("/s/build.CSX")).toBe("csharp");
  });
});

describe("languageRename", () => {
  it("names the file for a Language its extension doesn't match", () => {
    expect(languageRename("C:\\L\\note.md", "typescript")).toEqual({
      from: "note.md",
      to: "note.ts",
      ext: "ts",
    });
    expect(languageRename("/l/a.v1.md", "plaintext")?.to).toBe("a.v1.txt");
    expect(languageRename("/l/notes", "markdown")?.to).toBe("notes.md");
    expect(languageRename("/l/Program.txt", "csharp")?.to).toBe("Program.cs");
  });

  it("offers nothing when the extension already means that Language", () => {
    expect(languageRename("C:\\L\\note.md", "markdown")).toBeNull();
    expect(languageRename("C:\\L\\App.TSX", "typescript")).toBeNull();
    expect(languageRename("C:\\L\\run.log", "plaintext")).toBeNull();
    expect(languageRename("C:\\L\\Script.csx", "csharp")).toBeNull();
  });
});
