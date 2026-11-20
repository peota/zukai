import { describe, expect, it } from "vitest";
import { newTabState } from "./workspace";
import { RECENT_KEEP, touchRecent } from "./recent";
import type { WorkspaceState } from "./types";

const ws = (open: string[], closed: string[] = []): WorkspaceState => ({
  tabs: open.map((id) => newTabState(id)),
  activeId: open[0],
  closed: closed.map((id) => ({ tab: newTabState(id), index: 0, closedAt: 0 })),
});

describe("touchRecent", () => {
  it("moves the id to the front", () => {
    expect(touchRecent(["a", "b", "c"], "c", ws(["a", "b", "c"]))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("keeps closed Tabs and drops ids that are gone", () => {
    expect(touchRecent(["b", "gone", "c"], "a", ws(["a"], ["c"]))).toEqual([
      "a",
      "c",
    ]);
  });

  it("keeps at most RECENT_KEEP", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(touchRecent(ids, "t29", ws(ids))).toHaveLength(RECENT_KEEP);
  });
});
