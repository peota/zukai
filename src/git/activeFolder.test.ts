import { describe, expect, it } from "vitest";
import { activeGitFolder } from "./activeFolder";

describe("activeGitFolder", () => {
  const folders = ["C:\\lib", "C:\\lib\\work", "D:\\other"];

  it("picks the most specific folder holding the file", () => {
    expect(
      activeGitFolder({ activeFile: "C:\\lib\\work\\a.md", folders }),
    ).toBe("C:\\lib\\work");
    expect(activeGitFolder({ activeFile: "C:\\lib\\b.md", folders })).toBe(
      "C:\\lib",
    );
  });

  it("is the diff Tab's folder when there is one", () => {
    expect(
      activeGitFolder({
        diffFolder: "D:\\other",
        activeFile: "C:\\lib\\b.md",
        folders,
      }),
    ).toBe("D:\\other");
  });

  it("is null for a scratchpad or a file outside every folder", () => {
    expect(activeGitFolder({ folders })).toBeNull();
    expect(activeGitFolder({ activeFile: "E:\\x.md", folders })).toBeNull();
  });
});
