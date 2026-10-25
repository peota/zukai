export type Platform = "mac" | "other";

export type Command =
  | { type: "newTab" }
  | { type: "closeTab" }
  | { type: "reopenTab" }
  | { type: "cycleTab"; dir: 1 | -1 }
  | { type: "goToTab"; n: number }
  | { type: "find" }
  | { type: "replace" }
  | { type: "toggleWrap" }
  | { type: "quit" };

type KeyInfo = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

/**
 * The letter a Mod shortcut means: the typed character when it is an ASCII
 * letter (so AZERTY/Dvorak users get the letter printed on the key), else the
 * physical key (non-Latin layouts such as Cyrillic, or macOS Option symbols).
 */
function letterOf(e: KeyInfo): string | null {
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

  const modDown = mac ? e.metaKey : e.ctrlKey;
  const otherMod = mac ? e.ctrlKey : e.metaKey;
  if (!modDown || otherMod) return null;

  const letter = letterOf(e);

  if (e.altKey) {
    // Mod+Alt+F is Replace on macOS only. Ctrl+Alt elsewhere is AltGr.
    return mac && letter === "f" && !e.shiftKey ? { type: "replace" } : null;
  }

  if (e.shiftKey) {
    return letter === "t" ? { type: "reopenTab" } : null;
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
  return /mac/i.test(s) ? "mac" : "other";
}
