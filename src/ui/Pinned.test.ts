import { describe, expect, it } from "vitest";
import { newTabState } from "../model/workspace";
import type { TabState } from "../model/types";
import { pinnedItems, recentItems, RECENT_SHOWN } from "./Pinned";

const file = (id: string, path: string): TabState => ({
  ...newTabState(id),
  title: path.split("/").pop()!,
  file: {
    path,
    format: { encoding: "utf-8", bom: false, lineEnding: "lf", mixed: false },
    fingerprint: null,
    held: null,
  },
});

describe("pinnedItems", () => {
  it("lists open pins in tab order, then closed pins newest first", () => {
    const tabs = [
      { ...file("n", "C:/L/note.md"), pinned: true },
      newTabState("plain"),
      { ...newTabState("s", "canvas"), title: "Sketch", pinned: true },
    ];
    const closed = [
      {
        tab: { ...file("d", "C:/L/data.json"), pinned: true },
        index: 0,
        closedAt: 2,
      },
      { tab: newTabState("gone"), index: 0, closedAt: 1 },
      {
        tab: { ...newTabState("t"), title: "Todo", pinned: true },
        index: 0,
        closedAt: 0,
      },
    ];
    expect(pinnedItems(tabs, closed)).toEqual([
      { id: "n", title: "note.md", icon: "markdown", open: true },
      { id: "s", title: "Sketch", icon: "canvas", open: true },
      { id: "d", title: "data.json", icon: "data", open: false },
      { id: "t", title: "Todo", icon: "scratchpad", open: false },
    ]);
  });
});

describe("recentItems", () => {
  const key = (p: string) => p.toLowerCase();

  it("lists Files newest first, open or closed, once each, without pins", () => {
    const tabs = [
      file("a", "C:/L/a.md"),
      { ...file("p", "C:/L/pin.md"), pinned: true },
      newTabState("scratch"),
      file("a2", "C:/L/A.md"),
    ];
    const closed = [{ tab: file("c", "C:/L/c.json"), index: 0, closedAt: 1 }];
    expect(
      recentItems(["scratch", "c", "p", "a2", "a", "gone"], tabs, closed, key),
    ).toEqual([
      { id: "c", title: "c.json", icon: "data", open: false },
      { id: "a2", title: "A.md", icon: "markdown", open: true },
    ]);
  });

  it("shows at most RECENT_SHOWN", () => {
    const tabs = Array.from({ length: 12 }, (_, i) =>
      file(`t${i}`, `C:/L/${i}.md`),
    );
    const ids = tabs.map((t) => t.id);
    expect(recentItems(ids, tabs, [], key)).toHaveLength(RECENT_SHOWN);
  });
});
