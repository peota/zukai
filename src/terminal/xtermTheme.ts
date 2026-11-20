import type { ITheme } from "@xterm/xterm";
import type { DarkTheme, LightTheme } from "../model/settings";

export type Palette = LightTheme | DarkTheme;

// black, red, green, yellow, blue, magenta, cyan, white, then the bright eight.
// prettier-ignore
export const ANSI: Record<Palette, string[]> = {
  paper: [
    "#18181b", "#be123c", "#15803d", "#a16207",
    "#1d4ed8", "#7e22ce", "#0e7490", "#d4d4d8",
    "#52525b", "#e11d48", "#16a34a", "#b45309",
    "#2563eb", "#9333ea", "#0891b2", "#71717a",
  ],
  "solar-light": [
    "#073642", "#b3281f", "#5b7000", "#8a6a00",
    "#1f6fb0", "#a8306f", "#1f7f77", "#d8d0bb",
    "#586e75", "#cb4b16", "#6f8800", "#a07800",
    "#268bd2", "#c13c85", "#2aa198", "#657b83",
  ],
  graphite: [
    "#3f3f46", "#f87171", "#4ade80", "#facc15",
    "#60a5fa", "#c084fc", "#22d3ee", "#e4e4e7",
    "#71717a", "#fca5a5", "#86efac", "#fde047",
    "#93c5fd", "#d8b4fe", "#67e8f9", "#fafafa",
  ],
  midnight: [
    "#3b4261", "#ff7a93", "#9ece6a", "#e0af68",
    "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5",
    "#6b7399", "#ff9eb1", "#b9f27c", "#ffc777",
    "#9ab8ff", "#d0b4ff", "#a4e4ff", "#e6ebff",
  ],
  "solar-dark": [
    "#2b4a54", "#f2625a", "#a3b82a", "#d9a520",
    "#4c9be0", "#e0609c", "#3fc4ba", "#eee8d5",
    "#7a9199", "#ff8a5c", "#b8cf3a", "#ecbb3a",
    "#78b4ec", "#ee82b4", "#6ad8cf", "#fdf6e3",
  ],
};

/** An xterm theme from the app's tokens; `css` reads a custom property. */
export function xtermTheme(
  palette: Palette,
  css: (name: string) => string,
): ITheme {
  const a = ANSI[palette];
  return {
    background: css("--z-editor"),
    foreground: css("--z-text"),
    cursor: css("--z-accent"),
    cursorAccent: css("--z-editor"),
    selectionBackground: css("--z-row-sel"),
    black: a[0],
    red: a[1],
    green: a[2],
    yellow: a[3],
    blue: a[4],
    magenta: a[5],
    cyan: a[6],
    white: a[7],
    brightBlack: a[8],
    brightRed: a[9],
    brightGreen: a[10],
    brightYellow: a[11],
    brightBlue: a[12],
    brightMagenta: a[13],
    brightCyan: a[14],
    brightWhite: a[15],
  };
}
