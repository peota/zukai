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
  onOpenPaths: async () => () => {},
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: () => Promise.resolve(),
    setTitle: () => Promise.resolve(),
  }),
}));

/** Event listeners by name, so a test can play Rust's events. */
const listeners = new Map<string, ((e: { payload: unknown }) => void)[]>();
const fire = (name: string, payload: unknown) =>
  act(() => (listeners.get(name) ?? []).forEach((cb) => cb({ payload })));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: (name: string, cb: (e: { payload: unknown }) => void) => {
    listeners.set(name, [...(listeners.get(name) ?? []), cb]);
    return Promise.resolve(() => {
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter((c) => c !== cb),
      );
    });
  },
}));

vi.mock("./exit", () => ({
  BEFORE_EXIT_EVENT: "zukai://before-exit",
  installExitHandshake: async () => () => {},
}));

const m = vi.mocked(api);
const gitCalls = () => invoke.mock.calls.filter((c) => c[0].startsWith("git_"));

beforeEach(() => {
  vi.resetAllMocks();
  listeners.clear();
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

const LIB = "C:\\Lib";
const NOTE = "C:\\Lib\\note.md";
const WORK = "D:\\work";
const FMT = { encoding: "utf-8", bom: false, lineEnding: "lf", mixed: false };
const FP = { mtimeMs: 1, size: 2, hash: "h1" };

/** A restored session with git sync set as given. */
async function mountWith(gitSync: boolean) {
  m.readSession.mockResolvedValue(
    JSON.stringify({
      version: 3,
      tabs: [],
      activeId: "a",
      closed: [],
      settings: { gitSync },
    }),
  );
  const r = renderHook(() => useWorkspace());
  await waitFor(() => expect(r.result.current.ready).toBe(true));
  return r;
}

describe("useWorkspace Git view", () => {
  it("starts on Files", async () => {
    const r = await mountWith(true);
    expect(r.result.current.sidebarView).toBe("files");
    expect(r.result.current.sidebar.view).toBe("files");
    r.unmount();
  });

  it("turning git sync off while the Git view shows goes back to Files", async () => {
    const r = await mountWith(true);
    act(() => r.result.current.setSidebarView("git"));
    expect(r.result.current.sidebarView).toBe("git");
    act(() => r.result.current.setSettings({ gitSync: false }));
    await waitFor(() => expect(r.result.current.sidebarView).toBe("files"));
    r.unmount();
  });

  it("showGitFor opens the Git view on that folder", async () => {
    const r = await mountWith(true);
    act(() => r.result.current.showGitFor(WORK));
    expect(r.result.current.sidebarView).toBe("git");
    expect(r.result.current.sidebar.open).toBe(true);
    expect(r.result.current.gitFolder).toBe(WORK);
    expect(r.result.current.git.selected).toBe(WORK);
    r.unmount();
  });

  it("Mod+Shift+G toggles the Git view, opening the sidebar", async () => {
    const r = await mountWith(true);
    expect(r.result.current.sidebar.open).toBe(false);
    await act(() => r.result.current.run({ type: "toggleGitView" }));
    expect(r.result.current.sidebar.open).toBe(true);
    expect(r.result.current.sidebarView).toBe("git");
    await act(() => r.result.current.run({ type: "toggleGitView" }));
    expect(r.result.current.sidebarView).toBe("files");
    expect(r.result.current.sidebar.open).toBe(true);
    r.unmount();
  });

  it("the toggle does nothing with git sync off", async () => {
    const r = await mountWith(false);
    await act(() => r.result.current.run({ type: "toggleGitView" }));
    expect(r.result.current.sidebarView).toBe("files");
    expect(r.result.current.sidebar.open).toBe(false);
    r.unmount();
  });

  it("after a switch, an open file gone from the branch takes the gone-file path", async () => {
    let onDisk = true;
    invoke.mockImplementation((cmd: string, args?: { path?: string }) => {
      switch (cmd) {
        case "git_set_enabled":
          return Promise.resolve({ available: true });
        case "git_switch":
          // The branch has no note.md: git removes it.
          onDisk = false;
          return Promise.resolve();
        case "file_read":
          return args?.path === NOTE && onDisk
            ? Promise.resolve({
                text: "hi",
                format: FMT,
                readable: true,
                fingerprint: FP,
              })
            : Promise.reject({ kind: "io", message: "not found" });
        case "file_fingerprint":
        case "file_fingerprint_quick":
          return Promise.resolve(onDisk ? FP : null);
        case "file_watch":
        case "shadow_write":
        case "shadow_delete":
          return Promise.resolve();
        default:
          return Promise.reject(new Error(`no backend for ${cmd}`));
      }
    });
    const r = await mountWith(true);
    await waitFor(() =>
      expect(listeners.get("zukai://file-changed")?.length).toBeTruthy(),
    );
    await act(() => r.result.current.openPaths([NOTE]));
    const tab = () =>
      r.result.current.state.tabs.find((t) => t.file?.path === NOTE);
    expect(tab()?.file?.held).toBe(null);

    await act(() => r.result.current.git.switchBranch(LIB, "other", false));
    expect(invoke).toHaveBeenCalledWith("git_switch", {
      folder: LIB,
      branch: "other",
      fromRemote: false,
    });
    // What the watchers report after git removed the file.
    await fire("zukai://library-changed", { dirs: [LIB] });
    await fire("zukai://file-changed", { path: NOTE, kind: "removed" });
    await waitFor(() => expect(tab()?.file?.held).toBe("missing"));
    // No prompt and no write: the tab just shows the file is gone.
    expect(r.result.current.closePrompt).toBeNull();
    expect(invoke.mock.calls.some((c) => c[0] === "file_write")).toBe(false);
    r.unmount();
  });
});
