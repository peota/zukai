import type { LanguageId } from "../model/types";

/** The file name of a path, with either separator. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** The extension without the dot ("" if none), lower-cased. */
function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

const BY_EXTENSION: Record<string, LanguageId> = {
  md: "markdown",
  markdown: "markdown",
  json: "json",
  jsonc: "json",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  css: "css",
  sql: "sql",
  py: "python",
  cs: "csharp",
  csx: "csharp",
  yaml: "yaml",
  yml: "yaml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
};

/** A File's Language comes from its extension. */
export function languageOf(path: string): LanguageId {
  return BY_EXTENSION[extensionOf(path)] ?? "plaintext";
}

const EXTENSION_FOR: Partial<Record<LanguageId, string>> = {
  markdown: "md",
  json: "json",
  javascript: "js",
  typescript: "ts",
  html: "html",
  xml: "xml",
  css: "css",
  sql: "sql",
  python: "py",
  csharp: "cs",
  yaml: "yaml",
  shell: "sh",
};

/** A File rename that would match its extension to a picked Language. */
export interface LanguageRename {
  from: string;
  to: string;
  /** Without the dot. */
  ext: string;
}

/**
 * The rename that gives the File at `path` the extension of `language`, or
 * null when its extension already means that Language.
 */
export function languageRename(
  path: string,
  language: LanguageId,
): LanguageRename | null {
  if (languageOf(path) === language) return null;
  const from = baseName(path);
  const old = extensionOf(path);
  const stem = old ? from.slice(0, -(old.length + 1)) : from;
  const ext = EXTENSION_FOR[language] ?? "txt";
  return { from, to: `${stem}.${ext}`, ext };
}

/**
 * The name a Save As dialog suggests for a Scratchpad: by its Language, or
 * with `ext` (".excalidraw" for a Canvas).
 */
export function suggestedName(
  title: string,
  language: LanguageId,
  ext?: string,
): string {
  const safe = [...title.replace(/…$/, "")]
    .map((c) => (c < " " || '\\/:*?"<>|'.includes(c) ? "_" : c))
    .join("");
  const stem = safe.trim().replace(/[. ]+$/, "");
  const name = stem || "Untitled";
  return ext ? name + ext : `${name}.${EXTENSION_FOR[language] ?? "txt"}`;
}

/** The stem a rename asks for: a name typed with its own extension keeps it. */
export function stemOf(name: string, path: string): string {
  const ext = extensionOf(path);
  const trimmed = name.trim();
  return ext && trimmed.toLowerCase().endsWith(`.${ext}`)
    ? trimmed.slice(0, -(ext.length + 1))
    : trimmed;
}
