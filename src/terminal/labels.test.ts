import { describe, expect, it } from "vitest";
import { tabLabels } from "./labels";

describe("tabLabels", () => {
  it("labelsDisambiguateSameName", () => {
    expect(tabLabels(["C:\\a\\docs", "/b/docs", "/b/zukai"])).toEqual([
      "docs · a",
      "docs · b",
      "zukai",
    ]);
  });

  it("usesBaseNameWhenUnique", () => {
    expect(tabLabels(["/x/one", "/x/two/"])).toEqual(["one", "two"]);
  });
});
