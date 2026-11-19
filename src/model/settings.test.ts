import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("keeps valid values", () => {
    expect(
      parseSettings({ theme: "dark", wrapNewTabs: true, lineNumbers: false }),
    ).toEqual({ theme: "dark", wrapNewTabs: true, lineNumbers: false });
  });

  it("gives each missing or malformed value its default, alone", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("dark")).toEqual(DEFAULT_SETTINGS);
    expect(
      parseSettings({ theme: "blue", wrapNewTabs: "yes", lineNumbers: false }),
    ).toEqual({ theme: "system", wrapNewTabs: false, lineNumbers: false });
  });
});
