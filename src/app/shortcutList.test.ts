import { describe, expect, it } from "vitest";
import { formatKeys, SHORTCUTS, shortcutsFor } from "./shortcutList";
import type { Command } from "./shortcuts";

/** Every Command type; the compiler insists the list stays complete. */
const ALL: Record<Command["type"], true> = {
  newTab: true,
  closeTab: true,
  reopenTab: true,
  cycleTab: true,
  goToTab: true,
  find: true,
  replace: true,
  toggleWrap: true,
  quit: true,
  open: true,
  save: true,
  saveAs: true,
  format: true,
  toggleSidebar: true,
  focusSidebar: true,
  newCanvas: true,
  zoom: true,
  openSettings: true,
  togglePreview: true,
  toggleSplit: true,
  toggleRichMarkdown: true,
};

describe("the shortcut list", () => {
  it.each(["windows", "mac", "other"] as const)(
    "lists every app command on %s",
    (p) => {
      const listed = new Set(shortcutsFor(p).map((s) => s.command));
      for (const type of Object.keys(ALL)) expect(listed).toContain(type);
    },
  );

  it("shows each platform's own Replace and Redo", () => {
    const keysOf = (p: "windows" | "mac", action: string) =>
      shortcutsFor(p)
        .filter((s) => s.action === action)
        .flatMap((s) => s.keys.map((k) => formatKeys(k, p)));
    expect(keysOf("windows", "Replace")).toEqual(["Ctrl+H"]);
    expect(keysOf("mac", "Replace")).toEqual(["⌥⌘F"]);
    expect(keysOf("windows", "Redo")).toEqual(["Ctrl+Shift+Z", "Ctrl+Y"]);
    expect(keysOf("mac", "Redo")).toEqual(["⇧⌘Z"]);
  });

  it("lists the Split toggle", () => {
    expect(SHORTCUTS).toContainEqual({
      group: "Tabs",
      action: "Split with previous tab / unsplit",
      keys: [["Mod", "\\"]],
      command: "toggleSplit",
    });
  });

  it("formats keys per platform", () => {
    expect(formatKeys(["Mod", "Shift", "T"], "windows")).toBe("Ctrl+Shift+T");
    expect(formatKeys(["Mod", "Shift", "T"], "mac")).toBe("⇧⌘T");
    expect(formatKeys(["Ctrl", "Tab"], "mac")).toBe("⌃Tab");
    expect(formatKeys(["F3"], "other")).toBe("F3");
  });

  it("has no duplicate action within a platform", () => {
    for (const p of ["windows", "mac"] as const) {
      const actions = shortcutsFor(p).map((s) => s.action);
      expect(new Set(actions).size).toBe(actions.length);
    }
    expect(SHORTCUTS.length).toBeGreaterThan(20);
  });
});
