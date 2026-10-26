import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storage from "../storage/api";
import * as files from "../files/api";
import { useWorkspace } from "./useWorkspace";
import { newTabState } from "../model/workspace";
import { toSessionFile } from "../model/session";
import type {
  ClosedEntry,
  FileFormat,
  FileInfo,
  Fingerprint,
  TabState,
} from "../model/types";

const h = vi.hoisted(() => ({
  flushAll: null as null | (() => Promise<void>),
  fileChanged: null as null | ((e: files.FileChanged) => void),
  openPaths: null as
    | null
    | ((e: { paths: string[]; folders: string[]; missing: string[] }) => void),
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

const FMT: FileFormat = {
  encoding: "utf-8",
  bom: false,
  lineEnding: "lf",
  mixed: false,
};
const fp = (hash: string): Fingerprint => ({ mtimeMs: 1, size: 1, hash });
const P = "C:\\d\\A.json";
const Q = "C:\\d\\notes.txt";

/** The disk: path → text and the hash Rust would report for it. */
let disk: Record<string, { text: string; hash: string }>;
let scratch: Record<string, string>;
let shadows: Record<string, string>;
let writes = 0;

const fileTab = (
  id: string,
  path: string,
  over: Partial<FileInfo> = {},
): TabState => ({
  ...newTabState(id),
  title: path.split("\\").pop()!,
  language: "json",
  languageGuessed: true,
  file: { path, format: FMT, fingerprint: fp("h1"), held: null, ...over },
});

const sessionJson = (tabs: TabState[], closed: ClosedEntry[] = []) =>
  JSON.stringify(toSessionFile({ tabs, activeId: tabs[0].id, closed }));

beforeEach(() => {
  vi.resetAllMocks();
  h.flushAll = null;
  h.fileChanged = null;
  h.openPaths = null;
  writes = 0;
  scratch = { a: "alpha" };
  disk = { [P]: { text: "{}", hash: "h1" } };
  shadows = {};
  s.listScratchpads.mockImplementation(async () => Object.keys(scratch));
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
  f.shadowWrite.mockImplementation(async (id, text) => {
    shadows[id] = text;
  });
  f.shadowRead.mockImplementation(async (id) => shadows[id] ?? null);
  f.shadowDelete.mockImplementation(async (id) => {
    delete shadows[id];
  });
  f.shadowList.mockImplementation(async () => Object.keys(shadows));
  f.fileWatch.mockResolvedValue(undefined);
  f.takeLaunchPaths.mockResolvedValue({ paths: [], folders: [], missing: [] });
  f.grantsFilter.mockImplementation(async (paths) => paths);
  f.filePickOpen.mockResolvedValue([]);
  f.filePickSave.mockResolvedValue(null);
  f.onFileChanged.mockImplementation(async (cb) => {
    h.fileChanged = cb;
    return () => {};
  });
  f.onOpenPaths.mockImplementation(async (cb) => {
    h.openPaths = cb;
    return () => {};
  });
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

async function mount() {
  const r = renderHook(() => useWorkspace());
  await waitFor(() => expect(r.result.current.ready).toBe(true));
  await waitFor(() => expect(h.fileChanged).not.toBeNull());
  return r;
}

const fileTabOf = (r: Result, path = P) =>
  r.current.state.tabs.find((t) => t.file?.path === path);

async function openP(r: Result, path = P): Promise<string> {
  await act(() => r.current.openPaths([path]));
  const tab = fileTabOf(r, path);
  expect(tab).toBeDefined();
  return tab!.id;
}

/** Wait past the 300 ms autosave debounce. */
const settle = () => act(() => new Promise((res) => setTimeout(res, 350)));

describe("useFiles opening", () => {
  it("openSamePathTwiceSwitchesToExistingTab", async () => {
    const { result } = await mount();
    const id = await openP(result);
    const tab = fileTabOf(result)!;
    expect(tab.title).toBe("A.json");
    expect(tab.language).toBe("json");
    expect(result.current.state.activeId).toBe(id);
    act(() => result.current.activate("a"));
    // Another spelling of the same File (case-insensitive on Windows).
    await act(() => result.current.openPaths(["c:\\d\\a.json"]));
    expect(result.current.state.tabs.filter((t) => t.file)).toHaveLength(1);
    expect(result.current.state.activeId).toBe(id);
    expect(f.fileRead).toHaveBeenCalledTimes(1);
    expect(await result.current.loadContent(id)).toBe("{}");
  });

  it("openFolderAndMissingShowNotice", async () => {
    f.takeLaunchPaths.mockResolvedValue({
      paths: [],
      folders: ["C:\\d\\dir"],
      missing: [],
    });
    const { result } = await mount();
    await waitFor(() =>
      expect(result.current.notice).toBe("Open files, not folders"),
    );
    act(() =>
      h.openPaths!({ paths: [], folders: [], missing: ["C:\\d\\gone.txt"] }),
    );
    await waitFor(() =>
      expect(result.current.notice).toBe("Can't find gone.txt"),
    );
    expect(result.current.state.tabs.some((t) => t.file)).toBe(false);
  });

  it("clears a notice after 4 s", async () => {
    const { result } = await mount();
    vi.useFakeTimers();
    await act(() => result.current.openPaths(["C:\\d\\nope.txt"]));
    expect(result.current.notice).toBe("Can't find nope.txt");
    act(() => vi.advanceTimersByTime(3999));
    expect(result.current.notice).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.notice).toBeNull();
  });

  it("opens launch and event paths after the Session is restored", async () => {
    f.takeLaunchPaths.mockResolvedValue({
      paths: [P],
      folders: [],
      missing: [],
    });
    const { result } = await mount();
    await waitFor(() => expect(fileTabOf(result)).toBeDefined());
    disk[Q] = { text: "q", hash: "hq" };
    act(() => h.openPaths!({ paths: [Q], folders: [], missing: [] }));
    await waitFor(() => expect(fileTabOf(result, Q)).toBeDefined());
    expect(result.current.state.activeId).toBe(fileTabOf(result, Q)!.id);
  });

  it("tooLargeShowsNotice", async () => {
    f.fileRead.mockRejectedValueOnce({ kind: "too_large", message: "big" });
    const { result } = await mount();
    await act(() => result.current.openPaths([P]));
    expect(result.current.notice).toBe("Too large to open yet");
    expect(fileTabOf(result)).toBeUndefined();
  });

  it("unreadableOpensReadOnly", async () => {
    f.fileRead.mockResolvedValueOnce({
      text: "\uFFFD",
      format: FMT,
      readable: false,
      fingerprint: fp("h1"),
    });
    const { result } = await mount();
    await openP(result);
    expect(fileTabOf(result)!.file!.held).toBe("readonly");
  });

  it("pickAndOpen opens every picked File", async () => {
    disk[Q] = { text: "q", hash: "hq" };
    f.filePickOpen.mockResolvedValue([P, Q]);
    const { result } = await mount();
    await act(() => result.current.run({ type: "open" }));
    expect(fileTabOf(result)).toBeDefined();
    expect(result.current.state.activeId).toBe(fileTabOf(result, Q)!.id);
  });

  it("watches the open Files", async () => {
    const { result } = await mount();
    await openP(result);
    await waitFor(() => expect(f.fileWatch).toHaveBeenLastCalledWith([P]));
  });
});

describe("useFiles disk changes", () => {
  it("changedWithoutPendingReloads", async () => {
    const { result } = await mount();
    const id = await openP(result);
    disk[P] = { text: '{"x":1}', hash: "h2" };
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await waitFor(() =>
      expect(fileTabOf(result)!.file!.fingerprint).toEqual(fp("h2")),
    );
    expect(await result.current.loadContent(id)).toBe('{"x":1}');
    expect(result.current.replaceRequests).toContainEqual(
      expect.objectContaining({ id, text: '{"x":1}' }),
    );
    expect(fileTabOf(result)!.file!.held).toBeNull();
  });

  it("changedWithPendingBecomesConflict", async () => {
    const { result } = await mount();
    const id = await openP(result);
    act(() => result.current.setContent(id, "mine"));
    disk[P] = { text: "theirs", hash: "h2" };
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("conflict"));
    await settle();
    expect(shadows[id]).toBe("mine");
    expect(f.fileWrite).not.toHaveBeenCalled();
    expect(disk[P].text).toBe("theirs");
    expect(await result.current.loadContent(id)).toBe("mine");
  });

  it("keepMineWritesAndClearsHeld", async () => {
    const { result } = await mount();
    const id = await openP(result);
    act(() => result.current.setContent(id, "mine"));
    disk[P] = { text: "theirs", hash: "h2" };
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("conflict"));
    await settle();
    await act(() => result.current.keepMine(id));
    expect(f.fileWrite).toHaveBeenLastCalledWith(P, "mine", FMT, fp("h2"));
    expect(disk[P].text).toBe("mine");
    expect(fileTabOf(result)!.file!.held).toBeNull();
    expect(shadows[id]).toBeUndefined();
    // Autosave resumes against the new fingerprint.
    act(() => result.current.setContent(id, "mine 2"));
    await settle();
    expect(disk[P].text).toBe("mine 2");
  });

  it("loadDiskReplacesText", async () => {
    const { result } = await mount();
    const id = await openP(result);
    act(() => result.current.setContent(id, "mine"));
    disk[P] = { text: "theirs", hash: "h2" };
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("conflict"));
    await settle();
    await act(() => result.current.loadDiskVersion(id));
    expect(await result.current.loadContent(id)).toBe("theirs");
    expect(fileTabOf(result)!.file!.held).toBeNull();
    expect(fileTabOf(result)!.file!.fingerprint).toEqual(fp("h2"));
    expect(result.current.replaceRequests).toContainEqual(
      expect.objectContaining({ id, text: "theirs" }),
    );
    expect(shadows[id]).toBeUndefined();
  });

  it("removedBecomesMissing", async () => {
    const { result } = await mount();
    const id = await openP(result);
    delete disk[P];
    act(() => h.fileChanged!({ path: P, kind: "removed" }));
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("missing"));
    // The only copy of the text is now in memory: it goes to the shadow.
    await waitFor(() => expect(shadows[id]).toBe("{}"));
    expect(await result.current.loadContent(id)).toBe("{}");
  });

  it("a Missing File that comes back reloads", async () => {
    const { result } = await mount();
    const id = await openP(result);
    delete disk[P];
    act(() => h.fileChanged!({ path: P, kind: "removed" }));
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("missing"));
    await settle();
    disk[P] = { text: "back", hash: "h3" };
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBeNull());
    expect(await result.current.loadContent(id)).toBe("back");
    expect(shadows[id]).toBeUndefined();
  });

  it("saveToOriginalRecreates", async () => {
    const { result } = await mount();
    const id = await openP(result);
    act(() => result.current.setContent(id, "kept"));
    delete disk[P];
    act(() => h.fileChanged!({ path: P, kind: "removed" }));
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("missing"));
    await settle();
    await act(() => result.current.saveToOriginal(id));
    expect(f.fileSaveAs).toHaveBeenCalledWith(P, "kept", FMT);
    expect(disk[P].text).toBe("kept");
    expect(fileTabOf(result)!.file!.held).toBeNull();
    expect(shadows[id]).toBeUndefined();
  });

  it("focusRecheckDetectsMissedChange", async () => {
    const { result } = await mount();
    const id = await openP(result);
    disk[P] = { text: "missed", hash: "h9" };
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(async () =>
      expect(await result.current.loadContent(id)).toBe("missed"),
    );
  });

  it("ignores its own writes", async () => {
    const { result } = await mount();
    const id = await openP(result);
    act(() => result.current.setContent(id, "mine"));
    await settle();
    expect(disk[P].text).toBe("mine");
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await act(() => new Promise((res) => setTimeout(res, 20)));
    expect(fileTabOf(result)!.file!.held).toBeNull();
    expect(f.fileRead).toHaveBeenCalledTimes(1);
  });
});

describe("useFiles save and save as", () => {
  it("ctrlSOnScratchpadOpensSaveDialogAndConvertsTab", async () => {
    const target = "C:\\d\\notes.json";
    f.filePickSave.mockResolvedValue(target);
    const { result } = await mount();
    expect(await result.current.loadContent("a")).toBe("alpha");
    await act(() => result.current.run({ type: "save" }));
    expect(f.filePickSave).toHaveBeenCalledWith("alpha.txt");
    // New Files are UTF-8, no BOM, with the platform Line ending.
    expect(f.fileSaveAs).toHaveBeenCalledWith(target, "alpha", {
      ...FMT,
      lineEnding: "crlf",
    });
    const tab = result.current.state.tabs.find((t) => t.id === "a")!;
    expect(tab.file?.path).toBe(target);
    expect(tab.title).toBe("notes.json");
    expect(tab.language).toBe("json");
    expect(tab.file?.held).toBeNull();
    expect(s.deleteScratchpad).toHaveBeenCalledWith("a");
    // Autosave now goes to the File.
    act(() => result.current.setContent("a", "alpha 2"));
    await settle();
    expect(disk[target].text).toBe("alpha 2");
    expect(scratch.a).toBeUndefined();
  });

  it("keeps a picked Language through Save As", async () => {
    f.filePickSave.mockResolvedValue("C:\\d\\q.txt");
    const { result } = await mount();
    act(() =>
      result.current.updateTab("a", { language: "sql", languagePicked: true }),
    );
    await act(() => result.current.saveAs("a"));
    expect(result.current.state.tabs[0].language).toBe("sql");
  });

  it("saveAsCancelKeepsScratchpad", async () => {
    const { result } = await mount();
    await act(() => result.current.save("a"));
    expect(f.filePickSave).toHaveBeenCalled();
    expect(f.fileSaveAs).not.toHaveBeenCalled();
    expect(s.deleteScratchpad).not.toHaveBeenCalled();
    expect(result.current.state.tabs[0].file).toBeUndefined();
    act(() => result.current.setContent("a", "still"));
    await settle();
    expect(scratch.a).toBe("still");
  });

  it("saveAsToPathOpenInOtherTabRefused", async () => {
    const { result } = await mount();
    await openP(result);
    act(() => result.current.activate("a"));
    f.filePickSave.mockResolvedValue("c:\\D\\a.json");
    await act(() => result.current.run({ type: "saveAs" }));
    expect(result.current.notice).toBe("A.json is open in another tab");
    expect(f.fileSaveAs).not.toHaveBeenCalled();
    expect(
      result.current.state.tabs.find((t) => t.id === "a")!.file,
    ).toBeUndefined();
  });

  it("Ctrl+S in a File flushes it", async () => {
    const { result } = await mount();
    const id = await openP(result);
    act(() => result.current.setContent(id, "now"));
    await act(() => result.current.run({ type: "save" }));
    expect(disk[P].text).toBe("now");
    expect(f.filePickSave).not.toHaveBeenCalled();
  });

  it("renameFileUpdatesPathAndTitle", async () => {
    const { result } = await mount();
    const id = await openP(result);
    f.fileRename.mockResolvedValue("C:\\d\\B.json");
    let err: string | null = "x";
    await act(async () => {
      err = await result.current.renameFile(id, "B");
    });
    expect(err).toBeNull();
    expect(f.fileRename).toHaveBeenCalledWith(P, "B");
    const tab = result.current.state.tabs.find((t) => t.id === id)!;
    expect(tab.file!.path).toBe("C:\\d\\B.json");
    expect(tab.title).toBe("B.json");
  });

  it("renameExistsShowsError", async () => {
    const { result } = await mount();
    const id = await openP(result);
    f.fileRename.mockRejectedValue({ kind: "exists", message: "exists" });
    let err: string | null = null;
    await act(async () => {
      err = await result.current.renameFile(id, "B");
    });
    expect(err).toBe("B.json already exists");
    expect(fileTabOf(result)!.title).toBe("A.json");
  });

  it("convert asks the editor, and a format change writes the File", async () => {
    const { result } = await mount();
    const id = await openP(result);
    act(() => result.current.convert(id, { lineEnding: "crlf" }));
    expect(result.current.convertRequest).toEqual({
      seq: 1,
      id,
      patch: { lineEnding: "crlf" },
    });
    const file = fileTabOf(result)!.file!;
    const crlf = { ...FMT, lineEnding: "crlf" as const };
    act(() =>
      result.current.updateTab(id, { file: { ...file, format: crlf } }),
    );
    await settle();
    expect(f.fileWrite).toHaveBeenLastCalledWith(P, "{}", crlf, fp("h1"));
  });

  it("the format shortcut issues a beautify request", async () => {
    const { result } = await mount();
    await act(() => result.current.run({ type: "format" }));
    expect(result.current.formatRequest).toEqual({ seq: 1, kind: "beautify" });
  });
});

describe("useFiles close, reopen and restore", () => {
  it("closeFileAddsClosedEntryWithPath", async () => {
    const { result } = await mount();
    const id = await openP(result);
    await act(() => result.current.closeTab(id));
    expect(result.current.state.closed[0].tab.file?.path).toBe(P);
    expect(s.closeScratchpad).not.toHaveBeenCalled();
    expect(s.deleteScratchpad).not.toHaveBeenCalled();
    // Reopening re-reads it from disk.
    disk[P] = { text: "later", hash: "h5" };
    await act(() => result.current.reopenEntry(0));
    expect(await result.current.loadContent(id)).toBe("later");
    expect(fileTabOf(result)!.file!.fingerprint).toEqual(fp("h5"));
  });

  it("reopenMissingPathOpensAsMissing", async () => {
    s.readSession.mockResolvedValue(
      sessionJson(
        [newTabState("a")],
        [{ tab: fileTab("f", Q), index: 1, closedAt: Date.now() }],
      ),
    );
    const { result } = await mount();
    await act(() => result.current.run({ type: "reopenTab" }));
    const tab = fileTabOf(result, Q)!;
    expect(tab.file!.held).toBe("missing");
    expect(await result.current.loadContent(tab.id)).toBe("");
  });

  it("heldTabRestoresShadowAfterRestart", async () => {
    shadows.f = "unsaved";
    s.readSession.mockResolvedValue(
      sessionJson([fileTab("f", P, { held: "conflict" }), newTabState("a")]),
    );
    const { result } = await mount();
    expect(await result.current.loadContent("f")).toBe("unsaved");
    expect(fileTabOf(result)!.file!.held).toBe("conflict");
    expect(shadows.f).toBe("unsaved");
  });

  it("drops Session Files that Rust didn't grant", async () => {
    f.grantsFilter.mockResolvedValue([]);
    s.readSession.mockResolvedValue(
      sessionJson([fileTab("f", P), newTabState("a")]),
    );
    const { result } = await mount();
    expect(f.grantsFilter).toHaveBeenCalledWith([P]);
    expect(fileTabOf(result)).toBeUndefined();
  });

  it("quitWithHeldTabDoesNotBlock", async () => {
    s.readSession.mockResolvedValue(
      sessionJson([fileTab("f", P, { held: "missing" })]),
    );
    delete disk[P];
    const { result } = await mount();
    await result.current.loadContent("f");
    act(() => result.current.setContent("f", "typed"));
    await act(() => h.flushAll!());
    expect(shadows.f).toBe("typed");
    expect(f.fileWrite).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe("saved");
  });

  it("closingHeldFileKeepsShadow", async () => {
    shadows.f = "unsaved";
    s.readSession.mockResolvedValue(
      sessionJson([fileTab("f", P, { held: "conflict" }), newTabState("a")]),
    );
    const { result } = await mount();
    await result.current.loadContent("f");
    act(() => result.current.setContent("f", "unsaved 2"));
    await act(() => result.current.closeTab("f"));
    const entry = result.current.state.closed[0];
    expect(entry.tab.file?.held).toBe("conflict");
    expect(shadows.f).toBe("unsaved 2");
    expect(f.shadowDelete).not.toHaveBeenCalledWith("f");
    expect(f.fileWrite).not.toHaveBeenCalled();

    await act(() => result.current.run({ type: "reopenTab" }));
    expect(fileTabOf(result)!.file!.held).toBe("conflict");
    expect(await result.current.loadContent("f")).toBe("unsaved 2");
  });

  it("expiredHeldClosedEntryDeletesShadow", async () => {
    shadows.f = "old";
    const longAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
    s.readSession.mockResolvedValue(
      sessionJson(
        [newTabState("a")],
        [
          {
            tab: fileTab("f", P, { held: "conflict" }),
            index: 0,
            closedAt: longAgo,
          },
        ],
      ),
    );
    const { result } = await mount();
    await waitFor(() => expect(f.shadowDelete).toHaveBeenCalledWith("f"));
    expect(shadows.f).toBeUndefined();
    expect(result.current.state.closed).toEqual([]);
    expect(s.purgeClosed).not.toHaveBeenCalledWith(["f"]);
  });

  it("orphanShadowRecoveredAsScratchpad", async () => {
    shadows.lost = "lost text\nmore";
    const { result } = await mount();
    const tab = result.current.state.tabs.find((t) => t.title === "lost text");
    expect(tab).toBeDefined();
    expect(tab!.file).toBeUndefined();
    expect(scratch[tab!.id]).toBe("lost text\nmore");
    expect(await result.current.loadContent(tab!.id)).toBe("lost text\nmore");
    expect(shadows.lost).toBeUndefined();
    const wrote = s.writeScratchpad.mock.invocationCallOrder[0];
    const deleted = f.shadowDelete.mock.invocationCallOrder[0];
    expect(wrote).toBeLessThan(deleted);
  });

  it("keeps an orphan shadow when its Scratchpad can't be written", async () => {
    shadows.lost = "lost text";
    s.writeScratchpad.mockRejectedValue(new Error("full"));
    const { result } = await mount();
    expect(shadows.lost).toBe("lost text");
    expect(f.shadowDelete).not.toHaveBeenCalled();
    expect(result.current.state.tabs.some((t) => t.title === "lost text")).toBe(
      false,
    );
  });
});
