import { letterOf, type KeyInfo, type Platform } from "./shortcuts";

/** Inside a CodeMirror editor or the find bar, which handle F3 themselves. */
export function isEditorTarget(t: EventTarget | null): boolean {
  return (
    t instanceof Element && t.closest(".cm-editor, [data-find-bar]") !== null
  );
}

/**
 * Keys the webview would turn into browser actions (reload, print, find),
 * none of which belong in a desktop app.
 */
export function blocksBrowserKey(
  e: KeyInfo,
  p: Platform,
  inEditor: boolean,
): boolean {
  if (e.key === "F5" || e.code === "F5") return true;
  if (e.key === "F3" || e.code === "F3") return !inEditor;
  const modDown = p === "mac" ? e.metaKey : e.ctrlKey;
  if (!modDown || e.altKey) return false;
  const letter = letterOf(e);
  return letter === "r" || letter === "p";
}

/** The native context menu stays only where text is edited. */
export function allowsContextMenu(t: EventTarget | null): boolean {
  return (
    t instanceof Element && t.closest("input, textarea, .cm-editor") !== null
  );
}
