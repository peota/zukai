import { describe, expect, it } from "vitest";
import { tabLabels } from "./labels";

describe("tabLabels", () => {
  it("labelsDisambiguateSameName", () => {
    expect(
      tabLabels([
        { cwd: "C:\\a\\docs" },
        { cwd: "/b/docs" },
        { cwd: "/b/zukai" },
      ]),
    ).toEqual(["docs · a", "docs · b", "zukai"]);
  });

  it("usesBaseNameWhenUnique", () => {
    expect(tabLabels([{ cwd: "/x/one" }, { cwd: "/x/two/" }])).toEqual([
      "one",
      "two",
    ]);
  });

  it("prefixesTheAgentName", () => {
    expect(
      tabLabels([
        { cwd: "/a/docs", agent: "Claude Code" },
        { cwd: "/b/zukai" },
      ]),
    ).toEqual(["Claude Code · docs", "zukai"]);
  });

  it("judgesCollisionsOnFolderNamesAcrossAllTabs", () => {
    expect(
      tabLabels([{ cwd: "/a/docs", agent: "Codex" }, { cwd: "/b/docs" }]),
    ).toEqual(["Codex · docs · a", "docs · b"]);
  });
});
