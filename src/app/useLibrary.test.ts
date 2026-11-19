import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storage from "../storage/api";
import * as files from "../files/api";
import * as lib from "../library/api";
import type { Entry, RootState } from "../library/api";
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
  libraryAddFolder: vi.fn(),
  libraryLocateFolder: vi.fn(),
  libraryRemoveFolder: vi.fn(),
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
  libraryResolve: vi.fn(),
  libraryFollow: vi.fn(),
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

  l.libraryRoot.mockResolvedValue({ root: R, available: true, added: [] });
  l.libraryUseDefault.mockResolvedValue({
    root: R,
    available: true,
    added: [],
  });
  l.libraryWatch.mockResolvedValue(undefined);
  l.libraryResync.mockResolvedValue(false);
  l.librarySetDropTarget.mockResolvedValue(undefined);
  l.libraryList.mockImplementation(async (d) => {
    const entries = listings[d];
    if (!entries) throw { kind: "io", message: "gone" };
    return entries;
  });
  l.librarySearch.mockResolvedValue({ entries: [], ready: true });
  // Rust: each path under `from` now lives under `to` (granted as is).
  l.libraryFollow.mockImplementation(async (from, to, paths) =>
    paths.map((p) =>
      p === from || p.startsWith(`${from}\\`)
        ? to + p.slice(from.length)
        : null,
    ),
  );
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
  // These tests are about autosaving Files.
  act(() => r.result.current.setSettings({ autosaveFiles: true }));
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

  it("openingAnInsideLinkOpensItsTarget", async () => {
    const link: Entry = { ...file(`${PROJ}\\link.md`), link: "inside" };
    l.libraryResolve.mockResolvedValue(A);
    const { result } = await mount();
    await act(() => result.current.library.open(link));
    expect(l.libraryResolve).toHaveBeenCalledWith(link.path);
    expect(f.fileRead).toHaveBeenCalledWith(A);
    expect(f.fileRead).not.toHaveBeenCalledWith(link.path);
    const tab = tabByPath(result, A);
    expect(tab).toBeDefined();
    expect(tabByPath(result, link.path)).toBeUndefined();
    // Opening the target, or the link again, reuses that Tab.
    await act(() => result.current.library.open(file(A)));
    await act(() => result.current.library.open(link));
    expect(
      result.current.state.tabs.filter((t) => t.file?.path === A),
    ).toHaveLength(1);
    expect(result.current.state.activeId).toBe(tab?.id);
    // Plain files aren't resolved.
    expect(l.libraryResolve).toHaveBeenCalledTimes(2);
  });

  it("createFileOpensAndStartsRename", async () => {
    const created = `${PROJ}\\Untitled`;
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
      path = await result.current.library.create(PROJ, "file");
    });
    // No extension, like a new document in Notepad++: plain text until
    // it's named or given a Language.
    expect(l.libraryCreateFile).toHaveBeenCalledWith(PROJ, "Untitled", "");
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

  it("Missing and closed Files whose folder is gone follow a parent rename", async () => {
    const work = `${R}\\work`;
    const gone = `${PROJ}\\old\\x.md`;
    const elsewhere = `${PROJ}\\odd\\y.md`;
    l.libraryRename.mockResolvedValue(work);
    // Rust confirms (and grants) every path but one.
    l.libraryFollow.mockImplementation(async (from, to, paths) =>
      paths.map((p) => (p === elsewhere ? null : to + p.slice(from.length))),
    );
    const missing: TabState = {
      ...fileTab("fm", gone),
      file: { ...fileTab("fm", gone).file!, held: "missing" },
    };
    const closed: ClosedEntry[] = [
      {
        tab: fileTab("fc", `${PROJ}\\old\\z.md`),
        index: 1,
        closedAt: Date.now(),
      },
      { tab: fileTab("fe", elsewhere), index: 1, closedAt: Date.now() - 1 },
    ];
    const { result } = await mount([missing], closed);
    await act(async () => {
      await result.current.library.rename(PROJ, "work");
    });
    expect(l.libraryFollow).toHaveBeenCalledWith(PROJ, work, [
      gone,
      `${PROJ}\\old\\z.md`,
      elsewhere,
    ]);
    const tab = result.current.state.tabs[0];
    expect(tab.file).toMatchObject({
      path: `${work}\\old\\x.md`,
      held: "missing",
    });
    expect(result.current.state.closed.map((e) => e.tab.file?.path)).toEqual([
      `${work}\\old\\z.md`,
      elsewhere,
    ]);
    await settle();
    const saved = lastSession();
    expect(saved.tabs[0].file?.path).toBe(`${work}\\old\\x.md`);
    expect(saved.closed.map((e) => e.tab.file?.path)).toEqual([
      `${work}\\old\\z.md`,
      elsewhere,
    ]);
  });

  it("trashFolderWithOpenFileMarksMissingAtOnce", async () => {
    l.libraryTrash.mockImplementation(async () => {
      delete disk[A];
      delete disk[B];
    });
    const { result } = await mount([fileTab("fa", A)]);
    expect(await result.current.loadContent("fa")).toBe("a");
    act(() => result.current.setContent("fa", "edited"));
    await act(() => result.current.library.trash(PROJ));
    // Flushed first, then checked at once: no watcher event needed.
    expect(order(f.fileWrite)).toBeLessThan(order(l.libraryTrash));
    const tab = result.current.state.tabs.find((t) => t.id === "fa")!;
    expect(tab.file?.held).toBe("missing");
    expect(tab.file?.path).toBe(A);
    expect(await result.current.loadContent("fa")).toBe("edited");
    await settle();
    expect(f.shadowWrite).toHaveBeenCalledWith("fa", "edited");
    // The flushed write cleared an old shadow; nothing deletes the new one.
    for (const n of f.shadowDelete.mock.invocationCallOrder) {
      expect(n).toBeLessThan(order(l.libraryTrash));
    }
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

  it("naming a new extensionless file gives it that extension and its Language", async () => {
    const plain = `${PROJ}\\Untitled`;
    const renamed = `${PROJ}\\plan.ts`;
    l.libraryRename.mockResolvedValue(renamed);
    const { result } = await mount([
      { ...fileTab("fu", plain), language: "plaintext" },
    ]);
    await act(async () => {
      await result.current.library.rename(plain, "plan.ts");
    });
    expect(l.libraryRename).toHaveBeenCalledWith(plain, "plan.ts");
    const tab = result.current.state.tabs[0];
    expect(tab.file?.path).toBe(renamed);
    expect(tab.title).toBe("plan.ts");
    expect(tab.language).toBe("typescript");
  });

  it("a text file can't be renamed into a drawing or an image", async () => {
    const plain = `${PROJ}\\Untitled`;
    const { result } = await mount([
      { ...fileTab("fu", plain), language: "plaintext" },
    ]);
    for (const name of ["flow.excalidraw", "pic.png"]) {
      let err: string | null = null;
      await act(async () => {
        err = await result.current.library.rename(plain, name);
      });
      expect(err).toBe(`A text file can't become ${name}`);
    }
    expect(l.libraryRename).not.toHaveBeenCalled();
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

  it("scratchpadDragSavesWithSuggestedName", async () => {
    scratch = { a: "My: idea\nmore" };
    const reserved = `${PROJ}\\My idea.txt`;
    l.libraryReserve.mockResolvedValue(reserved);
    const { result } = await mount([
      { ...newTabState("a"), title: "My: idea" },
    ]);
    await waitFor(() =>
      expect(result.current.library.scratchpads).toEqual([
        { id: "a", title: "My: idea", kind: "text" },
      ]),
    );
    await act(() => result.current.library.scratchpadMove("a", PROJ));
    expect(l.libraryReserve).toHaveBeenCalledWith(PROJ, "My idea", "txt");
    expect(f.fileSaveAs).toHaveBeenCalledWith(
      reserved,
      "My: idea\nmore",
      expect.objectContaining({ encoding: "utf-8" }),
    );
    expect(f.filePickSave).not.toHaveBeenCalled();
    const tab = result.current.state.tabs.find((t) => t.id === "a")!;
    expect(tab.file?.path).toBe(reserved);
    expect(result.current.library.scratchpads).toEqual([]);
  });

  it("moveToLibraryUsesSaveDialogInRoot", async () => {
    const { result } = await mount([{ ...newTabState("a"), title: "alpha" }]);
    await act(() => result.current.library.scratchpadMove("a", null));
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
    l.libraryChoose.mockResolvedValue({ root: R2, available: true, added: [] });
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

  it("add_folder_appends_and_expands", async () => {
    const X = "D:\\Work";
    listings[X] = [file(`${X}\\n.md`)];
    l.libraryAddFolder.mockResolvedValue({
      root: R,
      available: true,
      added: [{ path: X, available: true }],
    });
    const { result } = await mount();
    l.libraryWatch.mockClear();
    await act(() => result.current.library.addFolder());
    expect(result.current.library.added).toEqual([
      { path: X, available: true },
    ]);
    expect(result.current.library.tree.expanded.has(X)).toBe(true);
    await waitFor(() =>
      expect(result.current.library.rows.map((x) => x.entry.path)).toContain(
        `${X}\\n.md`,
      ),
    );
    const rows = result.current.library.rows;
    const at = rows.findIndex((x) => x.entry.path === X);
    expect(rows[at].heading).toEqual({ available: true });
    expect(at).toBeGreaterThan(
      rows.findIndex((x) => x.entry.path === `${R}\\top.md`),
    );
    expect(rows[at + 1]).toMatchObject({ depth: 1 });
    // The watchers and indexes sync with the new list.
    expect(l.libraryWatch).toHaveBeenCalledTimes(1);
    // A refusal shows Rust's message as is.
    const msg = "That folder is already in your Library.";
    l.libraryAddFolder.mockRejectedValue({ kind: "io", message: msg });
    await act(() => result.current.library.addFolder());
    expect(result.current.notice).toBe(msg);
    expect(result.current.library.added).toHaveLength(1);
  });

  it("cross_root_drop_copies", async () => {
    const X = "D:\\Work";
    listings[X] = [];
    l.libraryRoot.mockResolvedValue({
      root: R,
      available: true,
      added: [{ path: X, available: true }],
    });
    l.libraryCopyInto.mockImplementation(async () => {
      listings[X] = [file(`${X}\\a.md`)];
      return [{ path: `${X}\\a.md`, error: null }];
    });
    const { result } = await mount(undefined, [], {
      ...OPEN,
      expanded: [PROJ, X],
    });
    await act(() => result.current.library.move(A, X));
    expect(l.libraryCopyInto).toHaveBeenCalledWith([A], X);
    expect(l.libraryMove).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(result.current.library.rows.map((x) => x.entry.path)).toContain(
        `${X}\\a.md`,
      ),
    );
    // The source stays.
    expect(result.current.library.rows.map((x) => x.entry.path)).toContain(A);
    // Within one tree it still moves.
    l.libraryMove.mockResolvedValue(`${R}\\dest\\a.md`);
    await act(() => result.current.library.move(A, `${R}\\dest`));
    expect(l.libraryMove).toHaveBeenCalledWith(A, `${R}\\dest`);
    expect(l.libraryCopyInto).toHaveBeenCalledTimes(1);
  });

  it("remove_passes_open_paths", async () => {
    const X = "D:\\Work";
    const XF = `${X}\\n.md`;
    disk[XF] = { text: "n", hash: "h1" };
    listings[X] = [file(XF)];
    l.libraryRoot.mockResolvedValue({
      root: R,
      available: true,
      added: [{ path: X, available: true }],
    });
    l.libraryRemoveFolder.mockResolvedValue({
      root: R,
      available: true,
      added: [],
    });
    const closed: ClosedEntry = {
      tab: fileTab("fb", B),
      index: 1,
      closedAt: Date.now(),
    };
    const { result } = await mount(
      [fileTab("fa", A), fileTab("fx", XF)],
      [closed],
      { ...OPEN, expanded: [PROJ, X] },
    );
    await waitFor(() =>
      expect(result.current.library.rows.map((x) => x.entry.path)).toContain(
        XF,
      ),
    );
    await act(() => result.current.library.removeFolder(X));
    expect(l.libraryRemoveFolder).toHaveBeenCalledWith(X, [A, XF, B]);
    expect(result.current.library.added).toEqual([]);
    const paths = result.current.library.rows.map((x) => x.entry.path);
    expect(paths).not.toContain(X);
    expect(paths).not.toContain(XF);
    // Its open Tab stays open.
    expect(tabByPath(result, XF)).toBeDefined();
  });

  it("locate_follows_open_tabs", async () => {
    const OLD = "D:\\Work";
    const NEW = "E:\\Work";
    const gone = `${OLD}\\n.md`;
    disk[`${NEW}\\n.md`] = { text: "n", hash: "h1" };
    listings[NEW] = [file(`${NEW}\\n.md`)];
    l.libraryRoot.mockResolvedValue({
      root: R,
      available: true,
      added: [{ path: OLD, available: false }],
    });
    l.libraryLocateFolder.mockResolvedValue({
      root: R,
      available: true,
      added: [{ path: NEW, available: true }],
    });
    const missing: TabState = {
      ...fileTab("fm", gone),
      file: { ...fileTab("fm", gone).file!, held: "missing" },
    };
    const { result } = await mount([fileTab("fa", A), missing]);
    await act(() => result.current.library.locateFolder(OLD));
    expect(l.libraryLocateFolder).toHaveBeenCalledWith(OLD);
    expect(l.libraryFollow).toHaveBeenCalledWith(OLD, NEW, [gone]);
    expect(result.current.state.tabs[1].file?.path).toBe(`${NEW}\\n.md`);
    expect(result.current.library.added).toEqual([
      { path: NEW, available: true },
    ]);
    await waitFor(() =>
      expect(result.current.library.rows.map((x) => x.entry.path)).toContain(
        `${NEW}\\n.md`,
      ),
    );
    // A refusal shows Rust's message as is.
    const msg = "That folder contains your Library.";
    l.libraryLocateFolder.mockRejectedValue({ kind: "io", message: msg });
    await act(() => result.current.library.locateFolder(NEW));
    expect(result.current.notice).toBe(msg);
  });

  it("choose_root_notices_removed_folders", async () => {
    const R2 = "D:\\Other";
    listings[R2] = [file(`${R2}\\x.md`)];
    l.libraryRoot.mockResolvedValue({
      root: R,
      available: true,
      added: [{ path: `${R2}\\proj`, available: true }],
    });
    l.libraryChoose.mockResolvedValue({
      root: R2,
      available: true,
      added: [],
      removed: ["proj"],
    });
    const closed: ClosedEntry = {
      tab: fileTab("fb", B),
      index: 1,
      closedAt: Date.now(),
    };
    const { result } = await mount([fileTab("fa", A)], [closed]);
    await act(() => result.current.library.chooseRoot());
    expect(l.libraryChoose).toHaveBeenCalledWith([A, B]);
    expect(result.current.notice).toBe(
      "Removed proj from the sidebar: it overlaps the new Library folder.",
    );
    expect(result.current.library.added).toEqual([]);
    await waitFor(() =>
      expect(result.current.library.rows.map((x) => x.entry.path)).toEqual([
        `${R2}\\x.md`,
      ]),
    );
  });

  it("choose_root_notices_several_removed_folders_once", async () => {
    const R2 = "D:\\Other";
    listings[R2] = [];
    l.libraryRoot.mockResolvedValue({
      root: R,
      available: true,
      added: [
        { path: `${R2}\\proj`, available: true },
        { path: `${R2}\\big`, available: true },
      ],
    });
    l.libraryChoose.mockResolvedValue({
      root: R2,
      available: true,
      added: [],
      removed: ["proj", "big"],
    });
    const { result } = await mount();
    await act(() => result.current.library.chooseRoot());
    expect(result.current.notice).toBe(
      "Removed proj, big from the sidebar: they overlap the new Library folder.",
    );
  });

  it("a_stale_root_state_never_overwrites_a_change", async () => {
    const X = "D:\\Work";
    listings[X] = [file(`${X}\\n.md`)];
    const ADDED: RootState = {
      root: R,
      available: true,
      added: [{ path: X, available: true }],
    };
    const { result } = await mount();
    // A focus asks the roots; its answer is slow (a disconnected share).
    let answerStale!: (rs: RootState) => void;
    l.libraryRoot.mockImplementation(
      () => new Promise<RootState>((res) => (answerStale = res)),
    );
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    // Add folder… runs its dialog meanwhile.
    let answerAdd!: (rs: RootState) => void;
    l.libraryAddFolder.mockImplementation(
      () => new Promise<RootState>((res) => (answerAdd = res)),
    );
    let adding!: Promise<void>;
    act(() => {
      adding = result.current.library.addFolder();
    });
    // The dialog closing gives the focus back: no new ask while it runs.
    const asked = l.libraryRoot.mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(l.libraryRoot.mock.calls.length).toBe(asked);
    await act(async () => {
      answerAdd(ADDED);
      await adding;
    });
    // The answer from before the add lands last, and is dropped.
    await act(async () => {
      answerStale({ root: R, available: true, added: [] });
    });
    expect(result.current.library.added).toEqual(ADDED.added);
    expect(result.current.library.tree.expanded.has(X)).toBe(true);
    await waitFor(() =>
      expect(result.current.library.rows.map((x) => x.entry.path)).toContain(
        `${X}\\n.md`,
      ),
    );
  });

  it("unplugged_on_focus_keeps_expanded", async () => {
    const X = "D:\\Work";
    const XF = `${X}\\n.md`;
    listings[X] = [file(XF)];
    const state = (available: boolean): RootState => ({
      root: R,
      available: true,
      added: [{ path: X, available }],
    });
    l.libraryRoot.mockResolvedValue(state(true));
    const { result } = await mount(undefined, [], {
      ...OPEN,
      expanded: [PROJ, X],
    });
    await waitFor(() =>
      expect(result.current.library.rows.map((x) => x.entry.path)).toContain(
        XF,
      ),
    );
    // The drive is unplugged: listing it fails, and Rust reports it missing.
    delete listings[X];
    l.libraryRoot.mockResolvedValue(state(false));
    l.libraryList.mockClear();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(l.libraryList).toHaveBeenCalledWith(X));
    await waitFor(() =>
      expect(result.current.library.added).toEqual(state(false).added),
    );
    expect(result.current.library.tree.expanded.has(X)).toBe(true);
    expect(result.current.library.rows.map((x) => x.entry.path)).not.toContain(
      XF,
    );
    // Plugged in again: it shows expanded, as it was.
    listings[X] = [file(XF)];
    l.libraryRoot.mockResolvedValue(state(true));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(result.current.library.rows.map((x) => x.entry.path)).toContain(
        XF,
      ),
    );
    expect(result.current.library.tree.expanded.has(X)).toBe(true);
  });

  it("focus_rechecks_root_state", async () => {
    const X = "D:\\Work";
    listings[X] = [file(`${X}\\n.md`)];
    l.libraryRoot.mockResolvedValue({
      root: R,
      available: true,
      added: [{ path: X, available: false }],
    });
    const { result } = await mount(undefined, [], {
      ...OPEN,
      expanded: [PROJ, X],
    });
    const heading = result.current.library.rows.find((x) => x.entry.path === X);
    expect(heading?.heading).toEqual({ available: false });
    expect(l.libraryList).not.toHaveBeenCalledWith(X);
    // The drive is plugged in again.
    l.libraryRoot.mockResolvedValue({
      root: R,
      available: true,
      added: [{ path: X, available: true }],
    });
    l.libraryWatch.mockClear();
    const asked = l.libraryRoot.mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(result.current.library.rows.map((x) => x.entry.path)).toContain(
        `${X}\\n.md`,
      ),
    );
    expect(l.libraryRoot.mock.calls.length).toBeGreaterThan(asked);
    expect(l.libraryResync).toHaveBeenCalled();
    expect(l.libraryWatch).toHaveBeenCalledTimes(1);
    expect(result.current.library.added).toEqual([
      { path: X, available: true },
    ]);
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
    l.libraryRoot.mockResolvedValue({
      root: null,
      available: false,
      added: [],
    });
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
