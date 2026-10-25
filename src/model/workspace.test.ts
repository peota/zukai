import { describe, expect, it } from "vitest";
import type { WorkspaceState } from "./types";
import {
  activate,
  activateIndex,
  closeTab,
  cycle,
  ensureOneTab,
  moveTab,
  newTab,
  newTabState,
  rename,
  reopenClosed,
  updateTab,
} from "./workspace";

const ws = (ids: string[], activeId = ids[0]): WorkspaceState => ({
  tabs: ids.map(newTabState),
  activeId,
  closed: [],
});
const ids = (s: WorkspaceState) => s.tabs.map((t) => t.id);

describe("newTabState", () => {
  it("has defaults", () => {
    expect(newTabState("x")).toEqual({
      id: "x",
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
    const r = closeTab(ws(["a", "b", "c"], "b"), "b", false, 1);
    expect(ids(r.state)).toEqual(["a", "c"]);
    expect(r.state.activeId).toBe("c");
    expect(r.effect).toBe("closed");
  });
  it("closing the active last tab activates the left neighbour", () => {
    const r = closeTab(ws(["a", "b", "c"], "c"), "c", false, 1);
    expect(r.state.activeId).toBe("b");
  });
  it("closing a non-active tab keeps active", () => {
    const r = closeTab(ws(["a", "b", "c"], "a"), "c", false, 1);
    expect(r.state.activeId).toBe("a");
  });
  it("closing the only tab leaves none until ensureOneTab", () => {
    const r = closeTab(ws(["a"]), "a", true, 1);
    expect(r.state.tabs).toEqual([]);
    expect(r.effect).toBe("deleted");
    const e = ensureOneTab(r.state, "fresh");
    expect(ids(e)).toEqual(["fresh"]);
    expect(e.activeId).toBe("fresh");
  });
  it("empty tabs are deleted and not listed; non-empty are listed newest first with index", () => {
    let s = ws(["a", "b", "c", "d"], "a");
    const e = closeTab(s, "d", true, 1);
    expect(e.effect).toBe("deleted");
    expect(e.state.closed).toEqual([]);
    s = closeTab(s, "b", false, 10).state;
    const r = closeTab(s, "c", false, 20);
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
    const s = closeTab(ws(["a", "b", "c"], "b"), "b", false, 1).state;
    const r = reopenClosed(s);
    expect(ids(r.state)).toEqual(["a", "b", "c"]);
    expect(r.state.activeId).toBe("b");
    expect(r.reopened?.id).toBe("b");
    expect(r.state.closed).toEqual([]);
  });
  it("clamps index after reordering/shrinking", () => {
    let s = closeTab(ws(["a", "b", "c", "d"], "d"), "d", false, 1).state;
    s = closeTab(s, "c", true, 2).state;
    s = closeTab(s, "b", true, 3).state;
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
