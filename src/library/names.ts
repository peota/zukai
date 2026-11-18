import type { LanguageId, TabState } from "../model/types";

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

/** Longest stem in UTF-16 units: leaves room for an extension and " (n)". */
const MAX_STEM = 200;

const trimEdges = (v: string) => v.replace(/^[\s.]+|[\s.]+$/g, "");

/** Cuts to `max` UTF-16 units without splitting a surrogate pair. */
function capUnits(v: string, max: number): string {
  if (v.length <= max) return v;
  let end = max;
  const c = v.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end -= 1;
  return v.slice(0, end);
}

/** A file-system safe name stem for `title`; never empty, at most 200 units. */
export function sanitizeFileName(title: string): string {
  const cleaned = trimEdges(
    capUnits(
      trimEdges(title.replace(ILLEGAL, " ").replace(/\s+/g, " ")),
      MAX_STEM - 1,
    ),
  );
  if (!cleaned) return "Untitled";
  // Windows reserves these as device names, with or without an extension.
  const base = cleaned.split(".")[0].trimEnd();
  return RESERVED.test(base) ? `${cleaned}_` : cleaned;
}

const LANGUAGE_EXT: Record<LanguageId, string> = {
  plaintext: ".txt",
  markdown: ".md",
  json: ".json",
  javascript: ".js",
  typescript: ".ts",
  html: ".html",
  xml: ".xml",
  css: ".css",
  sql: ".sql",
  python: ".py",
  yaml: ".yaml",
  shell: ".sh",
};

export function extFor(tab: TabState): string {
  return tab.kind === "canvas" ? ".excalidraw" : LANGUAGE_EXT[tab.language];
}

export function suggestedFileName(tab: TabState): string {
  return sanitizeFileName(tab.title) + extFor(tab);
}
