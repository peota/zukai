import type { LanguageId, TabState } from "../model/types";

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

/** A file-system safe name stem for `title`; never empty. */
export function sanitizeFileName(title: string): string {
  const cleaned = title
    .replace(ILLEGAL, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
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
