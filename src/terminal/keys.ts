import { letterOf, type KeyInfo, type Platform } from "../app/shortcuts";

/** Where a key pressed inside a terminal goes. */
export type KeyRoute = "app" | "copy" | "paste" | "shell";

/** Inside the terminal view (its xterm textarea included). */
export function isTerminalTarget(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest("[data-z-terminal]") !== null;
}

/**
 * Who handles a key while a terminal has focus. The terminal toggle and tab
 * cycling are the app's on every platform; elsewhere, on Windows and Linux
 * the Ctrl letters (P, N, W, R, B...) are the shell's.
 */
export function routeKey(
  e: KeyInfo,
  p: Platform,
  hasSelection: boolean,
): KeyRoute {
  // 1. The terminal and tab shortcuts.
  if (e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.code === "Backquote" || e.code === "Tab") return "app";
  }
  const letter = letterOf(e);

  if (p === "mac") {
    // 2. Cmd keys: copy and paste here, the rest the app's.
    if (e.metaKey && !e.ctrlKey && !e.altKey) {
      if (letter === "c") return "copy";
      if (letter === "v") return "paste";
      return "app";
    }
    return "shell";
  }

  // 3. Windows and Linux. Ctrl+Alt is AltGr: it types, so it's the shell's.
  if (!e.ctrlKey || e.metaKey || e.altKey) return "shell";
  if (letter === "c") return e.shiftKey || hasSelection ? "copy" : "shell";
  if (letter === "v") return "paste";
  if (letter === "q") return e.shiftKey ? "shell" : "app";
  if (
    e.key === "=" ||
    e.key === "+" ||
    e.key === "-" ||
    e.code === "NumpadAdd" ||
    e.code === "NumpadSubtract" ||
    (!e.shiftKey &&
      (e.key === "0" ||
        e.code === "Numpad0" ||
        e.key === "," ||
        e.code === "Comma"))
  ) {
    return "app";
  }
  // 4. Everything else.
  return "shell";
}
