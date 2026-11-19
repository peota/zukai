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
  wrapNewTabs: false,
  lineNumbers: true,
  autosaveFiles: false,
  previewSplit: 0.5,
  markdownDefault: "rich",
});

const THEMES: readonly string[] = ["system", "light", "dark"];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function oneOf<T extends string>(v: unknown, all: readonly T[], d: T): T {
  return typeof v === "string" && (all as readonly string[]).includes(v)
    ? (v as T)
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
  };
}
