import { describe, expect, it } from "vitest";
import type { Entry } from "./api";
import {
  filterRows,
  invalidate,
  rewritePrefix,
  setChildren,
  toggle,
  visibleRows,
  type TreeState,
} from "./tree";

const R = "/lib";
const dir = (path: string): Entry => ({
  name: path.split("/").pop()!,
  path,
  isDir: true,
  link: null,
});
const file = (path: string): Entry => ({ ...dir(path), isDir: false });

const empty = (): TreeState => ({
  root: R,
  children: {},
  expanded: new Set(),
  selected: null,
});

function sample(): TreeState {
  let s = empty();
  s = setChildren(s, R, [dir(`${R}/a`), dir(`${R}/b`), file(`${R}/z.md`)]);
  s = setChildren(s, `${R}/a`, [dir(`${R}/a/x`), file(`${R}/a/f.md`)]);
  s = setChildren(s, `${R}/a/x`, [file(`${R}/a/x/deep.md`)]);
  s = setChildren(s, `${R}/b`, [file(`${R}/b/g.md`)]);
  return s;
}

describe("tree", () => {
  it("visibleRowsPreOrderOnlyExpanded", () => {
    let s = sample();
    expect(visibleRows(s).map((r) => r.entry.name)).toEqual(["a", "b", "z.md"]);
    s = toggle(toggle(s, `${R}/a`), `${R}/a/x`);
    expect(visibleRows(s).map((r) => `${r.depth}:${r.entry.name}`)).toEqual([
      "0:a",
      "1:x",
      "2:deep.md",
      "1:f.md",
      "0:b",
      "0:z.md",
    ]);
    s = toggle(s, `${R}/a`);
    expect(visibleRows(s)).toHaveLength(3);
  });

  it("visibleRowsSkipsLoadingAndHandlesNoRoot", () => {
    const s = toggle(
      {
        ...sample(),
        children: { ...sample().children, [`${R}/a`]: "loading" },
      },
      `${R}/a`,
    );
    expect(visibleRows(s)).toHaveLength(3);
    expect(visibleRows({ ...s, root: null })).toEqual([]);
  });

  it("visibleRowsLinearOnLargeTree", () => {
    const n = 20000;
    let s = empty();
    s = setChildren(s, R, [dir(`${R}/big`)]);
    s = setChildren(
      s,
      `${R}/big`,
      Array.from({ length: n }, (_, i) => file(`${R}/big/${i}.md`)),
    );
    s = toggle(s, `${R}/big`);
    expect(visibleRows(s)).toHaveLength(n + 1);
  });

  it("invalidateReturnsOnlyLoadedDirs", () => {
    let s = toggle(sample(), `${R}/a`);
    const out = invalidate(s, [R, `${R}/a`, `${R}/b`, `${R}/nope`, R]);
    // root and expanded a reload; collapsed b drops its cache; unknown ignored.
    expect(out.reload).toEqual([R, `${R}/a`]);
    expect(out.state.children[`${R}/b`]).toBeUndefined();
    expect(out.state.children[`${R}/a`]).toBeDefined();
    s = sample();
    expect(invalidate(s, [`${R}/nope`]).reload).toEqual([]);
    expect(invalidate(s, [`${R}/nope`]).state).toBe(s);
  });

  it("rewritePrefixUpdatesExpandedAndChildren", () => {
    let s = sample();
    s = toggle(toggle(s, `${R}/a`), `${R}/a/x`);
    s = { ...s, selected: `${R}/a/f.md` };
    const out = rewritePrefix(s, `${R}/a`, `${R}/c`);
    expect(out.children[`${R}/a`]).toBeUndefined();
    expect(out.children[`${R}/c`]?.[1]).toMatchObject({
      path: `${R}/c/f.md`,
      name: "f.md",
    });
    expect(out.children[`${R}/c/x`]).toBeDefined();
    expect(out.children[R]![0]).toMatchObject({ path: `${R}/c`, name: "c" });
    expect([...out.expanded].sort()).toEqual([`${R}/c`, `${R}/c/x`]);
    expect(out.selected).toBe(`${R}/c/f.md`);
    // sibling sharing a textual prefix is untouched
    const s2 = setChildren(s, R, [dir(`${R}/a`), dir(`${R}/ab`)]);
    expect(rewritePrefix(s2, `${R}/a`, `${R}/c`).children[R]![1]).toMatchObject(
      { path: `${R}/ab` },
    );
  });

  it("filterRowsIncludesAncestors", () => {
    const rows = filterRows(
      [file(`${R}/a/x/deep.md`), file(`${R}/a/f.md`), file(`${R}/z.md`)],
      R,
    );
    expect(
      rows.map((r) => `${r.depth}:${r.entry.name}:${r.entry.isDir}`),
    ).toEqual([
      "0:a:true",
      "1:x:true",
      "2:deep.md:false",
      "1:f.md:false",
      "0:z.md:false",
    ]);
    expect(filterRows([file("/other/q.md")], R)).toEqual([]);
  });

  it("filterRowsKeepsMatchedFolderEntryAndPosixPaths", () => {
    const link = { ...dir("/r/a"), link: "inside" as const };
    const rows = filterRows([file("/r/a/b.md"), link], "/r/");
    expect(rows[0].entry).toBe(link);
    expect(rows[1].entry.path).toBe("/r/a/b.md");
  });
});

describe("tree with backslash paths", () => {
  const W = "C:" + "\\" + "lib";
  const p = (...parts: string[]) => [W, ...parts].join("\\");
  it("rewritesAndFilters", () => {
    const e = (path: string, isDir: boolean): Entry => ({
      name: path.split("\\").pop()!,
      path,
      isDir,
      link: null,
    });
    let s: TreeState = {
      root: W,
      children: {},
      expanded: new Set([p("a")]),
      selected: null,
    };
    s = setChildren(s, W, [e(p("a"), true)]);
    s = setChildren(s, p("a"), [e(p("a", "f.md"), false)]);
    const out = rewritePrefix(s, p("a"), p("c"));
    expect(visibleRows(out).map((r) => r.entry.path)).toEqual([
      p("c"),
      p("c", "f.md"),
    ]);
    expect(
      filterRows([e(p("a", "f.md"), false)], W).map((r) => r.entry.path),
    ).toEqual([p("a"), p("a", "f.md")]);
  });
});
