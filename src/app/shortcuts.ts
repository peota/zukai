export type Platform = "mac" | "windows" | "other";

export type Command =
  | { type: "newTab" }
  | { type: "closeTab" }
  | { type: "reopenTab" }
  | { type: "cycleTab"; dir: 1 | -1 }
  | { type: "goToTab"; n: number }
  | { type: "find" }
  | { type: "replace" }
  | { type: "toggleWrap" }
  | { type: "quit" }
  | { type: "open" }
  | { type: "save" }
  | { type: "saveAs" }
  | { type: "format" }
  | { type: "toggleSidebar" }
  | { type: "focusSidebar" }
  | { type: "newCanvas" }
  /** Editor text size: 1 bigger, -1 smaller, 0 back to the default. */
  | { type: "zoom"; dir: 1 | -1 | 0 }
  | { type: "openSettings" }
  /** Quick open: find a Library file by name and open it. */
  | { type: "quickOpen" }
  /** A Markdown Tab: Edit → Split → Preview → Edit. */
  | { type: "togglePreview" }
  /** Splits the active Tab with the one active just before, or unsplits. */
  | { type: "toggleSplit" }
  /** A Markdown Tab: the rich editor or the Markdown source. */
  | { type: "toggleRichMarkdown" };

export type KeyInfo = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

/**
 * The letter a Mod shortcut means: the typed character when it is an ASCII
 * letter (so AZERTY/Dvorak users get the letter printed on the key), else the
 * physical key (non-Latin layouts such as Cyrillic, or macOS Option symbols).
 */
export function letterOf(e: KeyInfo): string | null {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  const m = /^Key([A-Z])$/.exec(e.code);
  return m ? m[1].toLowerCase() : null;
}

export function matchShortcut(e: KeyInfo, p: Platform): Command | null {
  const mac = p === "mac";
  // Ctrl+Tab cycling uses Ctrl on every platform.
  if (e.code === "Tab" && e.ctrlKey && !e.metaKey && !e.altKey) {
    return { type: "cycleTab", dir: e.shiftKey ? -1 : 1 };
  }

  // Alt+Z toggles word wrap (no Mod).
  if (
    e.code === "KeyZ" &&
    e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.shiftKey
  ) {
    return { type: "toggleWrap" };
  }

  // Shift+Alt+F beautifies JSON (no Mod).
  if (
    e.altKey &&
    e.shiftKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    letterOf(e) === "f"
  ) {
    return { type: "format" };
  }

  const modDown = mac ? e.metaKey : e.ctrlKey;
  const otherMod = mac ? e.ctrlKey : e.metaKey;
  if (!modDown || otherMod) return null;

  const letter = letterOf(e);

  // Mod+= / Mod++ / Mod+- / Mod+0, typed or on the keypad. Shift is allowed:
  // "+" is Shift+= on many layouts.
  if (!e.altKey) {
    if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") {
      return { type: "zoom", dir: 1 };
    }
    if (e.key === "-" || e.code === "NumpadSubtract") {
      return { type: "zoom", dir: -1 };
    }
    if (!e.shiftKey && (e.key === "0" || e.code === "Numpad0")) {
      return { type: "zoom", dir: 0 };
    }
    // Mod+\ splits, by the typed backslash or the physical key.
    if (!e.shiftKey && (e.key === "\\" || e.code === "Backslash")) {
      return { type: "toggleSplit" };
    }
    // Mod+, opens Settings, by the typed comma or the physical key.
    if (!e.shiftKey && (e.key === "," || e.code === "Comma")) {
      return { type: "openSettings" };
    }
  }

  if (e.altKey) {
    // Mod+Alt+F is Replace on macOS only. Ctrl+Alt elsewhere is AltGr.
    return mac && letter === "f" && !e.shiftKey ? { type: "replace" } : null;
  }

  if (e.shiftKey) {
    switch (letter) {
      case "t":
        return { type: "reopenTab" };
      case "s":
        return { type: "saveAs" };
      case "e":
        return { type: "focusSidebar" };
      case "n":
        return { type: "newCanvas" };
      case "v":
        return { type: "togglePreview" };
      // Not Mod+Alt+M: Ctrl+Alt is AltGr on Windows/Linux and types letters.
      case "m":
        return { type: "toggleRichMarkdown" };
    }
    return null;
  }

  switch (letter) {
    case "n":
      return { type: "newTab" };
    case "w":
      return { type: "closeTab" };
    case "f":
      return { type: "find" };
    case "h":
      return mac ? null : { type: "replace" };
    case "q":
      return { type: "quit" };
    case "o":
      return { type: "open" };
    case "s":
      return { type: "save" };
    case "b":
      return { type: "toggleSidebar" };
    case "p":
      return { type: "quickOpen" };
  }
  // Digits by physical key: AZERTY types symbols on the number row.
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit) return { type: "goToTab", n: Number(digit[1]) };
  return null;
}

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const s = nav.userAgentData?.platform ?? nav.userAgent ?? "";
  if (/mac/i.test(s)) return "mac";
  return /win/i.test(s) ? "windows" : "other";
}
