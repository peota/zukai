import type { LanguageId } from "../model/types";

/** Only this much of the text is ever looked at. */
export const GUESS_PREFIX = 65536;

const HTML_TAG =
  /<(html|head|body|div|span|p|a|ul|ol|li|table|tr|td|script|style|meta|link|title|h[1-6]|br|img|form|input|button|section|header|footer|nav)[\s>/]/i;
const OPEN_TAG = /^<([A-Za-z_][\w.:-]*)[^<>]*?(\/?)>/;

const SQL =
  /^(select\b[\s\S]*\bfrom\b|insert\s+into\b|update\s+\S+\s+set\b|delete\s+from\b|with\s+(recursive\s+)?\w+\s+as\s*\(|(create|alter|drop)\s+(table|view|index|schema|database|function|procedure|trigger|unique\s+index)\b)/i;

const PY_DEF = /^[ \t]*(async\s+)?(def|class)\s+\w+[^\n]*:\s*$/m;
const PY_FROM_IMPORT = /^from\s+[\w.]+\s+import\s+\S/m;
const PY_IMPORT =
  /^import\s+[\w.]+(\s+as\s+\w+)?(\s*,\s*[\w.]+(\s+as\s+\w+)?)*\s*$/m;

const MD_FENCE = /^ {0,3}(```|~~~)/m;
const MD_HEADING = /^#{1,6}\s+\S/;

/**
 * Cheap, conservative Language guess. Returns null when unsure, so the Tab
 * stays plain text. YAML, JavaScript, TypeScript and CSS are never guessed.
 */
export function guessLanguage(text: string): LanguageId | null {
  const whole = text.length <= GUESS_PREFIX;
  // trimStart also drops a leading BOM.
  const head = (whole ? text : text.slice(0, GUESS_PREFIX)).trimStart();
  if (head === "") return null;

  if (head.startsWith("#!")) {
    const end = head.indexOf("\n");
    const line = end < 0 ? head : head.slice(0, end);
    if (/python/.test(line)) return "python";
    if (/\b(ba|z|k|da|fi)?sh\b/.test(line)) return "shell";
    return null;
  }

  const first = head[0];
  if (first === "{" || first === "[") {
    // JSON is validated only when the whole text is in hand.
    if (!whole) return null;
    try {
      const v: unknown = JSON.parse(head);
      return typeof v === "object" && v !== null ? "json" : null;
    } catch {
      return null;
    }
  }

  if (first === "<") {
    if (/^<\?xml\b/i.test(head)) return "xml";
    if (/^<!doctype\s+html\b/i.test(head)) return "html";
    if (HTML_TAG.test(head)) return "html";
    // XML: the first element self-closes or is closed later on.
    const open = OPEN_TAG.exec(head);
    if (open && (open[2] === "/" || head.includes(`</${open[1]}`))) {
      return "xml";
    }
    return null;
  }

  if (SQL.test(head)) return "sql";
  if (MD_FENCE.test(head)) return "markdown";
  if (PY_DEF.test(head) || PY_FROM_IMPORT.test(head) || PY_IMPORT.test(head)) {
    return "python";
  }
  if (MD_HEADING.test(head)) return "markdown";
  return null;
}
