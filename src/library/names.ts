import type { LanguageId, TabState } from "../model/types";

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

/**
 * Longest stem, in UTF-16 units and in UTF-8 bytes: room for an extension
 * and " (n)" in a 255-byte file name, and under the 223 bytes Rust accepts
 * for a new name (`validate_name`), even for non-ASCII Titles.
 */
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

/** Cuts to at most `max` UTF-8 bytes, on a code point boundary. */
function capBytes(v: string, max: number): string {
  let bytes = 0;
  let end = 0;
  for (const ch of v) {
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes > max) break;
    end += ch.length;
  }
  return v.slice(0, end);
}

/**
 * A file-system safe name stem for `title`; never empty, at most 200 UTF-16
 * units and 200 UTF-8 bytes.
 */
export function sanitizeFileName(title: string): string {
  const cleaned = trimEdges(
    capBytes(
      capUnits(
        trimEdges(title.replace(ILLEGAL, " ").replace(/\s+/g, " ")),
        MAX_STEM - 1,
      ),
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
