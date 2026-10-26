import { describe, expect, it } from "vitest";
import { matchShortcut, type Platform } from "./shortcuts";

type Ev = Parameters<typeof matchShortcut>[0];
const ev = (code: string, o: Partial<Ev> = {}): Ev => ({
  key: o.key ?? code.replace(/^Key/, "").toLowerCase(),
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...o,
});
const mod = (p: Platform): Partial<Ev> =>
  p === "mac" ? { metaKey: true } : { ctrlKey: true };

describe.each(["mac", "other"] as Platform[])("matchShortcut (%s)", (p) => {
  const m = mod(p);
  it("new tab", () =>
    expect(matchShortcut(ev("KeyN", m), p)).toEqual({ type: "newTab" }));
  it("close tab", () =>
    expect(matchShortcut(ev("KeyW", m), p)).toEqual({ type: "closeTab" }));
  it("reopen tab", () =>
    expect(matchShortcut(ev("KeyT", { ...m, shiftKey: true }), p)).toEqual({
      type: "reopenTab",
    }));
  it("ctrl+tab cycles", () => {
    expect(matchShortcut(ev("Tab", { key: "Tab", ctrlKey: true }), p)).toEqual({
      type: "cycleTab",
      dir: 1,
    });
    expect(
      matchShortcut(
        ev("Tab", { key: "Tab", ctrlKey: true, shiftKey: true }),
        p,
      ),
    ).toEqual({ type: "cycleTab", dir: -1 });
  });
  it("go to tab", () => {
    expect(matchShortcut(ev("Digit1", m), p)).toEqual({
      type: "goToTab",
      n: 1,
    });
    expect(matchShortcut(ev("Digit8", m), p)).toEqual({
      type: "goToTab",
      n: 8,
    });
    expect(matchShortcut(ev("Digit9", m), p)).toEqual({
      type: "goToTab",
      n: 9,
    });
    expect(matchShortcut(ev("Digit0", m), p)).toBeNull();
  });
  it("find", () =>
    expect(matchShortcut(ev("KeyF", m), p)).toEqual({ type: "find" }));
  it("quit", () =>
    expect(matchShortcut(ev("KeyQ", m), p)).toEqual({ type: "quit" }));
  it("toggle wrap by code (Option+Z gives key Ω on mac)", () =>
    expect(matchShortcut(ev("KeyZ", { key: "Ω", altKey: true }), p)).toEqual({
      type: "toggleWrap",
    }));
  it("open, save and save as", () => {
    expect(matchShortcut(ev("KeyO", m), p)).toEqual({ type: "open" });
    expect(matchShortcut(ev("KeyS", m), p)).toEqual({ type: "save" });
    expect(
      matchShortcut(ev("KeyS", { ...m, key: "S", shiftKey: true }), p),
    ).toEqual({ type: "saveAs" });
  });
  it("Shift+Alt+F formats, by typed letter or physical key", () => {
    expect(
      matchShortcut(ev("KeyF", { key: "F", shiftKey: true, altKey: true }), p),
    ).toEqual({ type: "format" });
    // macOS Option+Shift+F types a symbol.
    expect(
      matchShortcut(ev("KeyF", { key: "Ï", shiftKey: true, altKey: true }), p),
    ).toEqual({ type: "format" });
    expect(matchShortcut(ev("KeyF", { key: "f", altKey: true }), p)).toBeNull();
    expect(
      matchShortcut(
        ev("KeyF", { ...m, key: "F", shiftKey: true, altKey: true }),
        p,
      ),
    ).toBeNull();
  });
  it("rejects extra modifiers", () => {
    expect(matchShortcut(ev("KeyN", { ...m, shiftKey: true }), p)).toBeNull();
    expect(matchShortcut(ev("KeyN", { ...m, altKey: true }), p)).toBeNull();
    expect(matchShortcut(ev("KeyN"), p)).toBeNull();
    expect(matchShortcut(ev("KeyZ", { ...m, altKey: true }), p)).toBeNull();
  });
});

describe("platform differences", () => {
  it("replace: Ctrl+H on other", () =>
    expect(matchShortcut(ev("KeyH", { ctrlKey: true }), "other")).toEqual({
      type: "replace",
    }));
  it("replace: Cmd+Alt+F on mac", () =>
    expect(
      matchShortcut(
        ev("KeyF", { metaKey: true, altKey: true, key: "ƒ" }),
        "mac",
      ),
    ).toEqual({ type: "replace" }));
  it("Cmd+H on mac is left to the OS", () =>
    expect(matchShortcut(ev("KeyH", { metaKey: true }), "mac")).toBeNull());
  it("Ctrl+Alt+F on other is not replace", () =>
    expect(
      matchShortcut(ev("KeyF", { ctrlKey: true, altKey: true }), "other"),
    ).toBeNull());
  it("Ctrl+N on mac is null", () =>
    expect(matchShortcut(ev("KeyN", { ctrlKey: true }), "mac")).toBeNull());
  it("Meta+N on other is null", () =>
    expect(matchShortcut(ev("KeyN", { metaKey: true }), "other")).toBeNull());
  it("Ctrl+Tab is ctrl even with meta on other", () =>
    expect(
      matchShortcut(ev("Tab", { ctrlKey: true, metaKey: true }), "other"),
    ).toBeNull());
});

describe("keyboard layouts", () => {
  it("AZERTY Ctrl+A (physical KeyQ) does not quit", () =>
    expect(
      matchShortcut(ev("KeyQ", { key: "a", ctrlKey: true }), "other"),
    ).toBeNull());
  it("AZERTY Ctrl+Z (physical KeyW) does not close the Tab", () =>
    expect(
      matchShortcut(ev("KeyW", { key: "z", ctrlKey: true }), "other"),
    ).toBeNull());
  it("AZERTY Ctrl+Q (physical KeyA) quits", () =>
    expect(
      matchShortcut(ev("KeyA", { key: "q", ctrlKey: true }), "other"),
    ).toEqual({ type: "quit" }));
  it("AZERTY Ctrl+W (physical KeyZ) closes the Tab", () =>
    expect(
      matchShortcut(ev("KeyZ", { key: "w", ctrlKey: true }), "other"),
    ).toEqual({ type: "closeTab" }));
  it("Dvorak Ctrl+D (physical KeyH) does not open Replace", () =>
    expect(
      matchShortcut(ev("KeyH", { key: "d", ctrlKey: true }), "other"),
    ).toBeNull());
  it("AZERTY Ctrl+Shift+S (physical KeyS) is Save As by typed letter", () =>
    expect(
      matchShortcut(
        ev("KeyO", { key: "S", ctrlKey: true, shiftKey: true }),
        "other",
      ),
    ).toEqual({ type: "saveAs" }));
  it("Dvorak Cmd+Shift+T uses the typed letter", () =>
    expect(
      matchShortcut(
        ev("KeyK", { key: "T", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toEqual({ type: "reopenTab" }));
  it("Cyrillic Ctrl+N falls back to the physical key", () =>
    expect(
      matchShortcut(ev("KeyN", { key: "т", ctrlKey: true }), "other"),
    ).toEqual({ type: "newTab" }));
  it("AltGr (Ctrl+Alt) letters and digits are left alone on other", () => {
    for (const [code, key] of [
      ["KeyQ", "@"],
      ["KeyE", "€"],
      ["KeyN", "n"],
      ["KeyW", "w"],
      ["Digit2", "@"],
      ["Digit1", "1"],
    ]) {
      expect(
        matchShortcut(ev(code, { key, ctrlKey: true, altKey: true }), "other"),
      ).toBeNull();
    }
  });
  it("digits match by physical key (AZERTY Ctrl+& is Ctrl+1)", () =>
    expect(
      matchShortcut(ev("Digit1", { key: "&", ctrlKey: true }), "other"),
    ).toEqual({ type: "goToTab", n: 1 }));
});
