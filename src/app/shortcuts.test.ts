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
