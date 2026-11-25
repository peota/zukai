import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../storage/api";
import { useWorkspace } from "./useWorkspace";
import { nextScratchpadTitle } from "../model/workspace";
import type { CloseChoice } from "../ui/SaveChangesDialog";

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
  expect(await r.result.current.loadContent("a")).toBe(disk.a);
  return r;
}

const tabIds = (r: { current: ReturnType<typeof useWorkspace> }) =>
  r.current.state.tabs.map((t) => t.id);

/** Closes `id`, answering its "Save changes?" prompt with `choice`. */
async function closeAnswering(
  r: { current: ReturnType<typeof useWorkspace> },
  id: string,
  choice: CloseChoice = "discard",
) {
  let closed!: Promise<void>;
  act(() => {
    closed = r.current.closeTab(id);
  });
  await waitFor(() => expect(r.current.closePrompt).not.toBeNull());
  act(() => r.current.answerClosePrompt(choice));
  await act(() => closed);
}

describe("useWorkspace close", () => {
  it("keeps the Tab open when the final write fails", async () => {
    const { result } = await mount();
    m.writeScratchpad.mockRejectedValue(new Error("disk full"));
    act(() => result.current.setContent("a", "alpha!"));
    await closeAnswering(result, "a");
    expect(tabIds(result)).toEqual(["a", "b"]);
    expect(m.closeScratchpad).not.toHaveBeenCalled();
    expect(m.deleteScratchpad).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe("error");
  });

  it("keeps the Tab open and resumes autosave when the move fails", async () => {
    const { result } = await mount();
    // Pinned: it closes unasked, into Recently Closed.
    act(() => result.current.setPinned("a", true));
    m.closeScratchpad.mockRejectedValueOnce(new Error("locked"));
    await act(() => result.current.closeTab("a"));
    expect(tabIds(result)).toEqual(["a", "b"]);
    act(() => result.current.setContent("a", "after"));
    await waitFor(() =>
      expect(m.writeScratchpad).toHaveBeenCalledWith("a", "after", "txt"),
    );
  });

  it("asks before closing a non-empty Tab; Don't save deletes it for good", async () => {
    const { result } = await mount();
    let closed!: Promise<void>;
    act(() => {
      closed = result.current.closeTab("a");
    });
    await waitFor(() =>
      expect(result.current.closePrompt).toMatchObject({ id: "a" }),
    );
    act(() => result.current.answerClosePrompt("discard"));
    await act(() => closed);
    expect(m.deleteScratchpad).toHaveBeenCalledWith("a");
    expect(m.closeScratchpad).not.toHaveBeenCalled();
    expect(result.current.state.closed).toEqual([]);

    // An empty one closes unasked, deleted.
    await act(() => result.current.closeTab("b"));
    expect(result.current.closePrompt).toBeNull();
    expect(m.deleteScratchpad).toHaveBeenCalledWith("b");
    expect(m.closeScratchpad).not.toHaveBeenCalled();
    // The window is never empty.
    expect(result.current.state.tabs).toHaveLength(1);
    expect(tabIds(result)).not.toContain("b");
  });

  it("loads a never-loaded Tab before deciding how to close it", async () => {
    disk.b = "note";
    const { result } = await mount();
    expect(m.readScratchpad).not.toHaveBeenCalledWith("b");
    // Its text is known only once loaded: then it asks.
    await closeAnswering(result, "b");
    const readB = m.readScratchpad.mock.calls.findIndex(([id]) => id === "b");
    expect(readB).toBeGreaterThanOrEqual(0);
    expect(m.readScratchpad.mock.invocationCallOrder[readB]).toBeLessThan(
      order(m.deleteScratchpad),
    );
    expect(m.deleteScratchpad).toHaveBeenCalledWith("b");
  });

  it("Cancel keeps the Tab open and its text", async () => {
    const { result } = await mount();
    await closeAnswering(result, "a", "cancel");
    expect(tabIds(result)).toEqual(["a", "b"]);
    expect(result.current.closePrompt).toBeNull();
    expect(m.deleteScratchpad).not.toHaveBeenCalled();
    expect(m.closeScratchpad).not.toHaveBeenCalled();
    expect(disk.a).toBe("alpha");
  });

  it("a pinned or blank Tab closes unasked", async () => {
    const { result } = await mount();
    act(() => result.current.setPinned("a", true));
    await act(() => result.current.closeTab("a"));
    expect(result.current.closePrompt).toBeNull();
    expect(m.closeScratchpad).toHaveBeenCalledWith("a");

    act(() => result.current.setContent("b", "  \n"));
    await act(() => result.current.closeTab("b"));
    expect(result.current.closePrompt).toBeNull();
    expect(tabIds(result)).not.toContain("b");
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
    await waitFor(() => expect(result.current.closePrompt).not.toBeNull());
    act(() => result.current.answerClosePrompt("discard"));
    await waitFor(() =>
      expect(m.writeScratchpad).toHaveBeenCalledWith("a", "one", "txt"),
    );
    expect(result.current.isClosing("a")).toBe(true);
    act(() => result.current.setContent("a", "one two"));
    gate.resolve();
    await act(() => closed);

    expect(m.writeScratchpad).toHaveBeenLastCalledWith("a", "one two", "txt");
    expect(order(m.writeScratchpad, 1)).toBeLessThan(order(m.deleteScratchpad));
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
    await waitFor(() => expect(result.current.closePrompt).not.toBeNull());
    act(() => result.current.answerClosePrompt("discard"));
    await waitFor(() => expect(m.writeScratchpad).toHaveBeenCalledTimes(1));
    act(() => result.current.setContent("a", "one two"));
    gate.resolve();
    await act(() => closed);
    expect(tabIds(result)).toContain("a");
    expect(m.deleteScratchpad).not.toHaveBeenCalled();
    // Autosave picks the late text up again.
    await waitFor(() =>
      expect(m.writeScratchpad).toHaveBeenLastCalledWith("a", "one two", "txt"),
    );
  });
});

describe("useWorkspace reopen and session", () => {
  it("flushes the Session right after a reopen", async () => {
    const { result } = await mount();
    // Pinned: it closes unasked, into Recently Closed.
    act(() => result.current.setPinned("a", true));
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
    act(() => result.current.setPinned("a", true));
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
  it("a new Scratchpad is numbered, and typing never retitles it", async () => {
    const { result } = await mount();
    await act(() => result.current.run({ type: "newTab" }));
    const id = result.current.state.activeId;
    const tab = () => result.current.state.tabs.find((t) => t.id === id)!;
    const others = result.current.state.tabs.filter((t) => t.id !== id);
    const want = nextScratchpadTitle({ tabs: others });
    expect(tab().title).toBe(want);
    act(() => result.current.setContent(id, "\n  hello world\nmore"));
    expect(tab().title).toBe(want);

    await act(() => result.current.rename(id, "Named"));
    expect(tab().title).toBe("Named");
    expect(tab().renamed).toBe(true);
    // Clearing the name gives back a free number.
    await act(() => result.current.rename(id, ""));
    expect(tab().title).toBe(want);
    expect(tab().renamed).toBe(false);
  });

  it("a Canvas Scratchpad's Title never comes from its JSON", async () => {
    const { result } = await mount();
    await act(() => result.current.run({ type: "newCanvas" }));
    const id = result.current.state.activeId;
    const canvas = () => result.current.state.tabs.find((t) => t.id === id)!;
    expect(canvas().kind).toBe("canvas");
    act(() =>
      result.current.setContent(
        id,
        JSON.stringify({ type: "excalidraw", elements: [] }, null, 2),
      ),
    );
    expect(canvas().title).toBe("Untitled");
    await act(() => result.current.rename(id, "Flow"));
    expect(canvas().title).toBe("Flow");
    await act(() => result.current.rename(id, ""));
    expect(canvas().title).toBe("Untitled");
    // It is written as a canvas scratchpad.
    await act(() => h.flushAll!());
    expect(m.writeScratchpad).toHaveBeenCalledWith(
      id,
      expect.stringContaining("excalidraw"),
      "excalidraw",
    );
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

describe("useWorkspace editor zoom", () => {
  it("steps the font size on text Tabs, clamps it, and saves it", async () => {
    const { result } = await mount();
    expect(result.current.fontSize).toBe(14);
    await act(() => result.current.run({ type: "zoom", dir: 1 }));
    await act(() => result.current.run({ type: "zoom", dir: 1 }));
    expect(result.current.fontSize).toBe(16);
    await act(() => h.flushAll?.());
    const writes = m.writeSession.mock.calls;
    expect(JSON.parse(writes[writes.length - 1][0]).fontSize).toBe(16);
    await act(() => result.current.run({ type: "zoom", dir: 0 }));
    expect(result.current.fontSize).toBe(14);
    for (let i = 0; i < 20; i++) {
      await act(() => result.current.run({ type: "zoom", dir: -1 }));
    }
    expect(result.current.fontSize).toBe(8);
    act(() => result.current.zoomEditor(1));
    expect(result.current.fontSize).toBe(9);
  });

  it("leaves canvas and image zoom to their own Tabs", async () => {
    const { result } = await mount();
    await act(() => result.current.run({ type: "newCanvas" }));
    await act(() => result.current.run({ type: "zoom", dir: 1 }));
    expect(result.current.fontSize).toBe(14);
  });

  it("restores the saved font size", async () => {
    m.readSession.mockResolvedValue(
      JSON.stringify({
        version: 3,
        tabs: [],
        activeId: "a",
        closed: [],
        fontSize: 20,
      }),
    );
    const { result } = await mount();
    expect(result.current.fontSize).toBe(20);
  });
});

describe("useWorkspace pinned Tabs", () => {
  it("an empty pinned Scratchpad is kept on close and reopens pinned", async () => {
    const { result } = await mount();
    act(() => result.current.setPinned("b", true));
    expect(tabIds(result)).toEqual(["b", "a"]);
    await act(() => result.current.closeTab("b"));
    expect(m.deleteScratchpad).not.toHaveBeenCalled();
    expect(m.closeScratchpad).toHaveBeenCalledWith("b");
    expect(result.current.state.closed[0].tab).toMatchObject({
      id: "b",
      pinned: true,
    });
    await act(() => result.current.reopenEntry("b"));
    expect(tabIds(result)).toEqual(["b", "a"]);
    expect(result.current.state.tabs[0].pinned).toBe(true);
  });

  it("unpins a closed Tab without reopening it", async () => {
    const { result } = await mount();
    act(() => result.current.setPinned("a", true));
    await act(() => result.current.closeTab("a"));
    act(() => result.current.setPinned("a", false));
    expect(result.current.state.closed[0].tab.pinned).toBe(false);
    expect(tabIds(result)).toEqual(["b"]);
  });
});

describe("useWorkspace settings", () => {
  it("changes and saves settings, and restores them", async () => {
    const { result, unmount } = await mount();
    expect(result.current.settings).toEqual({
      theme: "system",
      lightTheme: "paper",
      darkTheme: "graphite",
      uiFontSize: 14,
      accent: "blue",
      wrapNewTabs: false,
      lineNumbers: true,
      autosaveFiles: false,
      gitSync: true,
      revealActiveFile: true,
      previewSplit: 0.5,
      markdownDefault: "rich",
      terminalPosition: "bottom",
      terminalHeight: 280,
      terminalWidth: 480,
      gitWidth: 320,
    });
    act(() =>
      result.current.setSettings({
        theme: "dark",
        darkTheme: "midnight",
        accent: "orange",
        lineNumbers: false,
      }),
    );
    expect(result.current.settings).toMatchObject({
      theme: "dark",
      lineNumbers: false,
    });
    await act(() => h.flushAll?.());
    const writes = m.writeSession.mock.calls;
    const saved = writes[writes.length - 1][0];
    expect(JSON.parse(saved).settings).toMatchObject({ theme: "dark" });
    unmount();
    m.readSession.mockResolvedValue(saved);
    const again = await mount();
    expect(again.result.current.settings).toMatchObject({
      theme: "dark",
      darkTheme: "midnight",
      accent: "orange",
    });
  });

  it("new Tabs start wrapped when the setting is on", async () => {
    const { result } = await mount();
    act(() => result.current.setSettings({ wrapNewTabs: true }));
    await act(() => result.current.run({ type: "newTab" }));
    const id = result.current.state.activeId;
    expect(result.current.state.tabs.find((t) => t.id === id)!.wrap).toBe(true);
  });

  it("setFontSize clamps the size", async () => {
    const { result } = await mount();
    act(() => result.current.setFontSize(99));
    expect(result.current.fontSize).toBe(40);
    act(() => result.current.setFontSize(15.4));
    expect(result.current.fontSize).toBe(15);
  });
});

describe("useWorkspace Markdown preview", () => {
  it("Mod+Shift+V cycles Edit, Split and Preview on a Markdown Tab only", async () => {
    const { result } = await mount();
    const preview = () =>
      result.current.state.tabs.find(
        (t) => t.id === result.current.state.activeId,
      )!.preview;
    // Plain text: nothing to preview.
    await act(() => result.current.run({ type: "togglePreview" }));
    expect(preview()).toBeUndefined();
    act(() =>
      result.current.updateTab("a", {
        language: "markdown",
        languagePicked: true,
        // The preview belongs to the Markdown source, not Rich.
        markdownMode: "markdown",
      }),
    );
    await act(() => result.current.run({ type: "togglePreview" }));
    expect(preview()).toBe("split");
    await act(() => result.current.run({ type: "togglePreview" }));
    expect(preview()).toBe("only");
    await act(() => result.current.run({ type: "togglePreview" }));
    expect(preview()).toBeUndefined();
    act(() => result.current.setPreview("a", "only"));
    expect(preview()).toBe("only");
  });
});

describe("useWorkspace Split", () => {
  const splits = (r: { current: ReturnType<typeof useWorkspace> }) =>
    r.current.state.splits ?? [];

  it("toggleSplitPairsWithThePreviousTab", async () => {
    const { result } = await mount();
    // One Tab active and no previous: nothing happens.
    await act(() => result.current.run({ type: "toggleSplit" }));
    expect(splits(result)).toEqual([]);
    act(() => result.current.activate("b"));
    act(() => result.current.activate("a"));
    await act(() => result.current.run({ type: "toggleSplit" }));
    expect(splits(result)).toMatchObject([{ a: "a", b: "b", focus: "a" }]);
    expect(result.current.state.activeId).toBe("a");
    await act(() => result.current.run({ type: "toggleSplit" }));
    expect(splits(result)).toEqual([]);
  });

  it("closingTheFocusedHalfLeavesTheOther", async () => {
    const { result } = await mount();
    act(() => result.current.splitWith("a", "b"));
    expect(result.current.state.activeId).toBe("a");
    await closeAnswering(result, "a");
    expect(splits(result)).toEqual([]);
    expect(result.current.state.activeId).toBe("b");
  });

  it("closingTheFocusedRightHalfLeavesTheLeft", async () => {
    const { result } = await mount();
    act(() => result.current.splitWith("a", "b"));
    act(() => result.current.activate("b"));
    expect(result.current.state.activeId).toBe("b");
    await act(() => result.current.closeTab("b"));
    expect(splits(result)).toEqual([]);
    expect(result.current.state.activeId).toBe("a");
  });

  it("toggleSplitAfterClosingTheActiveTabUsesTheEarlierTab", async () => {
    const { result } = await mount();
    // Tabs a, b; open c (lands after a), then close it: "previous" must not
    // be c, and the Tab shown after closing is b.
    await act(() => result.current.run({ type: "newTab" }));
    const c = result.current.state.activeId;
    expect(c).not.toBe("b");
    await act(() => result.current.closeTab(c));
    expect(result.current.state.activeId).toBe("b");
    await act(() => result.current.run({ type: "toggleSplit" }));
    expect(splits(result)).toMatchObject([{ a: "b", b: "a" }]);
  });

  it("movingFocusWithinASplitKeepsThePreviousTab", async () => {
    const { result } = await mount();
    await act(() => result.current.run({ type: "newTab" }));
    const c = result.current.state.activeId;
    act(() => result.current.splitWith("a", "b"));
    act(() => result.current.activate("a"));
    act(() => result.current.activate("b"));
    act(() => result.current.unsplit("b"));
    await act(() => result.current.run({ type: "toggleSplit" }));
    expect(splits(result)).toMatchObject([{ a: "b", b: c }]);
  });

  it("toggleSplitSkipsAPreviousTabInAnotherSplit", async () => {
    const { result } = await mount();
    await act(() => result.current.run({ type: "newTab" }));
    const c = result.current.state.activeId;
    act(() => result.current.splitWith("a", "b"));
    act(() => result.current.activate("a"));
    act(() => result.current.activate(c));
    await act(() => result.current.run({ type: "toggleSplit" }));
    expect(splits(result)).toMatchObject([{ a: "a", b: "b" }]);
    expect(splits(result)).toHaveLength(1);
  });

  it("closeSplitClosesBoth", async () => {
    const { result } = await mount();
    act(() => result.current.setContent("b", "beta"));
    act(() => result.current.splitWith("a", "b"));
    let closed!: Promise<void>;
    act(() => {
      closed = result.current.closeSplit("a");
    });
    // Each half asks in turn.
    for (const id of ["a", "b"]) {
      await waitFor(() =>
        expect(result.current.closePrompt).toMatchObject({ id }),
      );
      act(() => result.current.answerClosePrompt("discard"));
    }
    await act(() => closed);
    expect(m.deleteScratchpad).toHaveBeenCalledWith("a");
    expect(m.deleteScratchpad).toHaveBeenCalledWith("b");
    expect(tabIds(result)).not.toContain("a");
    expect(tabIds(result)).not.toContain("b");
    expect(splits(result)).toEqual([]);
  });

  it("splitsAreSaved", async () => {
    const { result } = await mount();
    act(() => result.current.splitWith("a", "b", "column"));
    await act(() => h.flushAll!());
    expect(
      (lastSession() as unknown as { splits: unknown[] }).splits,
    ).toMatchObject([{ a: "a", b: "b", orientation: "column" }]);
  });
});

describe("useWorkspace Rich / Markdown editor", () => {
  type R = { current: ReturnType<typeof useWorkspace> };
  const modeOf = (r: R, id = "a") =>
    r.current.state.tabs.find((t) => t.id === id)!.markdownMode;
  const bridgeFor = (r: R) => {
    const bridge = {
      text: () => null,
      replace: vi.fn(),
      onOutsideChange: () => () => {},
      clearHistory: vi.fn(),
      hidden: () => [],
      readOnly: () => false,
      ready: async () => {},
    };
    act(() => r.current.bridgeRef(bridge));
    return bridge;
  };
  /** Tab a becomes a Markdown note the user picked, shown in `mode`. */
  async function markdownTab(r: R, mode: "rich" | "markdown") {
    act(() =>
      r.current.updateTab("a", { language: "markdown", languagePicked: true }),
    );
    await waitFor(() => expect(modeOf(r)).toBeDefined());
    if (modeOf(r) !== mode)
      act(() => r.current.updateTab("a", { markdownMode: mode }));
  }
  const big = "x".repeat(1_048_577);

  it("first_show_writes_default_mode", async () => {
    const { result } = await mount();
    act(() =>
      result.current.updateTab("a", {
        language: "markdown",
        languagePicked: true,
      }),
    );
    await waitFor(() => expect(modeOf(result)).toBe("rich"));
    // b isn't shown yet; a guessed Scratchpad gets "markdown" once it is.
    act(() =>
      result.current.updateTab("b", {
        language: "markdown",
        languageGuessed: true,
      }),
    );
    expect(modeOf(result, "b")).toBeUndefined();
    act(() => result.current.activate("b"));
    await waitFor(() => expect(modeOf(result, "b")).toBe("markdown"));
    // The Settings default no longer changes a decided Tab.
    act(() => result.current.setSettings({ markdownDefault: "markdown" }));
    expect(modeOf(result)).toBe("rich");
  });

  it("first_show_of_a_too_large_note_is_markdown", async () => {
    disk.a = big;
    const { result } = await mount();
    act(() =>
      result.current.updateTab("a", {
        language: "markdown",
        languagePicked: true,
      }),
    );
    await waitFor(() => expect(modeOf(result)).toBe("markdown"));
    expect(result.current.notice).toBe("Too large for the rich editor");
  });

  it("toggle_refuses_rich_when_too_large", async () => {
    const { result } = await mount();
    await markdownTab(result, "markdown");
    act(() => result.current.setContent("a", big));
    await act(() => result.current.run({ type: "toggleRichMarkdown" }));
    expect(modeOf(result)).toBe("markdown");
    expect(result.current.notice).toBe("Too large for the rich editor");
  });

  it("toggle_to_markdown_clears_history", async () => {
    const { result } = await mount();
    const bridge = bridgeFor(result);
    await markdownTab(result, "rich");
    await act(() => result.current.run({ type: "toggleRichMarkdown" }));
    expect(modeOf(result)).toBe("markdown");
    expect(bridge.clearHistory).toHaveBeenCalledWith("a");
    await act(() => result.current.run({ type: "toggleRichMarkdown" }));
    expect(modeOf(result)).toBe("rich");
    expect(bridge.clearHistory).toHaveBeenCalledTimes(1);
    // Not a Markdown Tab: nothing to toggle.
    act(() => result.current.activate("b"));
    await act(() => result.current.run({ type: "toggleRichMarkdown" }));
    expect(modeOf(result, "b")).toBeUndefined();
  });

  it("find_on_rich_switches_to_markdown", async () => {
    const { result } = await mount();
    const bridge = bridgeFor(result);
    await markdownTab(result, "rich");
    await act(() => result.current.run({ type: "replace" }));
    expect(modeOf(result)).toBe("markdown");
    expect(bridge.clearHistory).toHaveBeenCalledWith("a");
    expect(result.current.findRequest).toEqual({ mode: "replace", seq: 1 });
  });

  it("fallback_shows_markdown_with_the_notice", async () => {
    const { result } = await mount();
    const bridge = bridgeFor(result);
    await markdownTab(result, "rich");
    act(() =>
      result.current.richFallback(
        "a",
        "This note uses Markdown the rich editor can't keep",
      ),
    );
    expect(modeOf(result)).toBe("markdown");
    expect(result.current.notice).toBe(
      "This note uses Markdown the rich editor can't keep",
    );
    // Rich never wrote: the plain editor keeps its undo.
    expect(bridge.clearHistory).not.toHaveBeenCalled();
  });

  it("language_back_to_markdown_reapplies_default", async () => {
    const { result } = await mount();
    await markdownTab(result, "markdown");
    act(() => result.current.updateTab("a", { language: "plaintext" }));
    act(() => result.current.updateTab("a", { language: "markdown" }));
    await waitFor(() => expect(modeOf(result)).toBe("rich"));
  });

  // Mode switches alone (no rich editor mounts here): the text and the disk
  // are untouched. An edit made in Rich then switched within the debounce
  // is covered in App.test.tsx, where the rich editor is mounted.
  it("switch_round_trip_without_an_edit_keeps_text", async () => {
    disk.a = "# Hi\n\n* a\n";
    const { result } = await mount();
    await markdownTab(result, "rich");
    await act(() => result.current.run({ type: "toggleRichMarkdown" }));
    await act(() => result.current.run({ type: "toggleRichMarkdown" }));
    expect(modeOf(result)).toBe("rich");
    expect(await result.current.loadContent("a")).toBe("# Hi\n\n* a\n");
    await act(() => h.flushAll!());
    expect(m.writeScratchpad).not.toHaveBeenCalled();
  });
});

describe("useWorkspace Rich / Markdown editor, fix round 1", () => {
  type R = { current: ReturnType<typeof useWorkspace> };
  const tabA = (r: R) => r.current.state.tabs.find((t) => t.id === "a")!;
  async function richTab(r: R) {
    act(() =>
      r.current.updateTab("a", { language: "markdown", languagePicked: true }),
    );
    await waitFor(() => expect(tabA(r).markdownMode).toBe("rich"));
  }

  it("ctrl_shift_v_does_nothing_in_rich", async () => {
    const { result } = await mount();
    await richTab(result);
    await act(() => result.current.run({ type: "togglePreview" }));
    expect(tabA(result).preview).toBeUndefined();
  });

  it("switch_to_rich_is_refused_up_front_for_an_unkeepable_note", async () => {
    disk.a = "See [the docs][1].\n\n[1]: https://example.com/docs\n";
    const { result } = await mount();
    await richTab(result);
    act(() => result.current.updateTab("a", { markdownMode: "markdown" }));
    await act(() => result.current.run({ type: "toggleRichMarkdown" }));
    expect(tabA(result).markdownMode).toBe("markdown");
    expect(result.current.notice).toBe(
      "This note uses Markdown the rich editor can't keep",
    );
  });
});
