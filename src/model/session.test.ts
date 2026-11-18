import { describe, expect, it } from "vitest";
import {
  CLOSED_TTL_MS,
  DEFAULT_SIDEBAR,
  type ScratchFile,
  parseSessionFile,
  purgeExpired,
  restoreWorkspace,
  toSessionFile,
} from "./session";
import { pathKey } from "../files/api";
import { newTabState } from "./workspace";
import type { ClosedEntry, FileInfo, TabState, WorkspaceState } from "./types";

const ws: WorkspaceState = {
  tabs: [
    newTabState("a"),
    { ...newTabState("b"), title: "Notes", renamed: true },
  ],
  activeId: "b",
  closed: [{ tab: newTabState("c"), index: 1, closedAt: 1000 }],
};

const fresh = () => "fresh";
const same = (p: string) => p;
const restore = (
  file: Parameters<typeof restoreWorkspace>[0],
  ids: (string | ScratchFile)[],
  freshId: () => string,
  now: number,
  closedFiles: Parameters<typeof restoreWorkspace>[4] = null,
  granted: Parameters<typeof restoreWorkspace>[5] = null,
  keyOf: (p: string) => string = same,
) =>
  restoreWorkspace(
    file,
    ids.map((i) =>
      typeof i === "string" ? { id: i, ext: "txt" as const } : i,
    ),
    freshId,
    now,
    closedFiles,
    granted,
    keyOf,
  );

describe("session file", () => {
  it("round trips", () => {
    expect(parseSessionFile(JSON.stringify(toSessionFile(ws)))).toEqual({
      version: 3,
      ...ws,
      sidebar: DEFAULT_SIDEBAR,
    });
  });

  it("returns null for bad input", () => {
    expect(parseSessionFile(null)).toBeNull();
    expect(parseSessionFile("{")).toBeNull();
    expect(parseSessionFile('{"version":2}')).toBeNull();
    const noId: Partial<TabState> = newTabState("x");
    delete noId.id;
    // A malformed tab is dropped alone.
    expect(
      parseSessionFile(
        JSON.stringify({ version: 2, tabs: [noId], activeId: "x", closed: [] }),
      )?.tabs,
    ).toEqual([]);
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
    const { state } = restore(
      parseSessionFile("{corrupt"),
      ["b", "a"],
      fresh,
      0,
    );
    expect(state.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(state.activeId).toBe("a");
  });

  it("appends orphans at the end", () => {
    const { state } = restore(toSessionFile(ws), ["o", "a", "b"], fresh, 0);
    expect(state.tabs.map((t) => t.id)).toEqual(["a", "b", "o"]);
    expect(state.activeId).toBe("b");
  });

  it("repairs a missing activeId", () => {
    const file = { ...toSessionFile(ws), activeId: "gone" };
    const { state } = restore(file, ["a", "b"], fresh, 0);
    expect(state.activeId).toBe("a");
  });

  it("purges expired closed entries", () => {
    const now = 1000 + CLOSED_TTL_MS + 1;
    const { state, expired } = restore(
      toSessionFile(ws),
      ["a", "b"],
      fresh,
      now,
    );
    expect(state.closed).toEqual([]);
    expect(expired).toHaveLength(1);
  });

  it("yields one fresh tab when empty", () => {
    const { state } = restore(null, [], fresh, 0);
    expect(state.tabs).toEqual([newTabState("fresh")]);
    expect(state.activeId).toBe("fresh");
  });
  it("dedupes tabs by id keeping the first", () => {
    const file = {
      ...toSessionFile(ws),
      tabs: [ws.tabs[0], { ...ws.tabs[0], title: "dup" }, ws.tabs[1]],
    };
    const { state } = restore(file, [], fresh, 0);
    expect(state.tabs).toEqual([ws.tabs[0], ws.tabs[1]]);
  });

  it("dedupes open File Tabs by path key, keeping the first", () => {
    const fileOf = (path: string): FileInfo => ({
      path,
      format: { encoding: "utf-8", bom: false, lineEnding: "lf", mixed: false },
      fingerprint: null,
      held: null,
    });
    const f1 = { ...newTabState("f1"), file: fileOf("C:\\d\\A.txt") };
    const f2 = { ...newTabState("f2"), file: fileOf("c:\\d\\a.txt") };
    const f3 = { ...newTabState("f3"), file: fileOf("C:\\d\\B.txt") };
    const file = { ...toSessionFile(ws), tabs: [f1, f2, f3], activeId: "f2" };
    const { state } = restore(file, [], fresh, 0, null, null, (p) =>
      pathKey(p, "windows"),
    );
    expect(state.tabs.map((t) => t.id)).toEqual(["f1", "f3"]);
    expect(state.activeId).toBe("f1");
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
    const { state } = restore(file, [], fresh, 10);
    expect(state.closed).toEqual([e("c", 4)]);
  });

  it("handles a session file with no tabs", () => {
    const file = {
      version: 3 as const,
      tabs: [],
      activeId: "",
      closed: [],
      sidebar: DEFAULT_SIDEBAR,
    };
    const withOrphans = restore(file, ["q"], fresh, 0).state;
    expect(withOrphans.tabs.map((t) => t.id)).toEqual(["q"]);
    expect(withOrphans.activeId).toBe("q");
    const empty = restore(file, [], fresh, 0).state;
    expect(empty.tabs.map((t) => t.id)).toEqual(["fresh"]);
    expect(empty.activeId).toBe("fresh");
  });
});

describe("restoreWorkspace with the closed/ folder", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = 3 * day;

  it("turns unreferenced closed files into Recently Closed entries", () => {
    const { state } = restore(toSessionFile(ws), ["a", "b"], fresh, now, [
      { id: "c", ext: "txt", modifiedMs: 1000 },
      { id: "lost", ext: "txt", modifiedMs: now - day },
    ]);
    // Recovered entries are stamped `now` and reopen at the end of the tab bar.
    expect(state.closed.map((e) => e.tab.id)).toEqual(["lost", "c"]);
    expect(state.closed[0]).toEqual({
      tab: newTabState("lost"),
      index: 2,
      closedAt: now,
    });
  });

  it("recoveredClosedFilesAreNotPurgedOnRecovery", () => {
    const { state, expired } = restore(null, ["a"], fresh, now, [
      { id: "old", ext: "txt", modifiedMs: now - 40 * day },
    ]);
    expect(state.closed).toHaveLength(1);
    expect(state.closed[0].closedAt).toBe(now);
    expect(expired).toEqual([]);
  });

  it("recovers every closed file when session.json is unreadable", () => {
    const { state } = restore(parseSessionFile("{corrupt"), ["a"], fresh, now, [
      { id: "x", ext: "txt", modifiedMs: now - 2 },
      { id: "y", ext: "txt", modifiedMs: now - 1 },
    ]);
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
    const { state } = restore(file, ["a", "b"], fresh, now, [
      { id: "c", ext: "txt", modifiedMs: 1 },
    ]);
    expect(state.closed.map((e) => e.tab.id)).toEqual(["c"]);
    // Without a listing of closed/, the Session's list is trusted as is.
    const trusted = restore(file, ["a", "b"], fresh, now).state;
    expect(trusted.closed.map((e) => e.tab.id)).toEqual(["d", "c"]);
  });

  it("never lists an open Tab as closed", () => {
    const { state } = restore(toSessionFile(ws), ["a", "b"], fresh, now, [
      { id: "a", ext: "txt", modifiedMs: 5 },
      { id: "c", ext: "txt", modifiedMs: 5 },
    ]);
    expect(state.closed.map((e) => e.tab.id)).toEqual(["c"]);
  });
});

const fileInfo = (path: string, held: FileInfo["held"] = null): FileInfo => ({
  path,
  format: { encoding: "utf-8", bom: false, lineEnding: "lf", mixed: false },
  fingerprint: { mtimeMs: 1, size: 2, hash: "h" },
  held,
});
const fileTab = (id: string, path: string, held: FileInfo["held"] = null) => ({
  ...newTabState(id),
  file: fileInfo(path, held),
});

describe("session v3", () => {
  it("v1SessionMigratesToV3AllScratchpads", () => {
    const v1 = JSON.stringify({ ...toSessionFile(ws), version: 1 });
    const parsed = parseSessionFile(v1);
    expect(parsed).toEqual({ version: 3, ...ws, sidebar: DEFAULT_SIDEBAR });
    expect(parsed?.tabs.every((t) => t.file === undefined)).toBe(true);
  });

  it("v3RoundTrip", () => {
    const w: WorkspaceState = {
      tabs: [fileTab("f", "/a.txt"), newTabState("a")],
      activeId: "f",
      closed: [
        { tab: fileTab("g", "/b.txt", "missing"), index: 0, closedAt: 5 },
      ],
    };
    expect(parseSessionFile(JSON.stringify(toSessionFile(w)))).toEqual({
      version: 3,
      ...w,
      sidebar: DEFAULT_SIDEBAR,
    });
  });

  it("badFileFieldDropsOnlyThatEntry", () => {
    const parse = (file: unknown) =>
      parseSessionFile(
        JSON.stringify({
          version: 3,
          tabs: [
            { ...newTabState("f"), file },
            { ...newTabState("a"), title: "Keep", renamed: true },
          ],
          activeId: "a",
          closed: [],
        }),
      );
    expect(parse(fileInfo("p"))?.tabs).toHaveLength(2);
    const bads: unknown[] = [
      null,
      "p",
      { ...fileInfo("p"), path: 3 },
      { ...fileInfo("p"), held: "nope" },
      { ...fileInfo("p"), fingerprint: { size: 1 } },
      { ...fileInfo("p"), format: { encoding: "utf-8" } },
      {
        ...fileInfo("p"),
        format: { ...fileInfo("p").format, lineEnding: "cr" },
      },
    ];
    for (const bad of bads) {
      const r = parse(bad);
      expect(r?.tabs.map((t) => t.id)).toEqual(["a"]);
      expect(r?.tabs[0].title).toBe("Keep");
      expect(r?.activeId).toBe("a");
    }
  });

  it("badClosedEntryDropsOnlyThatEntry", () => {
    const good = { tab: newTabState("c"), index: 0, closedAt: 1 };
    const r = parseSessionFile(
      JSON.stringify({
        version: 3,
        tabs: [newTabState("a")],
        activeId: "a",
        closed: [
          { tab: { ...newTabState("x"), file: 5 }, index: 0, closedAt: 2 },
          good,
        ],
      }),
    );
    expect(r?.tabs).toHaveLength(1);
    expect(r?.closed).toEqual([good]);
  });

  it("top-level shape errors still return null", () => {
    const base = { version: 2, tabs: [], activeId: "", closed: [] };
    expect(parseSessionFile(JSON.stringify([]))).toBeNull();
    expect(parseSessionFile(JSON.stringify({ ...base, tabs: {} }))).toBeNull();
    expect(
      parseSessionFile(JSON.stringify({ ...base, closed: "x" })),
    ).toBeNull();
    expect(
      parseSessionFile(JSON.stringify({ ...base, version: 4 })),
    ).toBeNull();
  });
});

describe("session v3 migration and sidebar", () => {
  /** A Tab as v2 wrote it: no `kind`. */
  const v2Tab = (id: string, path?: string): Record<string, unknown> => {
    const t: Record<string, unknown> = {
      ...(path ? fileTab(id, path) : newTabState(id)),
    };
    delete t.kind;
    return t;
  };

  it("v2SessionMigratesToV3WithKinds", () => {
    const r = parseSessionFile(
      JSON.stringify({
        version: 2,
        tabs: [
          v2Tab("c", "C:/x/flow.excalidraw"),
          v2Tab("i", "C:/x/a.png"),
          v2Tab("f", "C:/x/a.md"),
          v2Tab("s"),
        ],
        activeId: "c",
        closed: [
          { tab: v2Tab("z", "C:/x/Z.EXCALIDRAW"), index: 0, closedAt: 1 },
        ],
      }),
    );
    expect(r?.version).toBe(3);
    expect(r?.tabs.map((t) => t.kind)).toEqual([
      "canvas",
      "image",
      "text",
      "text",
    ]);
    expect(r?.closed[0].tab.kind).toBe("canvas");
    expect(r?.sidebar).toEqual({ open: false, width: 240, expanded: [] });
  });

  it("v3RoundTripKeepsSidebarAndKinds", () => {
    const sidebar = { open: true, width: 300, expanded: ["a", "b/c"] };
    const w: WorkspaceState = {
      tabs: [newTabState("k", "canvas"), newTabState("a")],
      activeId: "k",
      closed: [],
    };
    expect(parseSessionFile(JSON.stringify(toSessionFile(w, sidebar)))).toEqual(
      { version: 3, ...w, sidebar },
    );
  });

  it("v3DropsATabWithAnUnknownKindAlone", () => {
    const r = parseSessionFile(
      JSON.stringify({
        ...toSessionFile(ws),
        tabs: [{ ...newTabState("x"), kind: "video" }, newTabState("a")],
      }),
    );
    expect(r?.tabs.map((t) => t.id)).toEqual(["a"]);
  });

  it("v3BadSidebarFallsBackToDefaults", () => {
    const r = parseSessionFile(
      JSON.stringify({ ...toSessionFile(ws), sidebar: { open: "yes" } }),
    );
    expect(r?.sidebar).toEqual(DEFAULT_SIDEBAR);
  });

  it("recoversAnOrphanCanvasScratchpadAsACanvasTab", () => {
    const { state } = restore(
      null,
      [{ id: "c1", ext: "excalidraw" }],
      fresh,
      0,
      [{ id: "c2", ext: "excalidraw", modifiedMs: 1 }],
    );
    expect(state.tabs.map((t) => [t.id, t.kind])).toEqual([["c1", "canvas"]]);
    expect(state.closed.map((e) => [e.tab.id, e.tab.kind])).toEqual([
      ["c2", "canvas"],
    ]);
  });
});

describe("purgeExpired with Files", () => {
  const old = 10 * CLOSED_TTL_MS;
  const entry = (tab: TabState): ClosedEntry => ({
    tab,
    index: 0,
    closedAt: 0,
  });

  it("closedFileNeverExpires", () => {
    const e = entry(fileTab("f", "p"));
    expect(purgeExpired([e], old)).toEqual({ kept: [e], expired: [] });
  });

  it("closedHeldFileExpiresAfter30Days", () => {
    const e = entry(fileTab("f", "p", "conflict"));
    expect(purgeExpired([e], old)).toEqual({ kept: [], expired: [e] });
    expect(purgeExpired([e], CLOSED_TTL_MS).kept).toEqual([e]);
  });
});

describe("restoreWorkspace with grantedPaths", () => {
  it("drops File Tabs and closed Files whose path is not granted", () => {
    const file = {
      version: 3 as const,
      sidebar: DEFAULT_SIDEBAR,
      tabs: [fileTab("f1", "ok"), fileTab("f2", "bad"), newTabState("a")],
      activeId: "f2",
      closed: [
        { tab: fileTab("f3", "bad"), index: 0, closedAt: 2 },
        { tab: fileTab("f4", "ok2"), index: 0, closedAt: 1 },
      ],
    };
    const { state } = restore(
      file,
      [],
      fresh,
      10,
      null,
      new Set(["ok", "ok2"]),
    );
    expect(state.tabs.map((t) => t.id)).toEqual(["f1", "a"]);
    expect(state.activeId).toBe("f1");
    expect(state.closed.map((e) => e.tab.id)).toEqual(["f4"]);
    // null means do not filter.
    expect(restore(file, [], fresh, 10).state.tabs).toHaveLength(3);
  });
});

describe("restoreWorkspace closed File dedupe", () => {
  it("keeps the newest closed entry per path key", () => {
    const file = {
      version: 3 as const,
      sidebar: DEFAULT_SIDEBAR,
      tabs: [newTabState("a")],
      activeId: "a",
      closed: [
        { tab: fileTab("old", "/P.txt"), index: 0, closedAt: 1 },
        { tab: fileTab("new", "/p.txt"), index: 0, closedAt: 5 },
        { tab: fileTab("other", "/q.txt"), index: 0, closedAt: 3 },
      ],
    };
    const lower = (p: string) => p.toLowerCase();
    const r = restore(file, [], fresh, 10, null, null, lower);
    const real = restore(file, [], fresh, 10, null, null, (p) =>
      pathKey(p, "windows"),
    );
    expect(real.state.closed.map((e) => e.tab.id)).toEqual(["new", "other"]);
    expect(r.state.closed.map((e) => e.tab.id)).toEqual(["new", "other"]);
    const exact = restore(file, [], fresh, 10);
    expect(exact.state.closed).toHaveLength(3);
  });
});

describe("restoreWorkspace closed Files and the closed/ folder", () => {
  it("keeps closed File entries, whose text never lives in closed/", () => {
    const file = toSessionFile({
      tabs: [newTabState("a")],
      activeId: "a",
      closed: [
        { tab: fileTab("f", "/p.txt"), index: 0, closedAt: 10 },
        { tab: newTabState("s"), index: 0, closedAt: 9 },
      ],
    });
    const { state } = restore(file, ["a"], fresh, 20, []);
    expect(state.closed.map((e) => e.tab.id)).toEqual(["f"]);
  });
});
