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

  it("reopenWithEncoding refuses while the Tab has pending edits", async () => {
    const { result } = await mount();
    const id = await openP(result);
    act(() => result.current.setContent(id, "typed"));
    await act(() => result.current.reopenWithEncoding(id, "windows-1252"));
    expect(f.fileRereadAs).not.toHaveBeenCalled();
    expect(result.current.notice).toBe(
      "Can't reopen A.json with another encoding while it has unsaved edits",
    );
    expect(await result.current.loadContent(id)).toBe("typed");
  });

  it("hasPending is true only while the text differs from the disk", async () => {
    const { result } = await mount();
    const id = await openP(result);
    expect(result.current.hasPending(id)).toBe(false);
    act(() => result.current.setContent(id, "typed"));
    expect(result.current.hasPending(id)).toBe(true);
    await settle();
    expect(result.current.hasPending(id)).toBe(false);
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

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
}

describe("useFiles text not loaded yet (final fix I2)", () => {
  const heldSession = (held: FileInfo["held"]) =>
    sessionJson([newTabState("a"), fileTab("f", P, { held })]);

  /** Holds the next shadow read until `open()`. */
  function gateShadowRead() {
    const g = gate();
    const read = f.shadowRead.getMockImplementation()!;
    f.shadowRead.mockImplementationOnce(async (id) => {
      await g.promise;
      return read(id);
    });
    return g;
  }

  it("a Convert before the Tab's text was ever loaded writes its real text", async () => {
    shadows.f = "unsaved";
    s.readSession.mockResolvedValue(heldSession("unencodable"));
    const { result } = await mount();
    const g = gateShadowRead();
    const file = fileTabOf(result)!.file!;
    const bom = { ...FMT, bom: true };
    act(() =>
      result.current.updateTab("f", { file: { ...file, format: bom } }),
    );
    await settle();
    expect(f.fileWrite).not.toHaveBeenCalled();
    expect(disk[P].text).toBe("{}");
    expect(shadows.f).toBe("unsaved");
    g.open();
    await waitFor(() => expect(disk[P].text).toBe("unsaved"));
    expect(f.fileWrite).not.toHaveBeenCalledWith(P, "", bom, fp("h1"));
    expect(fileTabOf(result)!.file!.format).toEqual(bom);
    expect(fileTabOf(result)!.file!.held).toBeNull();
    expect(await result.current.loadContent("f")).toBe("unsaved");
  });

  it("a Convert while the Tab's text is loading waits for it", async () => {
    shadows.f = "unsaved";
    s.readSession.mockResolvedValue(heldSession("unencodable"));
    const { result } = await mount();
    const g = gateShadowRead();
    let loading!: Promise<string>;
    act(() => {
      loading = result.current.loadContent("f");
    });
    const file = fileTabOf(result)!.file!;
    const bom = { ...FMT, bom: true };
    act(() =>
      result.current.updateTab("f", { file: { ...file, format: bom } }),
    );
    await settle();
    expect(f.fileWrite).not.toHaveBeenCalled();
    expect(f.shadowWrite).not.toHaveBeenCalled();
    expect(shadows.f).toBe("unsaved");
    g.open();
    await act(async () => void (await loading));
    await waitFor(() => expect(disk[P].text).toBe("unsaved"));
    expect(f.fileWrite).not.toHaveBeenCalledWith(P, "", bom, fp("h1"));
  });

  it("Load disk version while the Tab's text is loading never writes empty text", async () => {
    shadows.f = "unsaved";
    s.readSession.mockResolvedValue(heldSession("conflict"));
    const { result } = await mount();
    const g = gateShadowRead();
    let loading!: Promise<string>;
    act(() => {
      loading = result.current.loadContent("f");
    });
    // The File went away: Load disk version finds it Missing.
    delete disk[P];
    let loadDisk!: Promise<void>;
    act(() => {
      loadDisk = result.current.loadDiskVersion("f");
    });
    await settle();
    expect(f.shadowWrite).not.toHaveBeenCalledWith("f", "");
    expect(shadows.f).toBe("unsaved");
    g.open();
    await act(async () => {
      await loading;
      await loadDisk;
    });
    await settle();
    expect(f.shadowWrite).not.toHaveBeenCalledWith("f", "");
    expect(shadows.f).toBe("unsaved");
    expect(fileTabOf(result)!.file!.held).toBe("missing");
    expect(await result.current.loadContent("f")).toBe("unsaved");
  });
});

describe("useFiles interleavings (fix round 1)", () => {
  it("typing during a reload's read becomes a conflict, keeping the text", async () => {
    const { result } = await mount();
    const id = await openP(result);
    const g = gate();
    const read = f.fileRead.getMockImplementation()!;
    f.fileRead.mockImplementationOnce(async (path) => {
      await g.promise;
      return read(path);
    });
    disk[P] = { text: "theirs", hash: "h2" };
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await waitFor(() => expect(f.fileRead).toHaveBeenCalledTimes(2));
    act(() => result.current.setContent(id, "typed"));
    g.open();
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("conflict"));
    await settle();
    expect(shadows[id]).toBe("typed");
    expect(disk[P].text).toBe("theirs");
    expect(await result.current.loadContent(id)).toBe("typed");
  });

  it("an event for Zukai's own write arriving mid-write is ignored", async () => {
    const { result } = await mount();
    const id = await openP(result);
    const g = gate();
    const write = f.fileWrite.getMockImplementation()!;
    f.fileWrite.mockImplementationOnce(async (...args) => {
      const out = await write(...args); // on disk; the reply is slow
      await g.promise;
      return out;
    });
    act(() => result.current.setContent(id, "mine"));
    await waitFor(() => expect(f.fileWrite).toHaveBeenCalled());
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    g.open();
    await act(() => new Promise((res) => setTimeout(res, 30)));
    expect(fileTabOf(result)!.file!.held).toBeNull();
    expect(f.fileRead).toHaveBeenCalledTimes(1);
    expect(disk[P].text).toBe("mine");
  });

  it("a real change arriving mid-write is a conflict, not overwritten", async () => {
    const { result } = await mount();
    const id = await openP(result);
    const g = gate();
    const write = f.fileWrite.getMockImplementation()!;
    f.fileWrite.mockImplementationOnce(async (...args) => {
      await g.promise;
      return write(...args);
    });
    act(() => result.current.setContent(id, "mine"));
    await waitFor(() => expect(f.fileWrite).toHaveBeenCalled());
    disk[P] = { text: "theirs", hash: "h2" };
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    g.open();
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("conflict"));
    await waitFor(() => expect(shadows[id]).toBe("mine"));
    expect(disk[P].text).toBe("theirs");
  });

  it("an autosave queued behind Save As goes to the new File", async () => {
    const target = "C:\\d\\notes.txt";
    f.filePickSave.mockResolvedValue(target);
    const g = gate();
    const saveAs = f.fileSaveAs.getMockImplementation()!;
    f.fileSaveAs.mockImplementationOnce(async (...args) => {
      await g.promise;
      return saveAs(...args);
    });
    const { result } = await mount();
    await result.current.loadContent("a");
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.saveAs("a");
    });
    await waitFor(() => expect(f.fileSaveAs).toHaveBeenCalled());
    act(() => result.current.setContent("a", "alpha 2"));
    await settle(); // the autosave is now queued behind the Save As
    g.open();
    await act(() => saving);
    await waitFor(() => expect(disk[target]?.text).toBe("alpha 2"));
    expect(scratch.a).toBeUndefined();
    expect(s.writeScratchpad).not.toHaveBeenCalledWith("a", "alpha 2");
    // The Session named the File before the scratchpad was deleted.
    const named = s.writeSession.mock.calls.findIndex(([json]) =>
      json.includes("notes.txt"),
    );
    expect(named).toBeGreaterThanOrEqual(0);
    expect(s.writeSession.mock.invocationCallOrder[named]).toBeLessThan(
      s.deleteScratchpad.mock.invocationCallOrder[0],
    );
  });

  it("Save to original never overwrites a File that came back", async () => {
    const { result } = await mount();
    const id = await openP(result);
    act(() => result.current.setContent(id, "kept"));
    delete disk[P];
    act(() => h.fileChanged!({ path: P, kind: "removed" }));
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("missing"));
    await settle();
    disk[P] = { text: "back", hash: "h3" };
    await act(() => result.current.saveToOriginal(id));
    expect(f.fileSaveAs).not.toHaveBeenCalled();
    expect(disk[P].text).toBe("back");
    expect(fileTabOf(result)!.file!.held).toBe("conflict");
    expect(await result.current.loadContent(id)).toBe("kept");
  });

  it("Save to original reloads a File that came back when nothing was typed", async () => {
    const { result } = await mount();
    const id = await openP(result);
    delete disk[P];
    act(() => h.fileChanged!({ path: P, kind: "removed" }));
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("missing"));
    await settle();
    disk[P] = { text: "back", hash: "h3" };
    await act(() => result.current.saveToOriginal(id));
    expect(f.fileSaveAs).not.toHaveBeenCalled();
    expect(fileTabOf(result)!.file!.held).toBeNull();
    expect(await result.current.loadContent(id)).toBe("back");
  });

  it("an unreadable shadow keeps the Tab held and the shadow intact", async () => {
    shadows.f = "unsaved";
    f.shadowRead.mockRejectedValue({ kind: "io", message: "denied" });
    s.readSession.mockResolvedValue(
      sessionJson([fileTab("f", P, { held: "conflict" }), newTabState("a")]),
    );
    const { result } = await mount();
    expect(await result.current.loadContent("f")).toBe("");
    // The real held state stays; the condition is a separate, unsaved flag.
    expect(fileTabOf(result)!.file!.held).toBe("conflict");
    await waitFor(() =>
      expect(result.current.shadowUnreadable.has("f")).toBe(true),
    );
    expect(result.current.notice).toBe(
      "Can't read the unsaved text of A.json: denied",
    );
    // Nothing can be typed into it from the hook side.
    act(() => result.current.setContent("f", "x"));
    expect(await result.current.loadContent("f")).toBe("");
    await settle();
    await act(() => result.current.closeTab("f"));
    expect(result.current.state.closed[0].tab.file?.held).toBe("conflict");
    expect(result.current.shadowUnreadable.has("f")).toBe(false);
    expect(shadows.f).toBe("unsaved");
    expect(f.shadowWrite).not.toHaveBeenCalled();
    expect(f.shadowDelete).not.toHaveBeenCalled();
    expect(f.fileWrite).not.toHaveBeenCalled();

    // A failed reopen leaves the entry; once the shadow reads, it comes back.
    await act(() => result.current.reopenEntry(0));
    expect(result.current.state.closed).toHaveLength(1);
    f.shadowRead.mockImplementation(async (id) => shadows[id] ?? null);
    await act(() => result.current.reopenEntry(0));
    expect(await result.current.loadContent("f")).toBe("unsaved");
    expect(fileTabOf(result)!.file!.held).toBe("conflict");
  });

  it("an unreadable shadow survives a restart, and is read again then", async () => {
    shadows.f = "unsaved";
    f.shadowRead.mockRejectedValue({ kind: "io", message: "denied" });
    s.readSession.mockResolvedValue(
      sessionJson([fileTab("f", P, { held: "conflict" }), newTabState("a")]),
    );
    const first = await mount();
    await first.result.current.loadContent("f");
    await act(() => h.flushAll!());
    const saved = s.writeSession.mock.lastCall![0];
    expect(JSON.parse(saved).tabs[0].file.held).toBe("conflict");
    first.unmount();

    // Still unreadable after the restart: still held, shadow still there.
    s.readSession.mockResolvedValue(saved);
    const second = await mount();
    expect(await second.result.current.loadContent("f")).toBe("");
    expect(fileTabOf(second.result)!.file!.held).toBe("conflict");
    await act(() => h.flushAll!());
    const again = s.writeSession.mock.lastCall![0];
    expect(JSON.parse(again).tabs[0].file.held).toBe("conflict");
    second.unmount();
    expect(shadows.f).toBe("unsaved");

    // Readable on the next restart: the text comes back.
    f.shadowRead.mockImplementation(async (id) => shadows[id] ?? null);
    s.readSession.mockResolvedValue(again);
    const third = await mount();
    expect(await third.result.current.loadContent("f")).toBe("unsaved");
    expect(fileTabOf(third.result)!.file!.held).toBe("conflict");
    expect(third.result.current.shadowUnreadable.size).toBe(0);
    expect(f.shadowDelete).not.toHaveBeenCalled();
    expect(shadows.f).toBe("unsaved");
  });

  it("a Tab with an unreadable shadow can't be moved or overwritten", async () => {
    shadows.f = "unsaved";
    f.shadowRead.mockRejectedValue({ kind: "io", message: "denied" });
    f.filePickSave.mockResolvedValue("C:\\d\\elsewhere.json");
    f.fileRename.mockResolvedValue("C:\\d\\B.json");
    s.readSession.mockResolvedValue(
      sessionJson([fileTab("f", P, { held: "missing" }), newTabState("a")]),
    );
    delete disk[P];
    const { result } = await mount();
    await result.current.loadContent("f");
    const refused = "A.json has unsaved text that can't be read yet";

    await act(() => result.current.saveAs("f"));
    expect(f.filePickSave).not.toHaveBeenCalled();
    expect(result.current.notice).toBe(refused);

    let err: string | null = null;
    await act(async () => {
      err = await result.current.renameFile("f", "B");
    });
    expect(err).toBe(refused);
    expect(f.fileRename).not.toHaveBeenCalled();

    await act(() => result.current.saveToOriginal("f"));
    await act(() => result.current.keepMine("f"));
    await act(() => result.current.loadDiskVersion("f"));
    f.fileRereadAs.mockClear();
    await act(() => result.current.reopenWithEncoding("f", "windows-1252"));
    expect(f.fileRereadAs).not.toHaveBeenCalled();
    expect(result.current.notice).toBe(refused);
    expect(f.fileSaveAs).not.toHaveBeenCalled();
    expect(f.fileWrite).not.toHaveBeenCalled();
    expect(fileTabOf(result)!.file!.path).toBe(P);
    expect(fileTabOf(result)!.file!.held).toBe("missing");
    expect(shadows.f).toBe("unsaved");
  });

  it("a Convert never clears or writes a Tab whose shadow can't be read", async () => {
    shadows.f = "unsaved";
    f.shadowRead.mockRejectedValue({ kind: "io", message: "denied" });
    s.readSession.mockResolvedValue(
      sessionJson([fileTab("f", P, { held: "unencodable" }), newTabState("a")]),
    );
    const { result } = await mount();
    await result.current.loadContent("f");
    const file = fileTabOf(result)!.file!;
    act(() => result.current.convert("f", { encoding: "utf-8", bom: true }));
    expect(result.current.convertRequest).toBeNull();
    // The editor's patch (what Task 10 sends) is refused; other fields apply.
    act(() =>
      result.current.updateTab("f", {
        wrap: true,
        file: { ...file, format: { ...FMT, bom: true } },
      }),
    );
    expect(result.current.notice).toBe(
      "A.json has unsaved text that can't be read yet",
    );
    await settle();
    const tab = fileTabOf(result)!;
    expect(tab.wrap).toBe(true);
    expect(tab.file!.held).toBe("unencodable");
    expect(tab.file!.format).toEqual(FMT);
    expect(f.fileWrite).not.toHaveBeenCalled();
    expect(f.fileFingerprint).not.toHaveBeenCalledWith(P);
    expect(f.shadowWrite).not.toHaveBeenCalled();
    expect(shadows.f).toBe("unsaved");
    // Ctrl+S on it writes nothing either.
    await act(() => result.current.run({ type: "save" }));
    expect(f.fileWrite).not.toHaveBeenCalled();
  });

  it("handles captured before a shadow became unreadable still refuse", async () => {
    shadows.f = "unsaved";
    f.shadowRead.mockRejectedValue({ kind: "io", message: "denied" });
    f.filePickSave.mockResolvedValue("C:\\d\\elsewhere.json");
    f.fileRename.mockResolvedValue("C:\\d\\B.json");
    s.readSession.mockResolvedValue(
      sessionJson([newTabState("a"), fileTab("f", P, { held: "conflict" })]),
    );
    const { result } = await mount();
    // What the UI captured on an earlier render, before "f" was loaded.
    const early = result.current;
    expect(early.shadowUnreadable.size).toBe(0);
    await result.current.loadContent("f");
    await waitFor(() =>
      expect(result.current.shadowUnreadable.has("f")).toBe(true),
    );
    const refused = "A.json has unsaved text that can't be read yet";

    await act(() => early.saveAs("f"));
    expect(f.filePickSave).not.toHaveBeenCalled();
    let err: string | null = null;
    await act(async () => {
      err = await early.renameFile("f", "B");
    });
    expect(err).toBe(refused);
    await act(() => early.keepMine("f"));
    await act(() => early.saveToOriginal("f"));
    await act(() => early.loadDiskVersion("f"));
    await act(() => early.reopenWithEncoding("f", "windows-1252"));
    act(() => early.convert("f", { bom: true }));
    act(() =>
      early.updateTab("f", {
        file: { ...fileTabOf(result)!.file!, format: { ...FMT, bom: true } },
      }),
    );
    act(() => early.setContent("f", "typed"));
    await settle();
    act(() => early.activate("f"));
    await act(() => early.run({ type: "save" }));
    await act(() => early.run({ type: "saveAs" }));

    expect(result.current.notice).toBe(refused);
    expect(result.current.convertRequest).toBeNull();
    expect(f.fileRename).not.toHaveBeenCalled();
    expect(f.fileWrite).not.toHaveBeenCalled();
    expect(f.fileSaveAs).not.toHaveBeenCalled();
    expect(f.fileRereadAs).not.toHaveBeenCalled();
    expect(f.shadowWrite).not.toHaveBeenCalled();
    expect(f.shadowDelete).not.toHaveBeenCalled();
    const tab = fileTabOf(result)!;
    expect(tab.file!.held).toBe("conflict");
    expect(tab.file!.format).toEqual(FMT);
    expect(await result.current.loadContent("f")).toBe("");
    expect(shadows.f).toBe("unsaved");
    // The handles are the same functions on every render: none goes stale.
    for (const k of [
      "saveAs",
      "renameFile",
      "keepMine",
      "saveToOriginal",
      "loadDiskVersion",
      "reopenWithEncoding",
      "convert",
      "updateTab",
      "setContent",
      "activate",
      "run",
    ] as const) {
      expect(result.current[k]).toBe(early[k]);
    }
  });

  it("a restored Missing File that already came back is re-checked", async () => {
    shadows.f = "mine";
    s.readSession.mockResolvedValue(
      sessionJson([fileTab("f", P, { held: "missing" }), newTabState("a")]),
    );
    const { result } = await mount();
    expect(await result.current.loadContent("f")).toBe("mine");
    // Its text isn't on disk: a conflict, not a silent reload.
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("conflict"));
    expect(shadows.f).toBe("mine");
  });

  it("a File held by a re-check that was running when it closed keeps its text", async () => {
    const { result } = await mount();
    const id = await openP(result);
    act(() => result.current.setContent(id, "mine"));
    await settle();
    expect(disk[P].text).toBe("mine");
    // A focus re-check is waiting on the disk when the Tab closes...
    const g = gate();
    const fingerprint = f.fileFingerprint.getMockImplementation()!;
    f.fileFingerprint.mockImplementationOnce(async (path) => {
      await g.promise;
      return fingerprint(path);
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(f.fileFingerprint).toHaveBeenCalled());
    let closed!: Promise<void>;
    act(() => {
      closed = result.current.closeTab(id);
    });
    // ...and finds the File deleted.
    delete disk[P];
    g.open();
    await act(() => closed);
    const entry = result.current.state.closed[0];
    expect(entry.tab.file?.held).toBe("missing");
    expect(shadows[id]).toBe("mine");
  });

  it("closing a File that isn't held drops any stale shadow", async () => {
    const { result } = await mount();
    const id = await openP(result);
    shadows[id] = "stale";
    await act(() => result.current.closeTab(id));
    expect(shadows[id]).toBeUndefined();
  });

  it("shows one notice for folders and several missing paths", async () => {
    const { result } = await mount();
    act(() =>
      h.openPaths!({
        paths: [],
        folders: ["C:\\d\\dir"],
        missing: ["C:\\d\\a.txt", "C:\\d\\b.txt"],
      }),
    );
    await waitFor(() =>
      expect(result.current.notice).toBe(
        "Open files, not folders. Can't find a.txt, b.txt",
      ),
    );
  });
});
