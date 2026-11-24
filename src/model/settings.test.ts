import { describe, expect, it } from "vitest";
import { clampTerminalSize, DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("keeps valid values", () => {
    expect(
      parseSettings({
        theme: "dark",
        lightTheme: "solar-light",
        darkTheme: "midnight",
        accent: "violet",
        uiFontSize: 16,
        wrapNewTabs: true,
        lineNumbers: false,
        autosaveFiles: true,
        previewSplit: 0.35,
        markdownDefault: "markdown",
      }),
    ).toEqual({
      theme: "dark",
      lightTheme: "solar-light",
      darkTheme: "midnight",
      accent: "violet",
      uiFontSize: 16,
      wrapNewTabs: true,
      lineNumbers: false,
      autosaveFiles: true,
      revealActiveFile: true,
      previewSplit: 0.35,
      markdownDefault: "markdown",
      terminalPosition: "bottom",
      terminalHeight: 280,
      terminalWidth: 480,
    });
  });

  it("gives each missing or malformed value its default, alone", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("dark")).toEqual(DEFAULT_SETTINGS);
    expect(
      parseSettings({
        theme: "blue",
        darkTheme: "neon",
        accent: 7,
        wrapNewTabs: "yes",
        lineNumbers: false,
        autosaveFiles: "yes",
      }),
    ).toEqual({
      theme: "system",
      lightTheme: "paper",
      darkTheme: "graphite",
      accent: "blue",
      uiFontSize: 14,
      wrapNewTabs: false,
      lineNumbers: false,
      autosaveFiles: false,
      revealActiveFile: true,
      previewSplit: 0.5,
      markdownDefault: "rich",
      terminalPosition: "bottom",
      terminalHeight: 280,
      terminalWidth: 480,
    });
  });
});

describe("autosaveFiles", () => {
  it("is off by default and kept only when a boolean", () => {
    expect(DEFAULT_SETTINGS.autosaveFiles).toBe(false);
    expect(parseSettings({ autosaveFiles: true }).autosaveFiles).toBe(true);
    expect(parseSettings({}).autosaveFiles).toBe(false);
    expect(parseSettings({ autosaveFiles: 1 }).autosaveFiles).toBe(false);
  });
});

describe("revealActiveFile", () => {
  it("is on by default and kept only when a boolean", () => {
    expect(DEFAULT_SETTINGS.revealActiveFile).toBe(true);
    expect(parseSettings({ revealActiveFile: false }).revealActiveFile).toBe(
      false,
    );
    expect(parseSettings({}).revealActiveFile).toBe(true);
    expect(parseSettings({ revealActiveFile: 0 }).revealActiveFile).toBe(true);
  });
});

describe("markdownDefault", () => {
  it("defaults to rich, keeps a valid value, and defaults a bad one", () => {
    expect(DEFAULT_SETTINGS.markdownDefault).toBe("rich");
    expect(parseSettings({ markdownDefault: "markdown" }).markdownDefault).toBe(
      "markdown",
    );
    expect(parseSettings({ markdownDefault: "rich" }).markdownDefault).toBe(
      "rich",
    );
    expect(parseSettings({ markdownDefault: "html" }).markdownDefault).toBe(
      "rich",
    );
    expect(parseSettings({}).markdownDefault).toBe("rich");
  });
});

describe("previewSplit", () => {
  it("is kept within 20–80%", () => {
    expect(parseSettings({ previewSplit: 0.05 }).previewSplit).toBe(0.2);
    expect(parseSettings({ previewSplit: 2 }).previewSplit).toBe(0.8);
    expect(parseSettings({ previewSplit: "x" }).previewSplit).toBe(0.5);
  });
});

describe("uiFontSize", () => {
  it("is 14px by default, kept within 11–18 when a number", () => {
    expect(DEFAULT_SETTINGS.uiFontSize).toBe(14);
    expect(parseSettings({ uiFontSize: 16 }).uiFontSize).toBe(16);
    expect(parseSettings({ uiFontSize: 40 }).uiFontSize).toBe(18);
    expect(parseSettings({ uiFontSize: 2 }).uiFontSize).toBe(11);
    expect(parseSettings({ uiFontSize: "big" }).uiFontSize).toBe(14);
  });
});

describe("terminal settings", () => {
  it("parseSettingsDefaultsTerminalFields", () => {
    const s = parseSettings({});
    expect(s.terminalPosition).toBe("bottom");
    expect(s.terminalHeight).toBe(280);
    expect(s.terminalWidth).toBe(480);
  });

  it("parseSettingsRejectsBadTerminalPosition", () => {
    expect(parseSettings({ terminalPosition: "left" }).terminalPosition).toBe(
      "bottom",
    );
    expect(parseSettings({ terminalPosition: "side" }).terminalPosition).toBe(
      "side",
    );
  });

  it("parseSettingsKeepsStoredSizes", () => {
    expect(parseSettings({ terminalHeight: 333 }).terminalHeight).toBe(333);
    expect(parseSettings({ terminalWidth: 5000 }).terminalWidth).toBe(5000);
  });

  it("parseSettingsRejectsBadSizes", () => {
    expect(parseSettings({ terminalHeight: 119 }).terminalHeight).toBe(280);
    expect(parseSettings({ terminalWidth: 239 }).terminalWidth).toBe(480);
    expect(parseSettings({ terminalHeight: NaN }).terminalHeight).toBe(280);
    expect(parseSettings({ terminalWidth: Infinity }).terminalWidth).toBe(480);
    expect(parseSettings({ terminalHeight: "300" }).terminalHeight).toBe(280);
  });

  it("clampTerminalSizeCapsAtSeventyPercent", () => {
    expect(clampTerminalSize(900, 120, 1000)).toBe(700);
    expect(clampTerminalSize(50, 120, 1000)).toBe(120);
    expect(clampTerminalSize(300.6, 120, 1000)).toBe(301);
    expect(clampTerminalSize(500, 120, 100)).toBe(120);
  });
});
