import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import type { LanguageId } from "../model/types";
import { LANGUAGE_LABELS } from "../ui/StatusBar";

const ORDER: LanguageId[] = [
  "plaintext",
  "markdown",
  "json",
  "javascript",
  "typescript",
  "html",
  "xml",
  "css",
  "sql",
  "python",
  "csharp",
  "yaml",
  "shell",
];

export const LANGUAGES: { id: LanguageId; label: string }[] = ORDER.map(
  (id) => ({ id, label: LANGUAGE_LABELS[id] }),
);

/** Every Language but plain text is loaded on first use. */
const loaders: Record<LanguageId, () => Promise<Extension>> = {
  plaintext: () => Promise.resolve([]),
  markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
  json: async () => (await import("@codemirror/lang-json")).json(),
  javascript: async () =>
    (await import("@codemirror/lang-javascript")).javascript(),
  typescript: async () =>
    (await import("@codemirror/lang-javascript")).javascript({
      typescript: true,
    }),
  html: async () => (await import("@codemirror/lang-html")).html(),
  xml: async () => (await import("@codemirror/lang-xml")).xml(),
  css: async () => (await import("@codemirror/lang-css")).css(),
  sql: async () => (await import("@codemirror/lang-sql")).sql(),
  python: async () => (await import("@codemirror/lang-python")).python(),
  csharp: async () => {
    const [{ csharp }, { withRawStrings }] = await Promise.all([
      import("@codemirror/legacy-modes/mode/clike"),
      import("./csharp"),
    ]);
    return StreamLanguage.define(withRawStrings(csharp));
  },
  yaml: async () => (await import("@codemirror/lang-yaml")).yaml(),
  shell: async () =>
    StreamLanguage.define(
      (await import("@codemirror/legacy-modes/mode/shell")).shell,
    ),
};

const cache = new Map<LanguageId, Promise<Extension>>();

export function loadLanguage(id: LanguageId): Promise<Extension> {
  let p = cache.get(id);
  if (!p) {
    p = loaders[id]();
    // A failed load may be retried later.
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}
