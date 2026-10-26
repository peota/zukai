// Token-preserving JSON beautify/minify. Re-indents the existing tokens in a
// single pass (never JSON.parse + stringify), so number text, string escapes
// and key order are copied verbatim. `//` and `/* */` comments survive.

export type FormatResult =
  | { ok: true; text: string }
  | { ok: false; line: number; col: number; message: string };

class JsonError extends Error {
  readonly offset: number;
  constructor(offset: number, message: string) {
    super(message);
    this.offset = offset;
  }
}

const Expect = {
  Value: 0,
  ValueOrClose: 1, // right after [
  KeyOrClose: 2, // right after {
  Key: 3,
  Colon: 4,
  CommaOrClose: 5,
  End: 6,
} as const;
type ExpectState = (typeof Expect)[keyof typeof Expect];

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isAlpha = (c: number): boolean =>
  (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isHex = (c: number): boolean =>
  isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

function scanString(s: string, start: number): number {
  const n = s.length;
  let i = start + 1;
  for (;;) {
    if (i >= n) throw new JsonError(start, "Unterminated string");
    const c = s.charCodeAt(i);
    if (c === 34) return i + 1;
    if (c < 32) throw new JsonError(i, "Control character in string");
    if (c === 92) {
      const e = s.charCodeAt(i + 1);
      if (e === 117) {
        for (let k = 2; k <= 5; k++) {
          if (!isHex(s.charCodeAt(i + k))) {
            throw new JsonError(i, "Invalid unicode escape");
          }
        }
        i += 6;
      } else if (
        e === 34 ||
        e === 92 ||
        e === 47 ||
        e === 98 ||
        e === 102 ||
        e === 110 ||
        e === 114 ||
        e === 116
      ) {
        i += 2;
      } else {
        throw new JsonError(i, "Invalid escape sequence");
      }
    } else {
      i++;
    }
  }
}

function scanNumber(s: string, start: number): number {
  let i = start;
  if (s.charCodeAt(i) === 45) i++;
  if (s.charCodeAt(i) === 48) {
    i++;
  } else if (isDigit(s.charCodeAt(i))) {
    while (isDigit(s.charCodeAt(i))) i++;
  } else {
    throw new JsonError(start, "Invalid number");
  }
  if (s.charCodeAt(i) === 46) {
    i++;
    if (!isDigit(s.charCodeAt(i))) throw new JsonError(start, "Invalid number");
    while (isDigit(s.charCodeAt(i))) i++;
  }
  const e = s.charCodeAt(i);
  if (e === 101 || e === 69) {
    i++;
    const sign = s.charCodeAt(i);
    if (sign === 43 || sign === 45) i++;
    if (!isDigit(s.charCodeAt(i))) throw new JsonError(start, "Invalid number");
    while (isDigit(s.charCodeAt(i))) i++;
  }
  const after = s.charCodeAt(i);
  if (isDigit(after) || isAlpha(after)) {
    throw new JsonError(start, "Invalid number");
  }
  return i;
}

function scanLiteral(s: string, start: number): number {
  let i = start;
  while (isAlpha(s.charCodeAt(i))) i++;
  const w = s.slice(start, i);
  if (w !== "true" && w !== "false" && w !== "null") {
    throw new JsonError(start, "Unexpected token");
  }
  return i;
}

function position(s: string, offset: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (
    let i = s.indexOf("\n");
    i !== -1 && i < offset;
    i = s.indexOf("\n", i + 1)
  ) {
    line++;
    last = i;
  }
  return { line, col: offset - last };
}

function run(text: string, pretty: boolean, indent: number): FormatResult {
  try {
    return { ok: true, text: emit(text, pretty, indent) };
  } catch (e) {
    if (e instanceof JsonError) {
      return { ok: false, ...position(text, e.offset), message: e.message };
    }
    throw e;
  }
}

function emit(s: string, pretty: boolean, indentSize: number): string {
  const n = s.length;
  const out: string[] = [];
  const stack: number[] = []; // 123 = object, 91 = array
  const pads: string[] = [""];
  const pad = (d: number): string => {
    while (pads.length <= d) pads.push(" ".repeat(indentSize * pads.length));
    return pads[d];
  };

  let expect = Expect.Value as ExpectState;
  let i = 0;
  // Pretty-printing state.
  let needBreak = false; // next token starts a new line
  let atLineStart = true;
  let justOpened = false; // last emitted thing was an opener
  let afterColon = false;
  let sawNewline = false; // source newline since last emitted token/comment

  const put = (tok: string): void => {
    if (pretty) {
      if (needBreak && !atLineStart) {
        out.push("\n", pad(stack.length));
      } else if (atLineStart && stack.length > 0) {
        out.push(pad(stack.length));
      } else if (afterColon) {
        out.push(" ");
      }
      needBreak = false;
      afterColon = false;
      atLineStart = false;
      justOpened = false;
      sawNewline = false;
    }
    out.push(tok);
  };

  const valueDone = (): void => {
    expect = stack.length === 0 ? Expect.End : Expect.CommaOrClose;
  };
  const bad = (at: number): never => {
    if (at >= n) throw new JsonError(n, "Unexpected end of input");
    throw new JsonError(at, `Unexpected token '${s[at]}'`);
  };

  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 10) {
      sawNewline = true;
      i++;
      continue;
    }
    if (c === 32 || c === 9 || c === 13) {
      i++;
      continue;
    }
    if (c === 47) {
      const c2 = s.charCodeAt(i + 1);
      if (c2 === 47) {
        let e = s.indexOf("\n", i);
        if (e === -1) e = n;
        let end = e;
        if (end > i && s.charCodeAt(end - 1) === 13) end--;
        const cm = s.slice(i, end);
        if (pretty) {
          if (!sawNewline && !atLineStart) {
            out.push(" ", cm);
          } else {
            if (!atLineStart) out.push("\n");
            out.push(pad(stack.length), cm);
          }
          // A line comment always ends its line.
          needBreak = true;
          atLineStart = false;
          justOpened = false;
          afterColon = false;
          sawNewline = false;
        } else {
          out.push(cm, "\n");
        }
        i = e;
        continue;
      }
      if (c2 === 42) {
        const e = s.indexOf("*/", i + 2);
        if (e === -1) throw new JsonError(i, "Unterminated comment");
        const cm = s.slice(i, e + 2);
        if (pretty) {
          if (sawNewline && !atLineStart) {
            out.push("\n", pad(stack.length), cm);
          } else if (atLineStart) {
            out.push(pad(stack.length), cm);
          } else {
            out.push(" ", cm);
          }
          atLineStart = false;
          justOpened = false;
          afterColon = false;
          sawNewline = false;
        } else {
          out.push(cm);
        }
        i = e + 2;
        continue;
      }
      bad(i);
    }

    // Significant tokens.
    switch (c) {
      case 123: // {
      case 91: {
        // [
        if (expect !== Expect.Value && expect !== Expect.ValueOrClose) bad(i);
        put(s[i]);
        stack.push(c);
        expect = c === 123 ? Expect.KeyOrClose : Expect.ValueOrClose;
        justOpened = true;
        needBreak = pretty;
        i++;
        continue;
      }
      case 125: // }
      case 93: {
        // ]
        const want = c === 125 ? 123 : 91;
        const okState =
          stack[stack.length - 1] === want &&
          (expect === Expect.CommaOrClose ||
            (c === 125
              ? expect === Expect.KeyOrClose
              : expect === Expect.ValueOrClose));
        if (!okState) bad(i);
        stack.pop();
        if (pretty) {
          if (justOpened) {
            needBreak = false;
            atLineStart = false;
            out.push(s[i]);
            justOpened = false;
            sawNewline = false;
          } else {
            needBreak = true;
            put(s[i]);
          }
        } else {
          out.push(s[i]);
        }
        valueDone();
        i++;
        continue;
      }
      case 44: {
        // ,
        if (expect !== Expect.CommaOrClose) bad(i);
        put(",");
        expect = stack[stack.length - 1] === 123 ? Expect.Key : Expect.Value;
        needBreak = pretty;
        i++;
        continue;
      }
      case 58: {
        // :
        if (expect !== Expect.Colon) bad(i);
        put(":");
        afterColon = pretty;
        expect = Expect.Value;
        i++;
        continue;
      }
      case 34: {
        const e = scanString(s, i);
        if (expect === Expect.Key || expect === Expect.KeyOrClose) {
          put(s.slice(i, e));
          expect = Expect.Colon;
        } else if (expect === Expect.Value || expect === Expect.ValueOrClose) {
          put(s.slice(i, e));
          valueDone();
        } else {
          bad(i);
        }
        i = e;
        continue;
      }
      default: {
        if (expect !== Expect.Value && expect !== Expect.ValueOrClose) bad(i);
        const e = c === 45 || isDigit(c) ? scanNumber(s, i) : scanLiteral(s, i);
        put(s.slice(i, e));
        valueDone();
        i = e;
      }
    }
  }
  if (expect !== Expect.End) bad(n);
  return out.join("");
}

export function beautify(text: string, indent = 2): FormatResult {
  return run(text, true, indent);
}

export function minify(text: string): FormatResult {
  return run(text, false, 0);
}
