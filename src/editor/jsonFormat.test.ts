import { describe, expect, it } from "vitest";
import { beautify, minify } from "./jsonFormat";

const ok = (r: ReturnType<typeof beautify>): string => {
  if (!r.ok) throw new Error(`unexpected failure: ${r.message}`);
  return r.text;
};

describe("jsonFormat", () => {
  it("beautifyBasic", () => {
    expect(ok(beautify('{"a":1,"b":[1,2]}'))).toBe(
      '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}',
    );
  });

  it("emptyContainersStayCompact", () => {
    expect(ok(beautify('{"a":{},"b":[]}'))).toBe('{\n  "a": {},\n  "b": []\n}');
    expect(ok(beautify("{ }"))).toBe("{}");
  });

  it("numbersUntouched", () => {
    const out = ok(beautify("[1.0,1e3,12345678901234567890,-0.00]"));
    for (const n of ["1.0", "1e3", "12345678901234567890", "-0.00"]) {
      expect(out).toContain(n);
    }
    expect(ok(minify(out))).toBe("[1.0,1e3,12345678901234567890,-0.00]");
  });

  it("escapesUntouched", () => {
    const src = String.raw`"é\n\""`;
    expect(ok(beautify(src))).toBe(src);
    expect(ok(minify(`[ ${src} ]`))).toBe(`[${src}]`);
  });

  it("keyOrderKept", () => {
    expect(ok(minify('{"b":1,"a":2,"b":3}'))).toBe('{"b":1,"a":2,"b":3}');
  });

  it("commentsKeptByBeautifyAndMinify", () => {
    const src = '{"a":1, // one\n"b":/* two */2}';
    const b = ok(beautify(src));
    expect(b).toContain("// one");
    expect(b).toContain("/* two */");
    const m = ok(minify(src));
    expect(m).toContain("// one\n");
    expect(m).toContain("/* two */");
    expect(ok(minify(m))).toBe(m);
    expect(ok(beautify(b))).toBe(b);
  });

  it("commentInEmptyContainer", () => {
    const b = ok(beautify("[ /* nothing */ ]"));
    expect(b).toContain("/* nothing */");
    expect(ok(beautify(b))).toBe(b);
  });

  it("minifyBasic", () => {
    expect(ok(minify('{ "a": 1,\n "b": [1, 2] }'))).toBe('{"a":1,"b":[1,2]}');
  });

  it("topLevelScalars", () => {
    expect(ok(beautify('  "abc"\n'))).toBe('"abc"');
    expect(ok(beautify("42"))).toBe("42");
    expect(ok(minify(" true "))).toBe("true");
  });

  it("invalidReportsPosition", () => {
    const r = beautify('{"a":1,}');
    expect(r).toMatchObject({ ok: false, line: 1, col: 8 });
    expect(minify('{"a":1,}')).toMatchObject({ ok: false, line: 1, col: 8 });
  });

  it("reportsMultilinePosition", () => {
    expect(beautify('{\n  "a": 1\n  "b": 2\n}')).toMatchObject({
      ok: false,
      line: 3,
      col: 3,
    });
  });

  it.each([
    ["[1,]", 4],
    ['"abc', 1],
    ["[1}", 3],
    ["{} 1", 4],
    ["", 1],
    ["[1", 3],
    ['{"a" 1}', 6],
    ["{1:2}", 2],
    ["01", 1],
    ["tru", 1],
    ["/* open", 1],
    ['"a\\x"', 3],
  ])("invalid %j", (src, col) => {
    expect(beautify(src)).toMatchObject({ ok: false, line: 1, col });
  });

  it("beautifyIsLinearOnLargeInput", () => {
    const item = '{"id":123456,"name":"some name","tags":["a","b"],"v":1.50}';
    const parts: string[] = [];
    let size = 0;
    while (size < 5 * 1024 * 1024) {
      parts.push(item);
      size += item.length + 1;
    }
    const src = `[${parts.join(",")}]`;
    const t0 = performance.now();
    const r = beautify(src);
    const dt = performance.now() - t0;
    expect(r.ok).toBe(true);
    expect(dt).toBeLessThan(1500);
  });

  it("idempotent", () => {
    const src = '{"a":[1,{"b":null,"c":[]}],"d":"x" /* k */, "e":{}} // end';
    const once = beautify(src);
    expect(once.ok).toBe(true);
    expect(beautify(ok(once))).toEqual(once);
  });
});
