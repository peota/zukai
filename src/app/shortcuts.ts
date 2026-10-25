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

  if (e.altKey) {
    // Mod+Alt+F is Replace on macOS only.
    return mac && e.code === "KeyF" && !e.shiftKey ? { type: "replace" } : null;
  }

  if (e.shiftKey) {
    return e.code === "KeyT" ? { type: "reopenTab" } : null;
  }

  switch (e.code) {
    case "KeyN":
      return { type: "newTab" };
    case "KeyW":
      return { type: "closeTab" };
    case "KeyF":
      return { type: "find" };
    case "KeyH":
      return mac ? null : { type: "replace" };
    case "KeyQ":
      return { type: "quit" };
  }
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
