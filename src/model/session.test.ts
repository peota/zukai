import { describe, expect, it } from "vitest";
import {
  CLOSED_TTL_MS,
  parseSessionFile,
  purgeExpired,
  restoreWorkspace,
  toSessionFile,
} from "./session";
import { newTabState } from "./workspace";
import type { ClosedEntry, TabState, WorkspaceState } from "./types";

const ws: WorkspaceState = {
  tabs: [
    newTabState("a"),
    { ...newTabState("b"), title: "Notes", renamed: true },
  ],
  activeId: "b",
  closed: [{ tab: newTabState("c"), index: 1, closedAt: 1000 }],
};

const fresh = () => "fresh";

describe("session file", () => {
  it("round trips", () => {
    expect(parseSessionFile(JSON.stringify(toSessionFile(ws)))).toEqual({
      version: 1,
      ...ws,
    });
  });

  it("returns null for bad input", () => {
    expect(parseSessionFile(null)).toBeNull();
    expect(parseSessionFile("{")).toBeNull();
    expect(parseSessionFile('{"version":2}')).toBeNull();
    const noId: Partial<TabState> = newTabState("x");
    delete noId.id;
    expect(
      parseSessionFile(
        JSON.stringify({ version: 1, tabs: [noId], activeId: "x", closed: [] }),
      ),
    ).toBeNull();
  });
});

describe("purgeExpired", () => {
  const entry = (closedAt: number): ClosedEntry => ({
    tab: newTabState("z"),
    index: 0,
    closedAt,
  });
  it("keeps exactly 30 days, expires 30 days + 1 ms", () => {
    const now = 10 * CLOSED_TTL_MS;
    const keep = entry(now - CLOSED_TTL_MS);
    const drop = entry(now - CLOSED_TTL_MS - 1);
    expect(purgeExpired([keep, drop], now)).toEqual({
      kept: [keep],
      expired: [drop],
    });
  });
});

describe("restoreWorkspace", () => {
  it("opens all scratchpads sorted when the session is unreadable", () => {
    const { state } = restoreWorkspace(
      parseSessionFile("{corrupt"),
      ["b", "a"],
      fresh,
      0,
    );
    expect(state.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(state.activeId).toBe("a");
  });

  it("appends orphans at the end", () => {
    const { state } = restoreWorkspace(
      toSessionFile(ws),
      ["o", "a", "b"],
      fresh,
      0,
    );
    expect(state.tabs.map((t) => t.id)).toEqual(["a", "b", "o"]);
    expect(state.activeId).toBe("b");
  });

  it("repairs a missing activeId", () => {
    const file = { ...toSessionFile(ws), activeId: "gone" };
    const { state } = restoreWorkspace(file, ["a", "b"], fresh, 0);
    expect(state.activeId).toBe("a");
  });

  it("purges expired closed entries", () => {
    const now = 1000 + CLOSED_TTL_MS + 1;
    const { state, expired } = restoreWorkspace(
      toSessionFile(ws),
      ["a", "b"],
      fresh,
      now,
    );
    expect(state.closed).toEqual([]);
    expect(expired).toHaveLength(1);
  });

  it("yields one fresh tab when empty", () => {
    const { state } = restoreWorkspace(null, [], fresh, 0);
    expect(state.tabs).toEqual([newTabState("fresh")]);
    expect(state.activeId).toBe("fresh");
  });
  it("dedupes tabs by id keeping the first", () => {
    const file = {
      ...toSessionFile(ws),
      tabs: [ws.tabs[0], { ...ws.tabs[0], title: "dup" }, ws.tabs[1]],
    };
    const { state } = restoreWorkspace(file, [], fresh, 0);
    expect(state.tabs).toEqual([ws.tabs[0], ws.tabs[1]]);
  });

  it("drops closed entries that are open tabs and dedupes closed", () => {
    const e = (id: string, closedAt: number): ClosedEntry => ({
      tab: newTabState(id),
      index: 0,
      closedAt,
    });
    const file = {
      ...toSessionFile(ws),
      closed: [e("a", 5), e("c", 4), e("c", 3)],
    };
    const { state } = restoreWorkspace(file, [], fresh, 10);
    expect(state.closed).toEqual([e("c", 4)]);
  });

  it("handles a session file with no tabs", () => {
    const file = { version: 1 as const, tabs: [], activeId: "", closed: [] };
    const withOrphans = restoreWorkspace(file, ["q"], fresh, 0).state;
    expect(withOrphans.tabs.map((t) => t.id)).toEqual(["q"]);
    expect(withOrphans.activeId).toBe("q");
    const empty = restoreWorkspace(file, [], fresh, 0).state;
    expect(empty.tabs.map((t) => t.id)).toEqual(["fresh"]);
    expect(empty.activeId).toBe("fresh");
  });
});

describe("restoreWorkspace with the closed/ folder", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 3 * day;

  it("turns unreferenced closed files into Recently Closed entries", () => {
    const { state } = restoreWorkspace(
      toSessionFile(ws),
      ["a", "b"],
      fresh,
      now,
      [
        { id: "c", modifiedMs: 1000 },
        { id: "lost", modifiedMs: now - day },
      ],
    );
    // Recovered entries are stamped `now` and reopen at the end of the tab bar.
    expect(state.closed.map((e) => e.tab.id)).toEqual(["lost", "c"]);
    expect(state.closed[0]).toEqual({
      tab: newTabState("lost"),
      index: 2,
      closedAt: now,
    });
  });

  it("recoveredClosedFilesAreNotPurgedOnRecovery", () => {
    const { state, expired } = restoreWorkspace(null, ["a"], fresh, now, [
      { id: "old", modifiedMs: now - 40 * day },
    ]);
    expect(state.closed).toHaveLength(1);
    expect(state.closed[0].closedAt).toBe(now);
    expect(expired).toEqual([]);
  });

  it("recovers every closed file when session.json is unreadable", () => {
    const { state } = restoreWorkspace(
      parseSessionFile("{corrupt"),
      ["a"],
      fresh,
      now,
      [
        { id: "x", modifiedMs: now - 2 },
        { id: "y", modifiedMs: now - 1 },
      ],
    );
    expect(state.tabs.map((t) => t.id)).toEqual(["a"]);
    expect(state.closed.map((e) => e.tab.id)).toEqual(["x", "y"]);
  });

  it("drops closed entries whose file is gone, so Reopen is never stuck", () => {
    const file = {
      ...toSessionFile(ws),
      closed: [
        { tab: newTabState("c"), index: 1, closedAt: now - 2 },
        { tab: newTabState("d"), index: 0, closedAt: now - 1 },
      ],
    };
    const { state } = restoreWorkspace(file, ["a", "b"], fresh, now, [
      { id: "c", modifiedMs: 1 },
    ]);
    expect(state.closed.map((e) => e.tab.id)).toEqual(["c"]);
    // Without a listing of closed/, the Session's list is trusted as is.
    const trusted = restoreWorkspace(file, ["a", "b"], fresh, now).state;
    expect(trusted.closed.map((e) => e.tab.id)).toEqual(["d", "c"]);
  });

  it("never lists an open Tab as closed", () => {
    const { state } = restoreWorkspace(
      toSessionFile(ws),
      ["a", "b"],
      fresh,
      now,
      [
        { id: "a", modifiedMs: 5 },
        { id: "c", modifiedMs: 5 },
      ],
    );
    expect(state.closed.map((e) => e.tab.id)).toEqual(["c"]);
  });
});
