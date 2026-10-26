import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../storage/api";
import { restoreSession } from "./workspaceEffects";
import { toSessionFile } from "../model/session";
import { newTabState } from "../model/workspace";

vi.mock("../storage/api", () => ({
  listScratchpads: vi.fn(),
  listClosedScratchpads: vi.fn(),
  readSession: vi.fn(),
  backupSession: vi.fn(),
  reopenScratchpad: vi.fn(),
  purgeClosed: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({}) }));
vi.mock("./exit", () => ({ installExitHandshake: vi.fn() }));

const m = vi.mocked(api);
let n = 0;
const fresh = () => `fresh${++n}`;

const session = (tabIds: string[], closedIds: string[] = []) =>
  JSON.stringify(
    toSessionFile({
      tabs: tabIds.map(newTabState),
      activeId: tabIds[0] ?? "",
      closed: closedIds.map((id) => ({
        tab: newTabState(id),
        index: 0,
        closedAt: Date.now(),
      })),
    }),
  );

beforeEach(() => {
  vi.resetAllMocks();
  n = 0;
  m.listScratchpads.mockResolvedValue([]);
  m.listClosedScratchpads.mockResolvedValue([]);
  m.readSession.mockResolvedValue(null);
  m.backupSession.mockResolvedValue(undefined);
  m.reopenScratchpad.mockResolvedValue(undefined);
  m.purgeClosed.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("restoreSession", () => {
  it("moves an open Tab's file back from closed/ before loading", async () => {
    // Crash between closeScratchpad and the session write.
    m.readSession.mockResolvedValue(session(["a", "b"]));
    m.listScratchpads.mockResolvedValue(["b"]);
    m.listClosedScratchpads.mockResolvedValue([
      { id: "a", modifiedMs: Date.now() },
    ]);
    const state = await restoreSession(fresh);
    expect(m.reopenScratchpad).toHaveBeenCalledWith("a");
    expect(state.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(state.closed).toEqual([]);
  });

  it("does not move back a file that the Session lists as closed", async () => {
    m.readSession.mockResolvedValue(session(["b"], ["a"]));
    m.listScratchpads.mockResolvedValue(["b"]);
    m.listClosedScratchpads.mockResolvedValue([
      { id: "a", modifiedMs: Date.now() },
    ]);
    const state = await restoreSession(fresh);
    expect(m.reopenScratchpad).not.toHaveBeenCalled();
    expect(state.closed.map((e) => e.tab.id)).toEqual(["a"]);
  });

  it("makes stranded closed files reachable when session.json is corrupt", async () => {
    m.readSession.mockResolvedValue("{corrupt");
    m.listScratchpads.mockResolvedValue(["b"]);
    m.listClosedScratchpads.mockResolvedValue([
      { id: "x", modifiedMs: Date.now() - 10 },
    ]);
    const state = await restoreSession(fresh);
    expect(state.tabs.map((t) => t.id)).toEqual(["b"]);
    expect(state.closed.map((e) => e.tab.id)).toEqual(["x"]);
  });

  it("backs up a session.json that exists but cannot be parsed", async () => {
    m.readSession.mockResolvedValue('{"version":99}');
    await restoreSession(fresh);
    expect(m.backupSession).toHaveBeenCalledTimes(1);
  });

  it("backs up a session.json that cannot be read", async () => {
    m.readSession.mockRejectedValue(new Error("EACCES"));
    await restoreSession(fresh);
    expect(m.backupSession).toHaveBeenCalledTimes(1);
  });

  it("does not back up a good or missing session.json", async () => {
    await restoreSession(fresh);
    m.readSession.mockResolvedValue(session(["a"]));
    m.listScratchpads.mockResolvedValue(["a"]);
    await restoreSession(fresh);
    expect(m.backupSession).not.toHaveBeenCalled();
  });

  it("keeps old closed files found only on disk instead of purging them", async () => {
    m.listClosedScratchpads.mockResolvedValue([
      { id: "old", modifiedMs: Date.now() - 31 * 24 * 60 * 60 * 1000 },
    ]);
    const state = await restoreSession(fresh);
    expect(m.purgeClosed).not.toHaveBeenCalled();
    expect(state.closed.map((e) => e.tab.id)).toEqual(["old"]);
  });

  it("keeps the Session's closed list when closed/ cannot be listed", async () => {
    m.readSession.mockResolvedValue(session(["b"], ["a"]));
    m.listScratchpads.mockResolvedValue(["b"]);
    m.listClosedScratchpads.mockRejectedValue(new Error("io"));
    const state = await restoreSession(fresh);
    expect(state.closed.map((e) => e.tab.id)).toEqual(["a"]);
  });
});
