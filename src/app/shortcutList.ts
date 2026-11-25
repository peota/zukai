import type { Command, Platform } from "./shortcuts";

/**
 * One shortcut as the Settings dialog lists it. `keys` uses "Mod" for Ctrl
 * (Cmd on macOS); a list of alternatives is joined with " or ".
 */
export interface ShortcutEntry {
  group: "Tabs" | "Files" | "Editing" | "Find" | "View";
  action: string;
  keys: string[][];
  /** The app Command it runs, when it's one (the test checks they're all listed). */
  command?: Command["type"];
  /** Only on this platform, or only off it ("!mac"). */
  only?: Platform | "!mac";
}

/** Every keyboard shortcut of the app and its editor, by group. */
export const SHORTCUTS: readonly ShortcutEntry[] = [
  { group: "Tabs", action: "New tab", keys: [["Mod", "N"]], command: "newTab" },
  {
    group: "Tabs",
    action: "New canvas",
    keys: [["Mod", "Shift", "N"]],
    command: "newCanvas",
  },
  {
    group: "Tabs",
    action: "Close tab",
    keys: [["Mod", "W"]],
    command: "closeTab",
  },
  {
    group: "Tabs",
    action: "Reopen closed tab",
    keys: [["Mod", "Shift", "T"]],
    command: "reopenTab",
  },
  {
    group: "Tabs",
    action: "Split with previous tab / unsplit",
    keys: [["Mod", "\\"]],
    command: "toggleSplit",
  },
  {
    group: "Tabs",
    action: "Next / previous tab",
    keys: [
      ["Ctrl", "Tab"],
      ["Ctrl", "Shift", "Tab"],
    ],
    command: "cycleTab",
  },
  {
    group: "Tabs",
    action: "Go to tab 1–8 / last tab",
    keys: [
      ["Mod", "1–8"],
      ["Mod", "9"],
    ],
    command: "goToTab",
  },
  {
    group: "Files",
    action: "Quick open (find a file by name)",
    keys: [["Mod", "P"]],
    command: "quickOpen",
  },
  {
    group: "Files",
    action: "Open file",
    keys: [["Mod", "O"]],
    command: "open",
  },
  { group: "Files", action: "Save", keys: [["Mod", "S"]], command: "save" },
  {
    group: "Files",
    action: "Save as",
    keys: [["Mod", "Shift", "S"]],
    command: "saveAs",
  },
  { group: "Files", action: "Quit", keys: [["Mod", "Q"]], command: "quit" },
  { group: "Editing", action: "Undo", keys: [["Mod", "Z"]] },
  {
    group: "Editing",
    action: "Redo",
    keys: [
      ["Mod", "Shift", "Z"],
      ["Mod", "Y"],
    ],
    only: "!mac",
  },
  {
    group: "Editing",
    action: "Redo",
    keys: [["Mod", "Shift", "Z"]],
    only: "mac",
  },
  { group: "Editing", action: "Select next match", keys: [["Mod", "D"]] },
  {
    group: "Editing",
    action: "Indent / outdent",
    keys: [["Tab"], ["Shift", "Tab"]],
  },
  {
    group: "Editing",
    action: "Fold / unfold",
    keys: [
      ["Mod", "Shift", "["],
      ["Mod", "Shift", "]"],
    ],
  },
  {
    group: "Editing",
    action: "Format JSON / re-indent code",
    keys: [["Shift", "Alt", "F"]],
    command: "format",
  },
  {
    group: "Editing",
    action: "Rich / Markdown editor",
    keys: [["Mod", "Shift", "M"]],
    command: "toggleRichMarkdown",
  },
  // The rich editor's own keys (Mod+B is the sidebar toggle elsewhere).
  { group: "Editing", action: "Bold (rich editor)", keys: [["Mod", "B"]] },
  { group: "Editing", action: "Italic (rich editor)", keys: [["Mod", "I"]] },
  {
    group: "Editing",
    action: "Strikethrough (rich editor)",
    keys: [["Mod", "Shift", "X"]],
  },
  {
    group: "Editing",
    action: "Inline code (rich editor)",
    keys: [["Mod", "E"]],
  },
  { group: "Editing", action: "Link (rich editor)", keys: [["Mod", "K"]] },
  { group: "Find", action: "Find", keys: [["Mod", "F"]], command: "find" },
  {
    group: "Find",
    action: "Replace",
    keys: [["Mod", "H"]],
    command: "replace",
    only: "!mac",
  },
  {
    group: "Find",
    action: "Replace",
    keys: [["Mod", "Alt", "F"]],
    command: "replace",
    only: "mac",
  },
  {
    group: "Find",
    action: "Next / previous match",
    keys: [["F3"], ["Shift", "F3"]],
  },
  {
    group: "View",
    action: "Toggle word wrap",
    keys: [["Alt", "Z"]],
    command: "toggleWrap",
  },
  {
    group: "View",
    action: "Zoom text in / out",
    keys: [
      ["Mod", "="],
      ["Mod", "-"],
      ["Mod", "Scroll"],
    ],
    command: "zoom",
  },
  { group: "View", action: "Reset text size", keys: [["Mod", "0"]] },
  {
    group: "View",
    action: "Show / hide sidebar",
    keys: [["Mod", "B"]],
    command: "toggleSidebar",
  },
  {
    group: "View",
    action: "Go to sidebar",
    keys: [["Mod", "Shift", "E"]],
    command: "focusSidebar",
  },
  {
    group: "View",
    action: "Toggle Git panel",
    keys: [["Mod", "Shift", "G"]],
    command: "toggleGit",
  },
  {
    group: "View",
    action: "Collapse all folders in Library",
    keys: [["Mod", "Shift", "C"]],
    command: "collapseLibrary",
  },
  {
    group: "View",
    action: "Markdown preview: edit / split / preview",
    keys: [["Mod", "Shift", "V"]],
    command: "togglePreview",
  },
  {
    group: "View",
    action: "Toggle terminal",
    keys: [["Ctrl", "`"]],
    command: "toggleTerminal",
  },
  {
    group: "View",
    action: "New terminal",
    keys: [["Ctrl", "Shift", "`"]],
    command: "newTerminal",
  },
  {
    group: "View",
    action: "Toggle Ask panel",
    keys: [["Mod", "J"]],
    command: "toggleAsk",
  },
  {
    group: "View",
    action: "Settings",
    keys: [["Mod", ","]],
    command: "openSettings",
  },
];

/** The entries that apply on `p`. */
export function shortcutsFor(p: Platform): ShortcutEntry[] {
  return SHORTCUTS.filter(
    (s) =>
      s.only === undefined ||
      s.only === p ||
      (s.only === "!mac" && p !== "mac"),
  );
}

const MAC_SYMBOL: Record<string, string> = {
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Mod: "⌘",
};
/** macOS lists modifiers in this order. */
const MAC_ORDER = ["Ctrl", "Alt", "Shift", "Mod"];

/** One key combination as shown: "Ctrl+Shift+T", or "⇧⌘T" on macOS. */
export function formatKeys(keys: readonly string[], p: Platform): string {
  if (p !== "mac") {
    return keys.map((k) => (k === "Mod" ? "Ctrl" : k)).join("+");
  }
  const mods = MAC_ORDER.filter((m) => keys.includes(m)).map(
    (m) => MAC_SYMBOL[m],
  );
  const rest = keys.filter((k) => !MAC_ORDER.includes(k));
  return mods.join("") + rest.join(" ");
}
