import type { StreamParser } from "@codemirror/language";

interface State {
  inner: unknown;
  /** Inside a raw string: the number of quotes that close it, else 0. */
  raw: number;
}

/** Reads a raw string up to its close or the end of the line. */
function rawString(
  stream: Parameters<StreamParser<unknown>["token"]>[0],
  state: State,
): void {
  const close = '"'.repeat(state.raw);
  while (!stream.eol()) {
    if (stream.match(close)) {
      // A longer run of quotes isn't valid C#; take it all rather than let
      // the extra quotes open a new string.
      while (stream.eat('"'));
      state.raw = 0;
      return;
    }
    stream.next();
  }
}

/** What StreamLanguage does for a mode without `copyState`. */
function shallowCopy(state: unknown): unknown {
  if (typeof state !== "object" || state === null) return state;
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) {
    copy[k] = Array.isArray(v) ? v.slice() : v;
  }
  return copy;
}

/**
 * The legacy C# mode plus C# 11 raw strings (`"""…"""`, also `$"""`), which
 * it predates: without them a raw string's lines read as code, so they were
 * highlighted and re-indented as code, and a brace inside threw off the
 * indentation of what follows.
 */
export function withRawStrings(
  base: StreamParser<unknown>,
): StreamParser<State> {
  return {
    name: base.name,
    startState: (unit) => ({ inner: base.startState!(unit), raw: 0 }),
    copyState: (s) => ({
      inner: base.copyState ? base.copyState(s.inner) : shallowCopy(s.inner),
      raw: s.raw,
    }),
    token(stream, s) {
      if (s.raw === 0) {
        const open = stream.match(/^\$*("{3,})/) as RegExpMatchArray | null;
        if (!open) return base.token(stream, s.inner);
        s.raw = open[1].length;
      }
      rawString(stream, s);
      return "string";
    },
    blankLine: base.blankLine
      ? (s, unit) => base.blankLine!(s.inner, unit)
      : undefined,
    // Inside a raw string the whitespace is the string's: leave it.
    indent: (s, textAfter, cx) =>
      s.raw ? null : (base.indent?.(s.inner, textAfter, cx) ?? null),
    languageData: base.languageData,
  };
}
