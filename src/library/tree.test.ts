import { describe, expect, it } from "vitest";
import type { Entry } from "./api";
import {
  filterRows,
  invalidate,
  rewritePrefix,
  rootOf,
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
  added: [],
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
      [R],
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
    expect(filterRows([file("/other/q.md")], [R])).toEqual([]);
  });

  it("filterRowsKeepsMatchedFolderEntryAndPosixPaths", () => {
    const link = { ...dir("/r/a"), link: "inside" as const };
    const rows = filterRows([file("/r/a/b.md"), link], ["/r/"]);
    expect(rows[0].entry).toBe(link);
    expect(rows[1].entry.path).toBe("/r/a/b.md");
  });
});

describe("added folders", () => {
  const X = "/x/proj";
  const Y = "/y/gone";
  function withAdded(): TreeState {
    let s: TreeState = {
      ...sample(),
      added: [
        { path: X, available: true },
        { path: Y, available: false },
      ],
    };
    s = setChildren(s, X, [dir(`${X}/sub`), file(`${X}/n.md`)]);
    s = setChildren(s, `${X}/sub`, [file(`${X}/sub/d.md`)]);
    return s;
  }
  const show = (s: TreeState) =>
    visibleRows(s).map(
      (r) =>
        `${r.depth}:${r.entry.name}${r.heading ? `:h${r.heading.available ? "" : "!"}` : ""}`,
    );

  it("added_rows_follow_library_rows_with_headings", () => {
    const s = toggle(toggle(withAdded(), X), `${X}/sub`);
    expect(show(s)).toEqual([
      "0:a",
      "0:b",
      "0:z.md",
      "0:proj:h",
      "1:sub",
      "2:d.md",
      "1:n.md",
      "0:gone:h!",
    ]);
    const heading = visibleRows(s)[3];
    expect(heading.entry).toEqual({
      name: "proj",
      path: X,
      isDir: true,
      link: null,
    });
    // Only an added folder's own row is a heading.
    expect(visibleRows(s).filter((r) => r.heading)).toHaveLength(2);
  });

  it("collapsed_or_missing_added_shows_heading_only", () => {
    let s = withAdded();
    // Collapsed: the heading alone.
    expect(show(s)).toEqual(["0:a", "0:b", "0:z.md", "0:proj:h", "0:gone:h!"]);
    // Missing, though expanded and with a cached listing: the heading alone.
    s = setChildren(toggle(s, Y), Y, [file(`${Y}/old.md`)]);
    expect(show(s)).toEqual(["0:a", "0:b", "0:z.md", "0:proj:h", "0:gone:h!"]);
    // No Library listing (or no Library): the added folders still show.
    expect(show({ ...s, root: null })).toEqual(["0:proj:h", "0:gone:h!"]);
  });

  it("filterRows_groups_by_root", () => {
    const rows = filterRows(
      [
        file(`${X}/sub/d.md`),
        file(`${R}/z.md`),
        file("/elsewhere/q.md"),
        file(`${R}/a/f.md`),
      ],
      [R, "/w/empty", X],
    );
    expect(
      rows.map((r) => `${r.depth}:${r.entry.name}${r.heading ? ":h" : ""}`),
    ).toEqual(["0:z.md", "0:a", "1:f.md", "0:proj:h", "1:sub", "2:d.md"]);
    expect(rows[3].entry.path).toBe(X);
  });

  it("rootOf_respects_separators", () => {
    const roots = ["/a/b", "/c"];
    expect(rootOf("/a/b2/x", roots, false)).toBeNull();
    expect(rootOf("/a/b/x", roots, false)).toBe("/a/b");
    expect(rootOf("/a/b", roots, false)).toBe("/a/b");
    expect(rootOf("/c/d/e", roots, false)).toBe("/c");
    expect(rootOf("/A/B/x", roots, false)).toBeNull();
    const W = ["c:", "lib"].join("\\");
    expect(rootOf(["C:", "Lib", "x"].join("\\"), [W], true)).toBe(W);
    expect(rootOf(["C:", "Lib2", "x"].join("\\"), [W], true)).toBeNull();
    expect(rootOf("/r/a", ["/r/"], false)).toBe("/r/");
  });

  it("rewritePrefix_rewrites_added_paths", () => {
    const out = rewritePrefix(withAdded(), X, "/x/work");
    expect(out.added.map((a) => a.path)).toEqual(["/x/work", Y]);
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
      added: [],
    };
    s = setChildren(s, W, [e(p("a"), true)]);
    s = setChildren(s, p("a"), [e(p("a", "f.md"), false)]);
    const out = rewritePrefix(s, p("a"), p("c"));
    expect(visibleRows(out).map((r) => r.entry.path)).toEqual([
      p("c"),
      p("c", "f.md"),
    ]);
    expect(
      filterRows([e(p("a", "f.md"), false)], [W]).map((r) => r.entry.path),
    ).toEqual([p("a"), p("a", "f.md")]);
  });
});
