import { describe, expect, it } from "vitest";
import {
  makeSplit,
  normalizeSplits,
  setOrientation,
  setSplitRatio,
  splitOf,
  swapSides,
  unsplit,
} from "./split";
import type { Split, WorkspaceState } from "./types";
import {
  activate,
  closeTab,
  moveTab,
  newTab,
  newTabState,
  openFileTab,
  setPinned,
} from "./workspace";

const ws = (idList: string[], activeId = idList[0]): WorkspaceState => ({
  tabs: idList.map((id) => newTabState(id)),
  activeId,
  closed: [],
});
const ids = (s: WorkspaceState) => s.tabs.map((t) => t.id);
const same = (p: string) => p;
const pair = (idList: string[], activeId = idList[0]) =>
  makeSplit(ws(idList, activeId), "a", "b");

describe("Split rules", () => {
  it("makesASplitNextToItsFirstTab", () => {
    const s = ws(["a", "x", "b"]);
    const r = makeSplit(s, "a", "b");
    expect(ids(r)).toEqual(["a", "b", "x"]);
    expect(r.splits).toEqual([
      { a: "a", b: "b", orientation: "row", ratio: 0.5, focus: "a" },
    ]);
    expect(makeSplit(s, "a", "a")).toBe(s);
    expect(makeSplit(r, "a", "x")).toBe(r);
    expect(makeSplit(r, "x", "b")).toBe(r);
    expect(makeSplit(s, "a", "nope")).toBe(s);
  });

  it("focusesTheActiveMemberAndGivesBThePin", () => {
    const s = ws(["a", "b"], "b");
    const r = makeSplit(setPinned(s, "a", true), "a", "b");
    expect(r.splits![0].focus).toBe("b");
    expect(r.activeId).toBe("b");
    expect(r.tabs.every((t) => t.pinned)).toBe(true);
  });

  it("movesANewlyPinnedPairInWithThePinnedTabs", () => {
    // p pinned; splitting x with pinned b pins both, so the pair joins p.
    let s = ws(["p", "y", "x", "b"], "x");
    s = setPinned(setPinned(s, "p", true), "b", true);
    expect(ids(s)).toEqual(["p", "b", "y", "x"]);
    const r = makeSplit(s, "x", "b");
    expect(ids(r)).toEqual(["p", "x", "b", "y"]);
    expect(r.tabs.slice(0, 3).every((t) => t.pinned)).toBe(true);
  });

  it("unsplitSwapOrientationRatio", () => {
    const s = pair(["a", "b", "x"]);
    const sw = swapSides(s, "a");
    expect(ids(sw)).toEqual(["b", "a", "x"]);
    expect(sw.splits![0]).toMatchObject({ a: "b", b: "a" });
    expect(sw.activeId).toBe("a");
    expect(setOrientation(s, "b", "column").splits![0].orientation).toBe(
      "column",
    );
    expect(setSplitRatio(s, "a", 0.95).splits![0].ratio).toBe(0.8);
    const u = unsplit(activate(s, "b"), "a");
    expect(u.splits).toEqual([]);
    expect(ids(u)).toEqual(["a", "b", "x"]);
    expect(u.activeId).toBe("b");
  });

  it("activatingAMemberFocusesIt", () => {
    const s = pair(["a", "b"]);
    const b = activate(s, "b");
    expect(b.splits![0].focus).toBe("b");
    expect(activate(b, "a").splits![0].focus).toBe("a");
    expect(splitOf(b, "b")).toBe(b.splits![0]);
  });

  it("closingAMemberEndsTheSplit", () => {
    const s = pair(["a", "b", "x"]);
    const r = closeTab(s, "b", false, 0, same).state;
    expect(r.splits).toEqual([]);
    expect(ids(r)).toEqual(["a", "x"]);
  });

  it("closingTheFocusedRightMemberActivatesTheOther", () => {
    const s = pair(["a", "b", "x"], "b");
    expect(s.activeId).toBe("b");
    const r = closeTab(s, "b", false, 0, same).state;
    expect(r.splits).toEqual([]);
    expect(r.activeId).toBe("a");
  });

  it("splittingAnUnpinnedWithAPinnedSharesThePin", () => {
    const s = setPinned(ws(["a", "x", "b"]), "b", true);
    const r = makeSplit(s, "a", "b");
    expect(ids(r)).toEqual(["a", "b", "x"]);
    expect(r.tabs.map((t) => !!t.pinned)).toEqual([true, true, false]);
  });

  it("movingAMemberMovesThePair", () => {
    const s = pair(["a", "b", "x", "y"]);
    expect(ids(moveTab(s, "b", 2))).toEqual(["x", "y", "a", "b"]);
    expect(ids(moveTab(s, "x", 0))).toEqual(["x", "a", "b", "y"]);
  });

  it("pinningOneMemberPinsBoth", () => {
    const s = pair(["a", "b", "x"]);
    const r = setPinned(s, "b", true);
    expect(ids(r)).toEqual(["a", "b", "x"]);
    expect(r.tabs.map((t) => !!t.pinned)).toEqual([true, true, false]);
    const moved = moveTab(r, "x", 0);
    expect(ids(moved)).toEqual(["a", "b", "x"]);
    const un = setPinned(r, "a", false);
    expect(un.tabs.some((t) => t.pinned)).toBe(false);
  });

  it("newTabsLandAfterTheJoinedTab", () => {
    const s = pair(["a", "b", "x"]);
    expect(ids(newTab(s, "n"))).toEqual(["a", "b", "n", "x"]);
    expect(ids(openFileTab(s, newTabState("f")))).toEqual(["a", "b", "f", "x"]);
  });

  it("normalizeDropsAndReunites", () => {
    const sp = (a: string, b: string): Split => ({
      a,
      b,
      orientation: "row",
      ratio: 0.5,
      focus: "a",
    });
    const gone = { ...ws(["a", "x"]), splits: [sp("a", "b")] };
    expect(normalizeSplits(gone).splits).toEqual([]);
    const repeat = {
      ...ws(["a", "b", "c"]),
      splits: [sp("a", "b"), sp("b", "c")],
    };
    expect(normalizeSplits(repeat).splits).toEqual([sp("a", "b")]);
    const apart = { ...ws(["a", "x", "b"]), splits: [sp("a", "b")] };
    expect(ids(normalizeSplits(apart))).toEqual(["a", "b", "x"]);
    const ok = pair(["a", "b"]);
    expect(normalizeSplits(ok)).toBe(ok);
  });
});
