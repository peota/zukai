import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("keeps valid values", () => {
    expect(
      parseSettings({
        theme: "dark",
        wrapNewTabs: true,
        lineNumbers: false,
        previewSplit: 0.35,
      }),
    ).toEqual({
      theme: "dark",
      wrapNewTabs: true,
      lineNumbers: false,
      previewSplit: 0.35,
    });
  });

  it("gives each missing or malformed value its default, alone", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("dark")).toEqual(DEFAULT_SETTINGS);
    expect(
      parseSettings({ theme: "blue", wrapNewTabs: "yes", lineNumbers: false }),
    ).toEqual({
      theme: "system",
      wrapNewTabs: false,
      lineNumbers: false,
      previewSplit: 0.5,
    });
  });
});

describe("previewSplit", () => {
  it("is kept within 20–80%", () => {
    expect(parseSettings({ previewSplit: 0.05 }).previewSplit).toBe(0.2);
    expect(parseSettings({ previewSplit: 2 }).previewSplit).toBe(0.8);
    expect(parseSettings({ previewSplit: "x" }).previewSplit).toBe(0.5);
  });
});
