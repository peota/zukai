/** "system" follows the OS light or dark mode, live. */
export type ThemePref = "system" | "light" | "dark";

/** The user's preferences; saved in the Session. */
export interface Settings {
  theme: ThemePref;
  /** New and newly opened Tabs start with word wrap on (Alt+Z per Tab). */
  wrapNewTabs: boolean;
  /** The line-number gutter in the text editor. */
  lineNumbers: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  theme: "system",
  wrapNewTabs: false,
  lineNumbers: true,
});

const THEMES: readonly string[] = ["system", "light", "dark"];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Settings from a Session: each malformed or missing value is its default. */
export function parseSettings(v: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!isObject(v)) return { ...d };
  return {
    theme:
      typeof v.theme === "string" && THEMES.includes(v.theme)
        ? (v.theme as ThemePref)
        : d.theme,
    wrapNewTabs:
      typeof v.wrapNewTabs === "boolean" ? v.wrapNewTabs : d.wrapNewTabs,
    lineNumbers:
      typeof v.lineNumbers === "boolean" ? v.lineNumbers : d.lineNumbers,
  };
}
