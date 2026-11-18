import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storage from "../storage/api";
import * as files from "../files/api";
import * as lib from "../library/api";
import type { Entry } from "../library/api";
import { useWorkspace } from "./useWorkspace";
import { newTabState } from "../model/workspace";
import { toSessionFile } from "../model/session";
import type {
  ClosedEntry,
  FileFormat,
  Fingerprint,
  SidebarState,
  TabState,
} from "../model/types";

const h = vi.hoisted(() => ({
  flushAll: null as null | (() => Promise<void>),
  libraryChanged: null as null | ((e: { dirs: string[] }) => void),
}));

vi.mock("./shortcuts", async (orig) => ({
  ...(await orig<typeof import("./shortcuts")>()),
  detectPlatform: () => "windows",
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
  pathKey: (await orig<typeof import("../files/api")>()).pathKey,
  fileRead: vi.fn(),
  fileRereadAs: vi.fn(),
  fileWrite: vi.fn(),
  fileSaveAs: vi.fn(),
  fileRename: vi.fn(),
  fileFingerprint: vi.fn(),
  fileFingerprintQuick: vi.fn(),
  filePickOpen: vi.fn(),
  filePickSave: vi.fn(),
  shadowWrite: vi.fn(),
  shadowRead: vi.fn(),
  shadowDelete: vi.fn(),
  shadowList: vi.fn(),
  fileWatch: vi.fn(),
  takeLaunchPaths: vi.fn(),
  grantsFilter: vi.fn(),
  onFileChanged: vi.fn(),
  onOpenPaths: vi.fn(),
}));

vi.mock("../library/api", () => ({
  libraryRoot: vi.fn(),
  libraryUseDefault: vi.fn(),
  libraryChoose: vi.fn(),
  libraryRecreate: vi.fn(),
  libraryList: vi.fn(),
  libraryCreateFolder: vi.fn(),
  libraryCreateFile: vi.fn(),
  libraryRename: vi.fn(),
  libraryMove: vi.fn(),
  libraryCopyInto: vi.fn(),
  libraryTrash: vi.fn(),
  libraryReveal: vi.fn(),
  librarySearch: vi.fn(),
  libraryWatch: vi.fn(),
  libraryReserve: vi.fn(),
  librarySetDropTarget: vi.fn(),
  libraryResync: vi.fn(),
  onLibraryChanged: vi.fn(),
  onLibraryDropped: vi.fn(),
  onDragDrop: vi.fn(),
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

const s = vi.mocked(storage);
const f = vi.mocked(files);
const l = vi.mocked(lib);

const FMT: FileFormat = {
  encoding: "utf-8",
  bom: false,
  lineEnding: "lf",
  mixed: false,
};
const fp = (hash: string): Fingerprint => ({ mtimeMs: 1, size: 1, hash });

const R = "C:\\L";
const PROJ = `${R}\\proj`;
const A = `${PROJ}\\a.md`;
const B = `${PROJ}\\b.md`;

const dir = (path: string): Entry => ({
  name: path.split("\\").pop()!,
  path,
  isDir: true,
  link: null,
});
const file = (path: string): Entry => ({ ...dir(path), isDir: false });

/** Folder listings Rust would return. */
let listings: Record<string, Entry[]>;
let disk: Record<string, { text: string; hash: string }>;
let scratch: Record<string, string>;
let writes = 0;

const fileTab = (id: string, path: string): TabState => ({
  ...newTabState(id),
  title: path.split("\\").pop()!,
  language: "markdown",
  languageGuessed: true,
  file: { path, format: FMT, fingerprint: fp("h1"), held: null },
});

const sessionJson = (
  tabs: TabState[],
  closed: ClosedEntry[] = [],
  sidebar?: SidebarState,
) =>
  JSON.stringify(
    toSessionFile({ tabs, activeId: tabs[0].id, closed }, sidebar),
  );

const OPEN: SidebarState = { open: true, width: 240, expanded: [PROJ] };

beforeEach(() => {
  vi.resetAllMocks();
  h.flushAll = null;
  h.libraryChanged = null;
  writes = 0;
  scratch = { a: "alpha" };
  disk = {
    [A]: { text: "a", hash: "h1" },
    [B]: { text: "b", hash: "h1" },
  };
  listings = {
    [R]: [dir(PROJ), dir(`${R}\\dest`), file(`${R}\\top.md`)],
    [PROJ]: [file(A), file(B)],
    [`${R}\\dest`]: [],
    [`${R}\\other`]: [],
  };
  s.listScratchpads.mockImplementation(async () =>
    Object.keys(scratch).map((id) => ({ id, ext: "txt" as const })),
  );
  s.listClosedScratchpads.mockResolvedValue([]);
  s.backupSession.mockResolvedValue(undefined);
  s.startupMark.mockResolvedValue(undefined);
  s.readSession.mockResolvedValue(null);
  s.readScratchpad.mockImplementation(async (id) => scratch[id] ?? "");
  s.writeScratchpad.mockImplementation(async (id, text) => {
    scratch[id] = text;
  });
  s.deleteScratchpad.mockImplementation(async (id) => {
    delete scratch[id];
  });
  s.closeScratchpad.mockResolvedValue(undefined);
  s.reopenScratchpad.mockResolvedValue(undefined);
  s.purgeClosed.mockResolvedValue(undefined);
  s.writeSession.mockResolvedValue(undefined);

  f.fileRead.mockImplementation(async (path) => {
    const d = disk[path];
    if (!d) throw { kind: "io", message: "not found" };
    return {
      text: d.text,
      format: FMT,
      readable: true,
      fingerprint: fp(d.hash),
    };
  });
  f.fileFingerprint.mockImplementation(async (path) =>
    disk[path] ? fp(disk[path].hash) : null,
  );
  f.fileFingerprintQuick.mockImplementation(async (path) =>
    disk[path] ? fp(disk[path].hash) : null,
  );
  f.fileWrite.mockImplementation(async (path, text, _fmt, expected) => {
    const d = disk[path];
    if (!d) return { kind: "missing" };
    if (d.hash !== expected.hash) {
      return { kind: "conflict", fingerprint: fp(d.hash) };
    }
    disk[path] = { text, hash: `w${++writes}` };
    return { kind: "written", fingerprint: fp(disk[path].hash) };
  });
  f.fileSaveAs.mockImplementation(async (path, text) => {
    disk[path] = { text, hash: `w${++writes}` };
    return { kind: "written", fingerprint: fp(disk[path].hash) };
  });
  f.shadowWrite.mockResolvedValue(undefined);
  f.shadowRead.mockResolvedValue(null);
  f.shadowDelete.mockResolvedValue(undefined);
  f.shadowList.mockResolvedValue([]);
  f.fileWatch.mockResolvedValue(undefined);
  f.takeLaunchPaths.mockResolvedValue({ paths: [], folders: [], missing: [] });
  f.grantsFilter.mockImplementation(async (paths) => paths);
  f.filePickOpen.mockResolvedValue([]);
  f.filePickSave.mockResolvedValue(null);
  f.onFileChanged.mockResolvedValue(() => {});
  f.onOpenPaths.mockResolvedValue(() => {});

  l.libraryRoot.mockResolvedValue({ root: R, available: true });
  l.libraryUseDefault.mockResolvedValue({ root: R, available: true });
  l.libraryWatch.mockResolvedValue(undefined);
  l.libraryResync.mockResolvedValue(false);
  l.librarySetDropTarget.mockResolvedValue(undefined);
  l.libraryList.mockImplementation(async (d) => {
    const entries = listings[d];
    if (!entries) throw { kind: "io", message: "gone" };
    return entries;
  });
  l.librarySearch.mockResolvedValue({ entries: [], ready: true });
  l.onLibraryChanged.mockImplementation(async (cb) => {
    h.libraryChanged = cb;
    return () => {};
  });
  l.onLibraryDropped.mockResolvedValue(() => {});
  l.onDragDrop.mockResolvedValue(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.useRealTimers();
  try {
    await h.flushAll?.();
  } catch {
    // Failed writes stay failed; the timers are cleared.
  }
  h.flushAll = null;
});

type Result = { current: ReturnType<typeof useWorkspace> };

/** Mounts with the sidebar open and the root and `proj` listed. */
async function mount(
  tabs?: TabState[],
  closed: ClosedEntry[] = [],
  sidebar: SidebarState = OPEN,
) {
  s.readSession.mockResolvedValue(
    sessionJson(tabs ?? [newTabState("a")], closed, sidebar),
  );
  const r = renderHook(() => useWorkspace());
  await waitFor(() => expect(r.result.current.ready).toBe(true));
  if (sidebar.open) {
    const shown = sidebar.expanded.includes(PROJ) ? A : PROJ;
    await waitFor(() =>
      expect(r.result.current.library.rows.map((x) => x.entry.path)).toContain(
        shown,
      ),
    );
  }
  return r;
}

const tabByPath = (r: Result, path: string) =>
  r.current.state.tabs.find((t) => t.file?.path === path);

/** Wait past the autosave (300 ms) and Session (500 ms) debounces. */
const settle = () => act(() => new Promise((res) => setTimeout(res, 600)));

/** The Session as last written. */
function lastSession() {
  const calls = s.writeSession.mock.calls;
  return JSON.parse(calls[calls.length - 1][0]) as ReturnType<
    typeof toSessionFile
  >;
}

const order = (fn: { mock: { invocationCallOrder: number[] } }, i = 0) =>
  fn.mock.invocationCallOrder[i];

describe("useLibrary", () => {
  it("openEntryOpensTabWithKind", async () => {
    const board = `${PROJ}\\board.excalidraw`;
    disk[board] = { text: "{}", hash: "h1" };
    const { result } = await mount();
    await act(() => result.current.library.open(file(board)));
    const tab = tabByPath(result, board);
    expect(tab?.kind).toBe("canvas");
    expect(result.current.state.activeId).toBe(tab?.id);
    expect(result.current.library.activePath).toBe(board);
    await act(() => result.current.library.open(file(A)));
    expect(tabByPath(result, A)?.kind).toBe("text");
  });

  it("createNoteOpensAndStartsRename", async () => {
    const created = `${PROJ}\\Untitled.md`;
    l.libraryCreateFile.mockImplementation(async () => {
      listings[PROJ] = [...listings[PROJ], file(created)];
      disk[created] = { text: "", hash: "h0" };
      return created;
    });
    const { result } = await mount(undefined, [], {
      ...OPEN,
      expanded: [],
    });
    let path: string | null = null;
    await act(async () => {
      path = await result.current.library.create(PROJ, "note");
    });
    expect(l.libraryCreateFile).toHaveBeenCalledWith(PROJ, "Untitled", "md");
    expect(path).toBe(created);
    // The listing the rename field waits for already holds the new item.
    expect(result.current.library.rows.map((x) => x.entry.path)).toContain(
      created,
    );
    expect(result.current.library.tree.expanded.has(PROJ)).toBe(true);
    const tab = tabByPath(result, created);
    expect(tab).toBeDefined();
    expect(result.current.state.activeId).toBe(tab!.id);
  });

  it("moveFolderWithDirtyOpenFileFlushesFirst", async () => {
    const moved = `${R}\\dest\\proj`;
    l.libraryMove.mockResolvedValue(moved);
    const { result } = await mount([fileTab("fa", A)]);
    expect(await result.current.loadContent("fa")).toBe("a");
    act(() => result.current.setContent("fa", "edited"));
    await act(() => result.current.library.move(PROJ, `${R}\\dest`));
    expect(l.libraryMove).toHaveBeenCalledWith(PROJ, `${R}\\dest`);
    expect(f.fileWrite).toHaveBeenCalledWith(A, "edited", FMT, fp("h1"));
    expect(order(f.fileWrite)).toBeLessThan(order(l.libraryMove));
    const tab = result.current.state.tabs.find((t) => t.id === "fa")!;
    expect(tab.file?.path).toBe(`${moved}\\a.md`);
    expect(tab.title).toBe("a.md");
  });

  it("moveRefusedWhenFlushFails", async () => {
    const { result } = await mount([fileTab("fa", A)]);
    expect(await result.current.loadContent("fa")).toBe("a");
    f.fileWrite.mockRejectedValue({ kind: "io", message: "disk full" });
    act(() => result.current.setContent("fa", "edited"));
    await act(() => result.current.library.move(PROJ, `${R}\\dest`));
    expect(l.libraryMove).not.toHaveBeenCalled();
    expect(result.current.notice).toMatch(/Can't move proj/);
    const tab = result.current.state.tabs.find((t) => t.id === "fa")!;
    expect(tab.file?.path).toBe(A);
  });

  it("renameFolderRewritesOpenAndClosedTabPaths", async () => {
    const work = `${R}\\work`;
    l.libraryRename.mockImplementation(async () => {
      listings[R] = [dir(work), dir(`${R}\\dest`), file(`${R}\\top.md`)];
      listings[work] = [file(`${work}\\a.md`), file(`${work}\\b.md`)];
      delete listings[PROJ];
      return work;
    });
    const closed: ClosedEntry = {
      tab: fileTab("fb", B),
      index: 1,
      closedAt: Date.now(),
    };
    const { result } = await mount([fileTab("fa", A)], [closed]);
    let err: string | null = "unset";
    await act(async () => {
      err = await result.current.library.rename(PROJ, "work");
    });
    expect(err).toBeNull();
    expect(l.libraryRename).toHaveBeenCalledWith(PROJ, "work");
    expect(result.current.state.tabs[0].file?.path).toBe(`${work}\\a.md`);
    expect(result.current.state.closed[0].tab.file?.path).toBe(`${work}\\b.md`);
    // The tree and the expanded folders follow.
    expect(result.current.library.tree.expanded.has(work)).toBe(true);
    expect(result.current.library.tree.expanded.has(PROJ)).toBe(false);
    expect(result.current.library.rows.map((x) => x.entry.path)).toContain(
      `${work}\\a.md`,
    );
    await settle();
    const saved = lastSession();
    expect(saved.tabs[0].file?.path).toBe(`${work}\\a.md`);
    expect(saved.closed[0].tab.file?.path).toBe(`${work}\\b.md`);
    expect(saved.sidebar.expanded).toEqual([work]);
  });

  it("renaming an open File keeps its extension and retitles the Tab", async () => {
    const renamed = `${PROJ}\\c.md`;
    l.libraryRename.mockResolvedValue(renamed);
    const { result } = await mount([fileTab("fa", A)]);
    await act(async () => {
      await result.current.library.rename(A, "c.md");
    });
    expect(l.libraryRename).toHaveBeenCalledWith(A, "c");
    const tab = result.current.state.tabs[0];
    expect(tab.file?.path).toBe(renamed);
    expect(tab.title).toBe("c.md");
  });

  it("a refused rename resolves to its message", async () => {
    l.libraryRename.mockRejectedValue({ kind: "exists", message: "" });
    const { result } = await mount();
    let err: string | null = null;
    await act(async () => {
      err = await result.current.library.rename(A, "b.md");
    });
    expect(err).toBe("b.md already exists");
  });

  it("inboxDragSavesWithSuggestedName", async () => {
    scratch = { a: "My: idea\nmore" };
    const reserved = `${PROJ}\\My idea.txt`;
    l.libraryReserve.mockResolvedValue(reserved);
    const { result } = await mount([
      { ...newTabState("a"), title: "My: idea" },
    ]);
    await waitFor(() =>
      expect(result.current.library.inbox).toEqual([
        { id: "a", title: "My: idea", kind: "text" },
      ]),
    );
    await act(() => result.current.library.inboxMove("a", PROJ));
    expect(l.libraryReserve).toHaveBeenCalledWith(PROJ, "My idea", "txt");
    expect(f.fileSaveAs).toHaveBeenCalledWith(
      reserved,
      "My: idea\nmore",
      expect.objectContaining({ encoding: "utf-8" }),
    );
    expect(f.filePickSave).not.toHaveBeenCalled();
    const tab = result.current.state.tabs.find((t) => t.id === "a")!;
    expect(tab.file?.path).toBe(reserved);
    expect(result.current.library.inbox).toEqual([]);
  });

  it("moveToLibraryUsesSaveDialogInRoot", async () => {
    const { result } = await mount([{ ...newTabState("a"), title: "alpha" }]);
    await act(() => result.current.library.inboxMove("a", null));
    expect(f.filePickSave).toHaveBeenCalledWith("alpha.txt", R);
  });

  it("libraryChangedReloadsOnlyLoadedDirs", async () => {
    const { result } = await mount();
    await waitFor(() => expect(h.libraryChanged).not.toBeNull());
    l.libraryList.mockClear();
    listings[PROJ] = [file(A), file(B), file(`${PROJ}\\new.md`)];
    await act(async () => {
      h.libraryChanged!({ dirs: [PROJ, `${R}\\other`] });
    });
    await waitFor(() =>
      expect(result.current.library.rows.map((x) => x.entry.path)).toContain(
        `${PROJ}\\new.md`,
      ),
    );
    expect(l.libraryList).toHaveBeenCalledTimes(1);
    expect(l.libraryList).toHaveBeenCalledWith(PROJ);
  });

  it("chooseRootReloadsTree", async () => {
    const R2 = "D:\\Other";
    listings[R2] = [file(`${R2}\\x.md`)];
    l.libraryChoose.mockResolvedValue({ root: R2, available: true });
    const { result } = await mount();
    expect(l.libraryWatch).toHaveBeenCalledTimes(1);
    await act(() => result.current.library.chooseRoot());
    await waitFor(() =>
      expect(result.current.library.rows.map((x) => x.entry.path)).toEqual([
        `${R2}\\x.md`,
      ]),
    );
    expect(result.current.library.root).toBe(R2);
    expect(l.libraryWatch).toHaveBeenCalledTimes(2);
    expect(result.current.library.tree.expanded.size).toBe(0);
  });

  it("trashRefusedShowsNotice", async () => {
    l.libraryTrash.mockRejectedValue({
      kind: "trash_unavailable",
      message: "no recycle bin",
    });
    const { result } = await mount();
    await act(() => result.current.library.trash(A));
    expect(l.libraryTrash).toHaveBeenCalledWith(A);
    expect(result.current.notice).toMatch(/Can't move a\.md to the Trash/);
  });
});

describe("sidebar state", () => {
  it("restores and saves the sidebar with the Session", async () => {
    const { result } = await mount(undefined, [], {
      open: true,
      width: 9999,
      expanded: [PROJ],
    });
    expect(result.current.sidebar).toEqual({
      open: true,
      width: 480,
      expanded: [PROJ],
    });
    act(() => result.current.setSidebarWidth(300));
    await settle();
    expect(lastSession().sidebar).toEqual({
      open: true,
      width: 300,
      expanded: [PROJ],
    });
  });

  it("first open creates the default root and starts watching once", async () => {
    l.libraryRoot.mockResolvedValue({ root: null, available: false });
    const { result } = await mount(undefined, [], {
      open: false,
      width: 240,
      expanded: [],
    });
    expect(l.libraryUseDefault).not.toHaveBeenCalled();
    act(() => result.current.toggleSidebar());
    await waitFor(() =>
      expect(result.current.library.rows.length).toBeGreaterThan(0),
    );
    expect(l.libraryUseDefault).toHaveBeenCalledTimes(1);
    act(() => result.current.toggleSidebar());
    act(() => result.current.toggleSidebar());
    await settle();
    expect(l.libraryWatch).toHaveBeenCalledTimes(1);
  });

  it("newCanvas opens a Canvas Scratchpad", async () => {
    const { result } = await mount();
    await act(() => result.current.run({ type: "newCanvas" }));
    const tab = result.current.state.tabs.find(
      (t) => t.id === result.current.state.activeId,
    )!;
    expect(tab.kind).toBe("canvas");
    expect(tab.file).toBeUndefined();
  });

  it("search debounces only the Rust call", async () => {
    const { result } = await mount();
    l.librarySearch.mockResolvedValue({ entries: [file(A)], ready: true });
    act(() => result.current.library.setQuery("a"));
    act(() => result.current.library.setQuery("a."));
    expect(result.current.library.search.query).toBe("a.");
    expect(result.current.library.searching).toBe(true);
    await waitFor(() =>
      expect(result.current.library.rows.map((x) => x.entry.path)).toEqual([
        PROJ,
        A,
      ]),
    );
    expect(l.librarySearch).toHaveBeenCalledTimes(1);
    expect(l.librarySearch).toHaveBeenCalledWith("a.");
  });
});
