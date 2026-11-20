import { describe, expect, it } from "vitest";
import { isTerminalTarget, routeKey } from "./keys";
import type { KeyInfo, Platform } from "../app/shortcuts";

const ev = (code: string, o: Partial<KeyInfo> = {}): KeyInfo => ({
  key: o.key ?? code.replace(/^Key/, "").toLowerCase(),
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...o,
});
const ctrl = (code: string, o: Partial<KeyInfo> = {}) =>
  ev(code, { ctrlKey: true, ...o });
const cmd = (code: string, o: Partial<KeyInfo> = {}) =>
  ev(code, { metaKey: true, ...o });

describe.each(["windows", "other"] as Platform[])("routeKey (%s)", (p) => {
  it("sends the shell's Ctrl letters to the shell", () => {
    for (const c of ["KeyP", "KeyR", "KeyW", "KeyN", "KeyB"]) {
      expect(routeKey(ctrl(c), p, false)).toBe("shell");
    }
  });
  it("Ctrl+C copies with a selection, else goes to the shell", () => {
    expect(routeKey(ctrl("KeyC"), p, false)).toBe("shell");
    expect(routeKey(ctrl("KeyC"), p, true)).toBe("copy");
  });
  it("Ctrl+Shift+C copies, Ctrl+V and Ctrl+Shift+V paste", () => {
    expect(routeKey(ctrl("KeyC", { shiftKey: true }), p, false)).toBe("copy");
    expect(routeKey(ctrl("KeyV"), p, false)).toBe("paste");
    expect(routeKey(ctrl("KeyV", { shiftKey: true }), p, false)).toBe("paste");
  });
  it("sends zoom, Settings and Quit to the app", () => {
    expect(routeKey(ctrl("Equal", { key: "=" }), p, false)).toBe("app");
    expect(routeKey(ctrl("Minus", { key: "-" }), p, false)).toBe("app");
    expect(routeKey(ctrl("Digit0", { key: "0" }), p, false)).toBe("app");
    expect(routeKey(ctrl("NumpadAdd", { key: "+" }), p, false)).toBe("app");
    expect(routeKey(ctrl("NumpadSubtract", { key: "-" }), p, false)).toBe(
      "app",
    );
    expect(routeKey(ctrl("Numpad0", { key: "0" }), p, false)).toBe("app");
    expect(routeKey(ctrl("Comma", { key: "," }), p, false)).toBe("app");
    expect(routeKey(ctrl("KeyQ"), p, false)).toBe("app");
  });
  it("sends the terminal and tab shortcuts to the app", () => {
    expect(routeKey(ctrl("Backquote", { key: "`" }), p, false)).toBe("app");
    expect(
      routeKey(ctrl("Backquote", { key: "~", shiftKey: true }), p, false),
    ).toBe("app");
    expect(routeKey(ctrl("Tab"), p, false)).toBe("app");
    expect(routeKey(ctrl("Tab", { shiftKey: true }), p, false)).toBe("app");
  });
  it("sends plain keys and AltGr to the shell", () => {
    expect(routeKey(ev("KeyA"), p, false)).toBe("shell");
    expect(routeKey(ctrl("KeyQ", { altKey: true }), p, false)).toBe("shell");
  });
  it("uses the typed letter on non-Latin layouts", () => {
    expect(routeKey(ctrl("KeyC", { key: "с" }), p, true)).toBe("copy");
  });
});

describe("routeKey (mac)", () => {
  it("Cmd+C copies, Cmd+V pastes, other Cmd keys go to the app", () => {
    expect(routeKey(cmd("KeyC"), "mac", false)).toBe("copy");
    expect(routeKey(cmd("KeyV"), "mac", false)).toBe("paste");
    expect(routeKey(cmd("KeyP"), "mac", false)).toBe("app");
    expect(routeKey(cmd("KeyW"), "mac", false)).toBe("app");
  });
  it("Ctrl keys go to the shell, except the terminal and tab keys", () => {
    expect(routeKey(ctrl("KeyC"), "mac", true)).toBe("shell");
    expect(routeKey(ctrl("KeyP"), "mac", false)).toBe("shell");
    expect(routeKey(ctrl("Backquote", { key: "`" }), "mac", false)).toBe("app");
    expect(routeKey(ctrl("Tab"), "mac", false)).toBe("app");
  });
});

describe("isTerminalTarget", () => {
  it("is true inside [data-z-terminal] only", () => {
    const host = document.createElement("div");
    host.setAttribute("data-z-terminal", "");
    const inner = document.createElement("textarea");
    host.append(inner);
    expect(isTerminalTarget(inner)).toBe(true);
    expect(isTerminalTarget(document.createElement("div"))).toBe(false);
    expect(isTerminalTarget(null)).toBe(false);
  });
});
