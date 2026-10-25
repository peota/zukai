import type { LanguageId } from "../model/types";

/** Only this much of the text is ever looked at. */
export const GUESS_PREFIX = 65536;

const HTML_TAG =
  /<(html|head|body|div|span|p|a|ul|ol|li|table|tr|td|script|style|meta|link|title|h[1-6]|br|img|form|input|button|section|header|footer|nav)[\s>/]/i;
const OPEN_TAG = /^<([A-Za-z_][\w.:-]*)[^<>]*?(\/?)>/;

/** A table-like name. */
const NAME = String.raw`[\w."\x60\[\]]+`;
/** A name that isn't an English determiner (prose guard). */
const IDENT = String.raw`(?!(?:the|a|an|this|that|these|those|my|your|our|their|his|her|its|each|every|all|some|any|one|of)\b)${NAME}`;
/** Words that may follow a table name inside a statement. */
const CLAUSE = String.raw`(?:where|join|(?:inner|left|right|full|cross|natural)\s+(?:outer\s+)?join|group\s+by|order\s+by|limit|having|union|offset)\b`;
/** A `;` that ends a line (prose rarely does that). */
const SEMI = String.raw`;[ \t]*(?:\n|$)`;

/** Statement shapes, matched against the first statement only. */
const SQL_SHAPES: RegExp[] = [
  // SELECT … FROM t [alias] (WHERE|JOIN|…), FROM t at the end, or a `;`.
  new RegExp(
    String.raw`^select\b[\s\S]*?(?:\bfrom\s+(?:${NAME}\s+${CLAUSE}|${IDENT}(?:\s*$|(?:\s+(?:as\s+)?\w+)?\s+${CLAUSE}|(?:\s+(?:as\s+)?\w+)?\s*${SEMI}))|${SEMI})`,
    "i",
  ),
  new RegExp(
    String.raw`^insert\s+into\s+${IDENT}\s*(?:\([^)]*\)\s*)?(?:values|select|default)\b`,
    "i",
  ),
  new RegExp(String.raw`^update\s+${IDENT}\s+set\s+[\w."]+\s*=`, "i"),
  new RegExp(
    String.raw`^delete\s+from\s+${IDENT}\s*(?:$|${SEMI}|where\b)`,
    "i",
  ),
  /^with\s+(recursive\s+)?\w+\s+as\s*\(/i,
  new RegExp(
    String.raw`^(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:table|view|index|schema|database|function|procedure|trigger)\s+(?:if\s+(?:not\s+)?exists\s+)?${IDENT}\s*(?:\(|$|${SEMI}|(?:add|drop|alter|rename|as|on)\b)`,
    "i",
  ),
];

const PY_DEF = /^[ \t]*(async\s+)?(def|class)\s+\w+[^\n]*:\s*$/m;
const PY_FROM_IMPORT = /^from\s+[\w.]+\s+import\s+\S/m;
const PY_IMPORT =
  /^import\s+[\w.]+(\s+as\s+\w+)?(\s*,\s*[\w.]+(\s+as\s+\w+)?)*\s*$/m;

const MD_FENCE = /^ {0,3}(```|~~~)/m;
const MD_HEADING = /^#{1,6}\s+\S/;
/** Markdown signals besides the leading heading (checked after line one). */
const MD_SIGNALS: RegExp[] = [
  /^ {0,3}#{1,6}[ \t]+\S/m, // another heading
  /^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+\S/m, // list item
  /\[[^\]\n]+\]\([^)\s]+\)/, // link
  /\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`/, // emphasis or inline code
  // A blank line, then a line of plain words starting with a capital.
  /\n[ \t]*\n[A-Z][a-z'’]*(?:[ \t]+[A-Za-z'’-]+[.,!?;:]?)+[ \t]*(?:\n|$)/,
];
/** Lines that look like config or a script: `# ` is then a comment. */
const CODE_LINE =
  /^[ \t]*(?:[a-z_][\w.-]*[ \t]*[:=]|(?:sudo|cd|ls|echo|export|source|npm|pnpm|yarn|npx|git|pip|python3?|node|cargo|docker|curl|wget|make|apt(?:-get)?|brew|set|if|then|fi|for|while|do|done|case|esac|return|function)\b)|[;{}$]|&&|\|\|/m;

function firstStatement(head: string): string {
  const blank = /\n[ \t]*\n/.exec(head);
  return (blank ? head.slice(0, blank.index) : head).trimEnd();
}

function looksLikeMarkdown(head: string): boolean {
  if (!MD_HEADING.test(head)) return false;
  const nl = head.indexOf("\n");
  if (nl < 0) return false;
  const rest = head.slice(nl);
  return MD_SIGNALS.some((r) => r.test(rest)) && !CODE_LINE.test(rest);
}

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

  if (/^(select|insert|update|delete|with|create|alter|drop)\b/i.test(head)) {
    const statement = firstStatement(head);
    if (SQL_SHAPES.some((r) => r.test(statement))) return "sql";
  }
  if (MD_FENCE.test(head)) return "markdown";
  if (PY_DEF.test(head) || PY_FROM_IMPORT.test(head) || PY_IMPORT.test(head)) {
    return "python";
  }
  if (looksLikeMarkdown(head)) return "markdown";
  return null;
}
