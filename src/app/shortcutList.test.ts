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
  collapseLibrary: true,
  newCanvas: true,
  zoom: true,
  openSettings: true,
  quickOpen: true,
  togglePreview: true,
  toggleSplit: true,
  toggleRichMarkdown: true,
  toggleTerminal: true,
  newTerminal: true,
  agentMenu: true,
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

  it("lists the rich editor's keys", () => {
    const rich = SHORTCUTS.filter((s) => s.action.endsWith("(rich editor)"));
    expect(rich.map((s) => [s.action, s.keys])).toEqual([
      ["Bold (rich editor)", [["Mod", "B"]]],
      ["Italic (rich editor)", [["Mod", "I"]]],
      ["Strikethrough (rich editor)", [["Mod", "Shift", "X"]]],
      ["Inline code (rich editor)", [["Mod", "E"]]],
      ["Link (rich editor)", [["Mod", "K"]]],
    ]);
    for (const s of rich) {
      expect(s.group).toBe("Editing");
      expect(s.command).toBeUndefined();
    }
    // Only Mod+B is shared: the sidebar toggle outside the rich editor.
    const key = (k: string[]) => k.join("+");
    for (const s of rich) {
      const others = SHORTCUTS.filter(
        (o) => o !== s && o.keys.some((k) => key(k) === key(s.keys[0])),
      ).map((o) => o.action);
      expect(others).toEqual(
        key(s.keys[0]) === "Mod+B" ? ["Show / hide sidebar"] : [],
      );
    }
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
