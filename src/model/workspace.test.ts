import { describe, expect, it } from "vitest";
import type { TabState, WorkspaceState } from "./types";
import {
  activate,
  activateIndex,
  closeTab,
  cycle,
  ensureOneTab,
  findByPath,
  openFileTab,
  moveTab,
  newTab,
  newTabState,
  rename,
  movedPath,
  reopenClosed,
  rewritePaths,
  updateTab,
} from "./workspace";

const ws = (ids: string[], activeId = ids[0]): WorkspaceState => ({
  tabs: ids.map((id) => newTabState(id)),
  activeId,
  closed: [],
});
const same = (p: string) => p;
const ids = (s: WorkspaceState) => s.tabs.map((t) => t.id);

describe("newTabState", () => {
  it("has defaults", () => {
    expect(newTabState("x")).toEqual({
      id: "x",
      kind: "text",
      title: "Untitled",
      renamed: false,
      language: "plaintext",
      languagePicked: false,
      languageGuessed: false,
      selection: { anchor: 0, head: 0 },
      scrollTop: 0,
      wrap: false,
    });
  });
});

describe("newTab", () => {
  it("inserts after active and activates", () => {
    const s = newTab(ws(["a", "b", "c"], "b"), "n");
    expect(ids(s)).toEqual(["a", "b", "n", "c"]);
    expect(s.activeId).toBe("n");
  });
  it("does not mutate input", () => {
    const s0 = ws(["a"]);
    newTab(s0, "n");
    expect(ids(s0)).toEqual(["a"]);
  });
});

describe("closeTab", () => {
  it("closing the active middle tab activates the right neighbour", () => {
    const r = closeTab(ws(["a", "b", "c"], "b"), "b", false, 1, same);
    expect(ids(r.state)).toEqual(["a", "c"]);
    expect(r.state.activeId).toBe("c");
    expect(r.effect).toBe("closed");
  });
  it("closing the active last tab activates the left neighbour", () => {
    const r = closeTab(ws(["a", "b", "c"], "c"), "c", false, 1, same);
    expect(r.state.activeId).toBe("b");
  });
  it("closing a non-active tab keeps active", () => {
    const r = closeTab(ws(["a", "b", "c"], "a"), "c", false, 1, same);
    expect(r.state.activeId).toBe("a");
  });
  it("closing the only tab leaves none until ensureOneTab", () => {
    const r = closeTab(ws(["a"]), "a", true, 1, same);
    expect(r.state.tabs).toEqual([]);
    expect(r.effect).toBe("deleted");
    const e = ensureOneTab(r.state, "fresh");
    expect(ids(e)).toEqual(["fresh"]);
    expect(e.activeId).toBe("fresh");
  });
  it("empty tabs are deleted and not listed; non-empty are listed newest first with index", () => {
    let s = ws(["a", "b", "c", "d"], "a");
    const e = closeTab(s, "d", true, 1, same);
    expect(e.effect).toBe("deleted");
    expect(e.state.closed).toEqual([]);
    s = closeTab(s, "b", false, 10, same).state;
    const r = closeTab(s, "c", false, 20, same);
    expect(r.state.closed.map((c) => c.tab.id)).toEqual(["c", "b"]);
    expect(r.state.closed[0]).toMatchObject({ index: 1, closedAt: 20 });
    expect(r.state.closed[1]).toMatchObject({ index: 1, closedAt: 10 });
  });
});

describe("ensureOneTab", () => {
  it("is a no-op when tabs exist", () => {
    const s = ws(["a"]);
    expect(ensureOneTab(s, "z")).toEqual(s);
  });
});

describe("reopenClosed", () => {
  it("returns null reopened when nothing closed", () => {
    const s = ws(["a"]);
    const r = reopenClosed(s);
    expect(r.reopened).toBeNull();
    expect(r.state).toEqual(s);
  });
  it("reinserts at original index and activates", () => {
    const s = closeTab(ws(["a", "b", "c"], "b"), "b", false, 1, same).state;
    const r = reopenClosed(s);
    expect(ids(r.state)).toEqual(["a", "b", "c"]);
    expect(r.state.activeId).toBe("b");
    expect(r.reopened?.id).toBe("b");
    expect(r.state.closed).toEqual([]);
  });
  it("clamps index after reordering/shrinking", () => {
    let s = closeTab(ws(["a", "b", "c", "d"], "d"), "d", false, 1, same).state;
    s = closeTab(s, "c", true, 2, same).state;
    s = closeTab(s, "b", true, 3, same).state;
    const r = reopenClosed(s);
    expect(ids(r.state)).toEqual(["a", "d"]);
    expect(r.state.activeId).toBe("d");
  });
});

describe("activation", () => {
  it("activate sets activeId", () => {
    expect(activate(ws(["a", "b"]), "b").activeId).toBe("b");
  });
  it("activateIndex positions 1-8", () => {
    expect(activateIndex(ws(["a", "b", "c"]), 2).activeId).toBe("b");
  });
  it("activateIndex(9) goes to last", () => {
    expect(activateIndex(ws(["a", "b", "c"]), 9).activeId).toBe("c");
  });
  it("activateIndex out of range does nothing", () => {
    const s = ws(["a", "b", "c"], "b");
    expect(activateIndex(s, 5).activeId).toBe("b");
  });
  it("cycle wraps both ways", () => {
    const s = ws(["a", "b", "c"], "c");
    expect(cycle(s, 1).activeId).toBe("a");
    expect(cycle(ws(["a", "b", "c"], "a"), -1).activeId).toBe("c");
    expect(cycle(s, -1).activeId).toBe("b");
  });
});

describe("moveTab", () => {
  it("moves and keeps activeId", () => {
    const s = moveTab(ws(["a", "b", "c"], "a"), "a", 2);
    expect(ids(s)).toEqual(["b", "c", "a"]);
    expect(s.activeId).toBe("a");
  });
});

describe("rename", () => {
  it("sets title and renamed", () => {
    const s = rename(ws(["a"]), "a", "  Foo ", "derived");
    expect(s.tabs[0]).toMatchObject({ title: "Foo", renamed: true });
  });
  it("blank name reverts to derived", () => {
    let s = rename(ws(["a"]), "a", "Foo", "derived");
    s = rename(s, "a", "  ", "derived");
    expect(s.tabs[0]).toMatchObject({ title: "derived", renamed: false });
  });
});

describe("updateTab", () => {
  it("patches one tab only", () => {
    const s = updateTab(ws(["a", "b"]), "b", { wrap: true, scrollTop: 5 });
    expect(s.tabs[1]).toMatchObject({ wrap: true, scrollTop: 5 });
    expect(s.tabs[0].wrap).toBe(false);
  });
});

const withFile = (id: string, path: string) => ({
  ...newTabState(id),
  file: {
    path,
    format: {
      encoding: "utf-8",
      bom: false,
      lineEnding: "lf" as const,
      mixed: false,
    },
    fingerprint: null,
    held: null,
  },
});

describe("file tabs", () => {
  it("openFileTabInsertsAfterActive", () => {
    const s = openFileTab(ws(["a", "b", "c"], "a"), withFile("f", "p"));
    expect(ids(s)).toEqual(["a", "f", "b", "c"]);
    expect(s.activeId).toBe("f");
  });

  it("findByPathUsesKey", () => {
    const s = {
      ...ws(["a"]),
      tabs: [newTabState("a"), withFile("f", "/X.txt")],
    };
    expect(findByPath(s, "/X.txt", same)?.id).toBe("f");
    expect(findByPath(s, "/x.txt", same)).toBeUndefined();
    expect(findByPath(s, "/x.txt", (p) => p.toLowerCase())?.id).toBe("f");
  });

  it("reclosingSamePathReplacesEntry", () => {
    const s: WorkspaceState = {
      tabs: [withFile("f2", "p")],
      activeId: "f2",
      closed: [
        { tab: withFile("f1", "p"), index: 0, closedAt: 1 },
        { tab: withFile("g", "q"), index: 0, closedAt: 2 },
      ],
    };
    const { state } = closeTab(s, "f2", false, 9, same);
    expect(state.closed.map((e) => e.tab.id)).toEqual(["f2", "g"]);
  });

  it("reopenClosed takes an index into closed", () => {
    const s: WorkspaceState = {
      tabs: [newTabState("a")],
      activeId: "a",
      closed: [
        { tab: newTabState("x"), index: 0, closedAt: 2 },
        { tab: newTabState("y"), index: 5, closedAt: 1 },
      ],
    };
    const r = reopenClosed(s, 1);
    expect(r.reopened?.id).toBe("y");
    expect(ids(r.state)).toEqual(["a", "y"]);
    expect(r.state.closed.map((e) => e.tab.id)).toEqual(["x"]);
    expect(reopenClosed(s, 7).reopened).toBeNull();
  });
});

describe("rewritePaths", () => {
  const fileTab = (id: string, path: string): TabState => ({
    ...newTabState(id),
    title: path.split("/").pop()!,
    file: {
      path,
      format: { encoding: "utf-8", bom: false, lineEnding: "lf", mixed: false },
      fingerprint: null,
      held: "missing",
    },
  });

  it("moves only the paths Rust confirmed and keeps held state", () => {
    const s: WorkspaceState = {
      tabs: [
        fileTab("a", "C:/L/proj/a.md"),
        fileTab("b", "C:/L/proj/b.md"),
        newTabState("s"),
      ],
      activeId: "a",
      closed: [
        { tab: fileTab("c", "C:/L/proj/sub/c.md"), index: 0, closedAt: 1 },
      ],
    };
    const next = rewritePaths(
      s,
      new Map([
        ["C:/L/proj/a.md", "C:/L/work/a.md"],
        ["C:/L/proj/sub/c.md", "C:/L/work/sub/c.md"],
      ]),
    );
    expect(next.tabs[0].file).toMatchObject({
      path: "C:/L/work/a.md",
      held: "missing",
    });
    expect(next.tabs[0].title).toBe("a.md");
    // Not confirmed: left as it was.
    expect(next.tabs[1]).toBe(s.tabs[1]);
    expect(next.tabs[2]).toBe(s.tabs[2]);
    expect(next.closed[0].tab.file?.path).toBe("C:/L/work/sub/c.md");
  });

  it("retitles a renamed File, and changes nothing otherwise", () => {
    const s: WorkspaceState = {
      tabs: [fileTab("a", "C:/L/a.md")],
      activeId: "a",
      closed: [],
    };
    const next = rewritePaths(s, new Map([["C:/L/a.md", "C:/L/b.md"]]));
    expect(next.tabs[0].title).toBe("b.md");
    expect(rewritePaths(s, new Map())).toBe(s);
  });
});

describe("movedPath", () => {
  const lower = (p: string) => p.toLowerCase();
  it("matches the prefix by key, never a sibling", () => {
    expect(movedPath("C:/L/Proj/a.md", "C:/L/proj", "C:/L/w", lower)).toBe(
      "C:/L/w/a.md",
    );
    expect(movedPath("C:/L/proj2/a.md", "C:/L/proj", "C:/L/w", lower)).toBe(
      null,
    );
  });
});
