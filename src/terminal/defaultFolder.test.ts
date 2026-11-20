import { describe, expect, it } from "vitest";
import { defaultFolder, plusFolder } from "./defaultFolder";

const added = [
  { path: "/gone", available: false },
  { path: "/extra", available: true },
];

describe("defaultFolder", () => {
  it("defaultFolderUsesActiveFilesFolder", () => {
    expect(
      defaultFolder({
        activeFile: "/lib/notes/a.md",
        root: "/lib",
        rootAvailable: true,
        added: [],
      }),
    ).toBe("/lib/notes");
    expect(
      defaultFolder({
        activeFile: "/extra/x/b.md",
        root: "/lib",
        rootAvailable: true,
        added,
      }),
    ).toBe("/extra/x");
  });

  it("defaultFolderIgnoresFileOutsideRoots", () => {
    expect(
      defaultFolder({
        activeFile: "/other/a.md",
        root: "/lib",
        rootAvailable: true,
        added,
      }),
    ).toBe("/lib");
    expect(
      defaultFolder({
        activeFile: "/gone/a.md",
        root: "/lib",
        rootAvailable: false,
        added,
      }),
    ).toBe("/extra");
  });

  it("defaultFolderFallsBackToRootThenAdded", () => {
    expect(defaultFolder({ root: "/lib", rootAvailable: true, added })).toBe(
      "/lib",
    );
    expect(defaultFolder({ root: "/lib", rootAvailable: false, added })).toBe(
      "/extra",
    );
  });

  it("defaultFolderNullWhenNothingAvailable", () => {
    expect(
      defaultFolder({
        activeFile: "/lib/a.md",
        root: null,
        rootAvailable: false,
        added: [{ path: "/gone", available: false }],
      }),
    ).toBeNull();
    expect(
      defaultFolder({ root: "/lib", rootAvailable: false, added: [] }),
    ).toBeNull();
  });
});

describe("plusFolder", () => {
  const term = { id: 1, cwd: "/lib/sub", exited: undefined };

  it("usesActiveCwdWhenGranted", () => {
    expect(plusFolder(term, ["/lib"], "/fb")).toBe("/lib/sub");
    expect(plusFolder({ ...term, cwd: "/lib" }, ["/lib"], "/fb")).toBe("/lib");
  });

  it("plusFallsBackWhenCwdNoLongerGranted", () => {
    expect(plusFolder(term, ["/other"], "/fb")).toBe("/fb");
    expect(plusFolder(undefined, ["/lib"], "/fb")).toBe("/fb");
    expect(plusFolder(undefined, [], null)).toBeNull();
  });
});
