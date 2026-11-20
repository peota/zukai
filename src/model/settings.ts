import type { MarkdownMode } from "./types";

/** "system" follows the OS light or dark mode, live. */
export type ThemePref = "system" | "light" | "dark";

/** The palettes shown in Light mode (and for a light OS under System). */
export type LightTheme = "paper" | "solar-light";
/** The palettes shown in Dark mode (and for a dark OS under System). */
export type DarkTheme = "graphite" | "midnight" | "solar-dark";
/** The accent: selection, focus, links and checks, on every theme. */
export type Accent = "blue" | "violet" | "green" | "orange" | "pink";

export const LIGHT_THEMES: readonly LightTheme[] = ["paper", "solar-light"];
export const DARK_THEMES: readonly DarkTheme[] = [
  "graphite",
  "midnight",
  "solar-dark",
];
export const ACCENTS: readonly Accent[] = [
  "blue",
  "violet",
  "green",
  "orange",
  "pink",
];

/** The user's preferences; saved in the Session. */
export interface Settings {
  theme: ThemePref;
  lightTheme: LightTheme;
  darkTheme: DarkTheme;
  accent: Accent;
  /** The base text size of the app's chrome (sidebar, tabs, menus, dialogs), in px. */
  uiFontSize: number;
  /** New and newly opened Tabs start with word wrap on (Alt+Z per Tab). */
  wrapNewTabs: boolean;
  /** The line-number gutter in the text editor. */
  lineNumbers: boolean;
  /** Files (not Scratchpads) save themselves as you type; off, they save on Ctrl+S. */
  autosaveFiles: boolean;
  /** The editor's share of the row in a Markdown Split (the preview has the rest). */
  previewSplit: number;
  /** How a Markdown file (or a picked-Markdown Scratchpad) opens. */
  markdownDefault: MarkdownMode;
  /** Where the terminal panel docks: under the editor or beside it. */
  terminalPosition: TerminalPosition;
  /** The terminal panel's height when docked at the bottom, in px. */
  terminalHeight: number;
  /** The terminal panel's width when docked at the side, in px. */
  terminalWidth: number;
}

export type TerminalPosition = "bottom" | "side";
export const TERMINAL_POSITIONS: readonly TerminalPosition[] = [
  "bottom",
  "side",
];

export const TERMINAL_MIN_HEIGHT = 120;
export const TERMINAL_MIN_WIDTH = 240;

/** A terminal size in whole pixels, at least `min` and at most 70% of `available`. */
export function clampTerminalSize(
  px: number,
  min: number,
  available: number,
): number {
  const max = 0.7 * available;
  if (max < min) return min;
  return Math.min(max, Math.max(min, Math.round(px)));
}

export const DEFAULT_UI_FONT_SIZE = 14;
export const MIN_UI_FONT_SIZE = 11;
export const MAX_UI_FONT_SIZE = 18;

/** A UI font size in whole pixels within MIN_UI_FONT_SIZE–MAX_UI_FONT_SIZE. */
export function clampUiFontSize(px: number): number {
  return Math.min(MAX_UI_FONT_SIZE, Math.max(MIN_UI_FONT_SIZE, Math.round(px)));
}

export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.8;

/** A split share kept within 20–80%, to the nearest 0.1%. */
export function clampSplit(r: number): number {
  return Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, r)) * 1000) / 1000;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  theme: "system",
  lightTheme: "paper",
  darkTheme: "graphite",
  accent: "blue",
  uiFontSize: DEFAULT_UI_FONT_SIZE,
  wrapNewTabs: false,
  lineNumbers: true,
  autosaveFiles: false,
  previewSplit: 0.5,
  markdownDefault: "rich",
  terminalPosition: "bottom",
  terminalHeight: 280,
  terminalWidth: 480,
});

const THEMES: readonly string[] = ["system", "light", "dark"];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function oneOf<T extends string>(v: unknown, all: readonly T[], d: T): T {
  return typeof v === "string" && (all as readonly string[]).includes(v)
    ? (v as T)
    : d;
}

function storedSize(v: unknown, min: number, d: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min
    ? Math.round(v)
    : d;
}

/** Settings from a Session: each malformed or missing value is its default. */
export function parseSettings(v: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!isObject(v)) return { ...d };
  return {
    theme:
      typeof v.theme === "string" && THEMES.includes(v.theme)
        ? (v.theme as ThemePref)
        : d.theme,
    lightTheme: oneOf(v.lightTheme, LIGHT_THEMES, d.lightTheme),
    darkTheme: oneOf(v.darkTheme, DARK_THEMES, d.darkTheme),
    accent: oneOf(v.accent, ACCENTS, d.accent),
    uiFontSize:
      typeof v.uiFontSize === "number" && Number.isFinite(v.uiFontSize)
        ? clampUiFontSize(v.uiFontSize)
        : d.uiFontSize,
    wrapNewTabs:
      typeof v.wrapNewTabs === "boolean" ? v.wrapNewTabs : d.wrapNewTabs,
    lineNumbers:
      typeof v.lineNumbers === "boolean" ? v.lineNumbers : d.lineNumbers,
    autosaveFiles:
      typeof v.autosaveFiles === "boolean" ? v.autosaveFiles : d.autosaveFiles,
    previewSplit:
      typeof v.previewSplit === "number" && Number.isFinite(v.previewSplit)
        ? clampSplit(v.previewSplit)
        : d.previewSplit,
    markdownDefault:
      v.markdownDefault === "rich" || v.markdownDefault === "markdown"
        ? v.markdownDefault
        : d.markdownDefault,
    terminalPosition: oneOf(
      v.terminalPosition,
      TERMINAL_POSITIONS,
      d.terminalPosition,
    ),
    terminalHeight: storedSize(
      v.terminalHeight,
      TERMINAL_MIN_HEIGHT,
      d.terminalHeight,
    ),
    terminalWidth: storedSize(
      v.terminalWidth,
      TERMINAL_MIN_WIDTH,
      d.terminalWidth,
    ),
  };
}
