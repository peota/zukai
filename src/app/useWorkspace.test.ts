import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../storage/api";
import { useWorkspace } from "./useWorkspace";

const h = vi.hoisted(() => ({
  flushAll: null as null | (() => Promise<void>),
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

// No File Tabs here: the files commands just answer "nothing".
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

vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));

vi.mock("./exit", () => ({
  BEFORE_EXIT_EVENT: "zukai://before-exit",
  installExitHandshake: async (flushAll: () => Promise<void>) => {
    h.flushAll = flushAll;
    return () => {};
  },
}));

const m = vi.mocked(api);
let disk: Record<string, string>;

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The Session as last written to session.json. */
function lastSession(): {
  tabs: { id: string }[];
  closed: { tab: { id: string } }[];
} {
  const calls = m.writeSession.mock.calls;
  return JSON.parse(calls[calls.length - 1][0]);
}

const order = (fn: { mock: { invocationCallOrder: number[] } }, i = 0) =>
  fn.mock.invocationCallOrder[i];

beforeEach(() => {
  vi.resetAllMocks();
  h.flushAll = null;
  disk = { a: "alpha", b: "" };
  m.listScratchpads.mockResolvedValue([
    { id: "a", ext: "txt" },
    { id: "b", ext: "txt" },
  ]);
  m.listClosedScratchpads.mockResolvedValue([]);
  m.backupSession.mockResolvedValue(undefined);
  m.startupMark.mockResolvedValue(undefined);
  m.readSession.mockResolvedValue(null);
  m.readScratchpad.mockImplementation(async (id) => disk[id] ?? "");
  m.writeScratchpad.mockImplementation(async (id, text) => {
    disk[id] = text;
  });
  m.deleteScratchpad.mockResolvedValue(undefined);
  m.closeScratchpad.mockResolvedValue(undefined);
  m.reopenScratchpad.mockResolvedValue(undefined);
  m.purgeClosed.mockResolvedValue(undefined);
  m.writeSession.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// Each hook owns a 300 ms debounced saver and shares the module-level
// sessionSaver. Timers armed by one test would otherwise fire during a later
// test, writing into that test's `disk` (and `writeSession` mock). Drain every
// saver (exit flushAll covers them all) before cleanup unmounts the hook.
afterEach(async () => {
  try {
    await h.flushAll?.();
  } catch {
    // A test that made writes fail leaves them failed; the timers are cleared.
  }
  h.flushAll = null;
});

/** Restore yields Tabs a ("alpha") and b (empty), with a active and loaded. */
async function mount() {
  const r = renderHook(() => useWorkspace());
  await waitFor(() => expect(r.result.current.ready).toBe(true));
  await waitFor(() => expect(m.readScratchpad).toHaveBeenCalledWith("a"));
  expect(await r.result.current.loadContent("a")).toBe("alpha");
  return r;
}

const tabIds = (r: { current: ReturnType<typeof useWorkspace> }) =>
  r.current.state.tabs.map((t) => t.id);

describe("useWorkspace close", () => {
  it("keeps the Tab open when the final write fails", async () => {
    const { result } = await mount();
    m.writeScratchpad.mockRejectedValue(new Error("disk full"));
    act(() => result.current.setContent("a", "alpha!"));
    await act(() => result.current.closeTab("a"));
    expect(tabIds(result)).toEqual(["a", "b"]);
    expect(m.closeScratchpad).not.toHaveBeenCalled();
    expect(m.deleteScratchpad).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe("error");
  });

  it("keeps the Tab open and resumes autosave when the move fails", async () => {
    const { result } = await mount();
    m.closeScratchpad.mockRejectedValueOnce(new Error("locked"));
    await act(() => result.current.closeTab("a"));
    expect(tabIds(result)).toEqual(["a", "b"]);
    act(() => result.current.setContent("a", "after"));
    await waitFor(() =>
      expect(m.writeScratchpad).toHaveBeenCalledWith("a", "after", "txt"),
    );
  });

  it("moves a non-empty Tab to Recently Closed and deletes an empty one", async () => {
    const { result } = await mount();
    await act(() => result.current.closeTab("a"));
    expect(m.closeScratchpad).toHaveBeenCalledWith("a");
    expect(result.current.state.closed.map((e) => e.tab.id)).toEqual(["a"]);

    await act(() => result.current.closeTab("b"));
    expect(m.deleteScratchpad).toHaveBeenCalledWith("b");
    expect(m.closeScratchpad).toHaveBeenCalledTimes(1);
    // The window is never empty.
    expect(result.current.state.tabs).toHaveLength(1);
    expect(tabIds(result)).not.toContain("b");
  });

  it("loads a never-loaded Tab before deciding how to close it", async () => {
    disk.b = "note";
    const { result } = await mount();
    expect(m.readScratchpad).not.toHaveBeenCalledWith("b");
    await act(() => result.current.closeTab("b"));
    const readB = m.readScratchpad.mock.calls.findIndex(([id]) => id === "b");
    expect(readB).toBeGreaterThanOrEqual(0);
    expect(m.readScratchpad.mock.invocationCallOrder[readB]).toBeLessThan(
      order(m.closeScratchpad),
    );
    expect(m.closeScratchpad).toHaveBeenCalledWith("b");
    expect(m.deleteScratchpad).not.toHaveBeenCalled();
  });

  it("writes text typed during the close before moving the file", async () => {
    const { result } = await mount();
    const gate = deferred();
    m.writeScratchpad.mockImplementationOnce(async (id, text) => {
      await gate.promise;
      disk[id] = text;
    });
    act(() => result.current.setContent("a", "one"));
    let closed!: Promise<void>;
    act(() => {
      closed = result.current.closeTab("a");
    });
    await waitFor(() =>
      expect(m.writeScratchpad).toHaveBeenCalledWith("a", "one", "txt"),
    );
    expect(result.current.isClosing("a")).toBe(true);
    act(() => result.current.setContent("a", "one two"));
    gate.resolve();
    await act(() => closed);

    expect(m.writeScratchpad).toHaveBeenLastCalledWith("a", "one two", "txt");
    expect(order(m.writeScratchpad, 1)).toBeLessThan(order(m.closeScratchpad));
    expect(disk.a).toBe("one two");
    expect(tabIds(result)).not.toContain("a");
    expect(result.current.isClosing("a")).toBe(false);
  });

  it("aborts the close when writing the late text fails", async () => {
    const { result } = await mount();
    const gate = deferred();
    m.writeScratchpad
      .mockImplementationOnce(async () => gate.promise)
      .mockRejectedValueOnce(new Error("disk full"));
    act(() => result.current.setContent("a", "one"));
    let closed!: Promise<void>;
    act(() => {
      closed = result.current.closeTab("a");
    });
    await waitFor(() => expect(m.writeScratchpad).toHaveBeenCalledTimes(1));
    act(() => result.current.setContent("a", "one two"));
    gate.resolve();
    await act(() => closed);
    expect(tabIds(result)).toContain("a");
    expect(m.closeScratchpad).not.toHaveBeenCalled();
    // Autosave picks the late text up again.
    await waitFor(() =>
      expect(m.writeScratchpad).toHaveBeenLastCalledWith("a", "one two", "txt"),
    );
  });
});

describe("useWorkspace reopen and session", () => {
  it("flushes the Session right after a reopen", async () => {
    const { result } = await mount();
    await act(() => result.current.closeTab("a"));
    m.writeSession.mockClear();
    await act(() => result.current.run({ type: "reopenTab" }));
    expect(m.reopenScratchpad).toHaveBeenCalledWith("a");
    // No 500 ms debounce wait: the write already happened.
    expect(m.writeSession).toHaveBeenCalled();
    expect(lastSession().tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(lastSession().closed).toEqual([]);
  });

  it("exit waits for an in-flight close before flushing", async () => {
    const { result } = await mount();
    const gate = deferred();
    m.closeScratchpad.mockImplementationOnce(() => gate.promise);
    let closed!: Promise<void>;
    act(() => {
      closed = result.current.closeTab("a");
    });
    await waitFor(() => expect(m.closeScratchpad).toHaveBeenCalled());

    expect(h.flushAll).not.toBeNull();
    let exited = false;
    const exit = h.flushAll!().then(() => {
      exited = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(exited).toBe(false);

    gate.resolve();
    await act(() => Promise.all([closed, exit]));
    expect(exited).toBe(true);
    expect(lastSession().tabs.map((t) => t.id)).toEqual(["b"]);
    expect(lastSession().closed.map((e) => e.tab.id)).toEqual(["a"]);
  });
});

describe("useWorkspace titles", () => {
  it("setContent updates the Title of an unrenamed Tab only", async () => {
    const { result } = await mount();
    act(() => result.current.setContent("a", "\n  hello world\nmore"));
    expect(result.current.state.tabs[0].title).toBe("hello world");

    await act(() => result.current.rename("a", "Named"));
    act(() => result.current.setContent("a", "something else"));
    expect(result.current.state.tabs[0].title).toBe("Named");
    expect(result.current.state.tabs[0].renamed).toBe(true);
  });
});

describe("useWorkspace find", () => {
  it("turns find and replace commands into a new find request each time", async () => {
    const { result } = await mount();
    expect(result.current.findRequest).toBeNull();
    await act(() => result.current.run({ type: "find" }));
    expect(result.current.findRequest).toEqual({ mode: "find", seq: 1 });
    await act(() => result.current.run({ type: "replace" }));
    expect(result.current.findRequest).toEqual({ mode: "replace", seq: 2 });
    await act(() => result.current.run({ type: "find" }));
    expect(result.current.findRequest).toEqual({ mode: "find", seq: 3 });
  });
});

describe("useWorkspace startup", () => {
  it("records restore and show in the startup log", async () => {
    await mount();
    await waitFor(() =>
      expect(m.startupMark.mock.calls.map(([e]) => e)).toEqual([
        "restored",
        "shown",
      ]),
    );
  });
});

describe("useWorkspace before restore", () => {
  it("ignores commands until the Session is restored", async () => {
    const gate = deferred();
    m.readSession.mockImplementation(() => gate.promise.then(() => null));
    const { result } = renderHook(() => useWorkspace());
    await act(() => result.current.run({ type: "newTab" }));
    await act(() => result.current.run({ type: "find" }));
    expect(result.current.state.tabs).toEqual([]);
    expect(result.current.findRequest).toBeNull();
    gate.resolve();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(tabIds(result)).toEqual(["a", "b"]);
  });
});
