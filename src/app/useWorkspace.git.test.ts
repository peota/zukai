import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../storage/api";
import { useWorkspace } from "./useWorkspace";

// Every Tauri command lands here: git ones are recorded, the rest fail as
// they do without a backend.
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
  Channel: class {},
}));

vi.mock("../storage/api", () => ({
  readScratchpad: vi.fn(),
  writeScratchpad: vi.fn(),
  deleteScratchpad: vi.fn(),
  closeScratchpad: vi.fn(),
  reopenScratchpad: vi.fn(),
  listScratchpads: vi.fn(),
  listClosedScratchpads: vi.fn(),
  purgeClosed: vi.fn(),
  readSession: vi.fn(),
  writeSession: vi.fn(),
  backupSession: vi.fn(),
  startupMark: vi.fn(),
}));

vi.mock("../files/api", async (orig) => ({
  ...(await orig<typeof import("../files/api")>()),
  shadowList: async () => [],
  fileWatch: async () => {},
  takeLaunchPaths: async () => ({ paths: [], folders: [], missing: [] }),
  grantsFilter: async (paths: string[]) => paths,
  onFileChanged: async () => () => {},
  onOpenPaths: async () => () => {},
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: () => Promise.resolve(),
    setTitle: () => Promise.resolve(),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("./exit", () => ({
  BEFORE_EXIT_EVENT: "zukai://before-exit",
  installExitHandshake: async () => () => {},
}));

const m = vi.mocked(api);
const gitCalls = () => invoke.mock.calls.filter((c) => c[0].startsWith("git_"));

beforeEach(() => {
  vi.resetAllMocks();
  invoke.mockImplementation((cmd: string) =>
    cmd === "git_set_enabled"
      ? Promise.resolve({ available: true })
      : Promise.reject(new Error(`no backend for ${cmd}`)),
  );
  m.listScratchpads.mockResolvedValue([{ id: "a", ext: "txt" }]);
  m.listClosedScratchpads.mockResolvedValue([]);
  m.backupSession.mockResolvedValue(undefined);
  m.startupMark.mockResolvedValue(undefined);
  m.readScratchpad.mockResolvedValue("");
  m.writeScratchpad.mockResolvedValue(undefined);
  m.writeSession.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("useWorkspace git sync", () => {
  it("sends nothing to git before the session restores, then only off", async () => {
    let restore!: (json: string) => void;
    m.readSession.mockReturnValue(
      new Promise<string | null>((res) => {
        restore = res;
      }),
    );
    const r = renderHook(() => useWorkspace());
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((res) => setTimeout(res, 50));
    });
    expect(r.result.current.ready).toBe(false);
    expect(gitCalls()).toEqual([]);

    await act(async () => {
      restore(
        JSON.stringify({
          version: 3,
          tabs: [],
          activeId: "a",
          closed: [],
          settings: { gitSync: false },
        }),
      );
    });
    await waitFor(() => expect(r.result.current.ready).toBe(true));
    expect(r.result.current.settings.gitSync).toBe(false);
    await waitFor(() => expect(gitCalls().length).toBeGreaterThan(0));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((res) => setTimeout(res, 50));
    });
    expect(gitCalls()).toEqual([["git_set_enabled", { enabled: false }]]);
    r.unmount();
  });
});
