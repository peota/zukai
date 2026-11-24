import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../storage/api";
import { useWorkspace } from "./useWorkspace";

// Every Tauri command lands here and fails, as without a backend.
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

beforeEach(() => {
  vi.resetAllMocks();
  invoke.mockImplementation((cmd: string) =>
    cmd === "git_set_enabled"
      ? Promise.resolve({ available: true })
      : Promise.reject(new Error(`no backend for ${cmd}`)),
  );
  m.readSession.mockResolvedValue(null);
  m.listScratchpads.mockResolvedValue([{ id: "a", ext: "txt" }]);
  m.listClosedScratchpads.mockResolvedValue([]);
  m.backupSession.mockResolvedValue(undefined);
  m.startupMark.mockResolvedValue(undefined);
  m.readScratchpad.mockResolvedValue("");
  m.writeScratchpad.mockResolvedValue(undefined);
  m.writeSession.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const target = {
  folder: "C:\\L",
  path: "notes/a.md",
  status: "modified" as const,
};

async function withDiff() {
  const r = renderHook(() => useWorkspace());
  await waitFor(() => expect(r.result.current.ready).toBe(true));
  act(() => r.result.current.openDiff(target));
  const diff = r.result.current.state.tabs.find((t) => t.kind === "diff")!;
  return { r, diff };
}

describe("useWorkspace diff tabs", () => {
  it("openDiff opens one diff tab per file", async () => {
    const { r, diff } = await withDiff();
    expect(r.result.current.state.activeId).toBe(diff.id);
    expect(diff.title).toBe("a.md");
    act(() => r.result.current.activate("a"));
    act(() => r.result.current.openDiff(target));
    const tabs = r.result.current.state.tabs;
    expect(tabs.filter((t) => t.kind === "diff")).toHaveLength(1);
    expect(r.result.current.state.activeId).toBe(diff.id);
    r.unmount();
  });

  it("Scratchpads list excludes diff tabs", async () => {
    const { r } = await withDiff();
    expect(r.result.current.library.scratchpads.map((s) => s.id)).toEqual([
      "a",
    ]);
    r.unmount();
  });

  it("closing a diff tab never prompts and never enters Recently Closed", async () => {
    const { r, diff } = await withDiff();
    await act(async () => {
      await r.result.current.closeTab(diff.id);
    });
    expect(r.result.current.closePrompt).toBeNull();
    expect(r.result.current.state.tabs.map((t) => t.id)).toEqual(["a"]);
    expect(r.result.current.state.closed).toEqual([]);
    expect(m.closeScratchpad).not.toHaveBeenCalled();
    expect(m.deleteScratchpad).not.toHaveBeenCalled();
    expect(m.readScratchpad).not.toHaveBeenCalledWith(diff.id);
    r.unmount();
  });

  it("save and Save As do nothing for a diff tab", async () => {
    const { r, diff } = await withDiff();
    await act(async () => {
      await r.result.current.save(diff.id);
      await r.result.current.saveAs(diff.id);
    });
    expect(invoke.mock.calls.map((c) => c[0])).not.toContain("file_pick_save");
    expect(m.writeScratchpad).not.toHaveBeenCalled();
    expect(
      r.result.current.state.tabs.find((t) => t.id === diff.id)?.file,
    ).toBeUndefined();
    r.unmount();
  });
});
