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
  fileChangeExtension: vi.fn(),
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
  // Rust's quick check: same time and size means the expected one back.
  f.fileFingerprintQuick.mockImplementation(async (path, expected) => {
    const d = disk[path];
    if (!d) return null;
    const now = fp(d.hash);
    return now.mtimeMs === expected.mtimeMs && now.size === expected.size
      ? expected
      : now;
  });
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

/** Most tests are about autosaving Files, so autosave starts on. */
async function mount(autosaveFiles = true) {
  const r = renderHook(() => useWorkspace());
  await waitFor(() => expect(r.result.current.ready).toBe(true));
  await waitFor(() => expect(h.fileChanged).not.toBeNull());
  act(() => r.result.current.setSettings({ autosaveFiles }));
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

describe("useFiles autosave setting", () => {
  it("turning autosave on doesn't write an unsaved File until its next edit", async () => {
    const { result } = await mount(false);
    const id = await openP(result);
    act(() => result.current.setContent(id, "typed"));
    await settle();
    expect(f.fileWrite).not.toHaveBeenCalled();
    expect(shadows[id]).toBe("typed");
    expect(fileTabOf(result)!.file!.unsaved).toBe(true);

    act(() => result.current.setSettings({ autosaveFiles: true }));
    await act(() => h.flushAll!());
    expect(f.fileWrite).not.toHaveBeenCalled();

    act(() => result.current.setContent(id, "typed more"));
    await settle();
    expect(f.fileWrite).toHaveBeenCalledWith(P, "typed more", FMT, fp("h1"));
    expect(fileTabOf(result)!.file!.unsaved).toBeUndefined();
  });
});

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
    // A missed write also changed the file's time (the focus check is quick).
    f.fileFingerprintQuick.mockResolvedValueOnce({ ...fp("h9"), mtimeMs: 2 });
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

  it("Save As of a Canvas Scratchpad offers .excalidraw and keeps the Kind", async () => {
    const target = "C:\\d\\flow.excalidraw";
    f.filePickSave.mockResolvedValue(target);
    const { result } = await mount();
    await act(() => result.current.run({ type: "newCanvas" }));
    const id = result.current.state.activeId;
    const json = '{"type":"excalidraw","elements":[]}';
    act(() => result.current.setContent(id, json));
    await act(() => result.current.run({ type: "save" }));
    expect(f.filePickSave).toHaveBeenCalledWith(
      "Untitled.excalidraw",
      undefined,
      {
        name: "Excalidraw drawing",
        extensions: ["excalidraw"],
      },
    );
    expect(f.fileSaveAs).toHaveBeenCalledWith(target, json, expect.anything());
    const tab = result.current.state.tabs.find((t) => t.id === id)!;
    expect(tab.kind).toBe("canvas");
    expect(tab.file?.path).toBe(target);
    expect(tab.title).toBe("flow.excalidraw");
  });

  it("Save As never changes a Tab's Kind", async () => {
    const { result } = await mount();
    // Text never goes into a drawing or an image file.
    for (const target of ["C:\\d\\x.excalidraw", "C:\\d\\x.PNG"]) {
      f.filePickSave.mockResolvedValue(target);
      await act(() => result.current.saveAs("a"));
      expect(result.current.notice).toMatch(/^Can't save text as /);
    }
    // A drawing only goes into a .excalidraw file.
    await act(() => result.current.run({ type: "newCanvas" }));
    const id = result.current.state.activeId;
    act(() =>
      result.current.setContent(id, '{"type":"excalidraw","elements":[]}'),
    );
    f.filePickSave.mockResolvedValue("C:\\d\\x.txt");
    await act(() => result.current.saveAs(id));
    expect(result.current.notice).toBe(
      "A canvas can only be saved as a .excalidraw file",
    );
    expect(f.fileSaveAs).not.toHaveBeenCalled();
    expect(result.current.state.tabs.every((t) => !t.file)).toBe(true);
  });

  it("an Image Tab is never saved", async () => {
    const pic = "C:\\d\\pic.png";
    disk[pic] = { text: "", hash: "p1" };
    const { result } = await mount();
    const id = await openP(result, pic);
    expect(fileTabOf(result, pic)!.kind).toBe("image");
    f.filePickSave.mockResolvedValue("C:\\d\\copy.png");
    // No dialog, nothing written; Ctrl+S and Save to original do nothing.
    await act(() => result.current.saveAs(id));
    expect(result.current.notice).toBe("Images are read-only in Zukai");
    expect(f.filePickSave).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.run({ type: "save" });
      await result.current.saveToOriginal(id);
      await result.current.keepMine(id);
    });
    expect(f.fileSaveAs).not.toHaveBeenCalled();
    expect(f.fileWrite).not.toHaveBeenCalled();
  });

  it("a disk change reloads an Image Tab (a new replace for its reloadSeq)", async () => {
    const pic = "C:\\d\\pic.png";
    disk[pic] = { text: "", hash: "p1" };
    const { result } = await mount();
    const id = await openP(result, pic);
    disk[pic] = { text: "", hash: "p2" };
    act(() => h.fileChanged!({ path: pic, kind: "changed" }));
    await waitFor(() =>
      expect(result.current.replaceRequests.some((r) => r.id === id)).toBe(
        true,
      ),
    );
    expect(fileTabOf(result, pic)!.file!.fingerprint).toEqual(fp("p2"));
    expect(f.fileWrite).not.toHaveBeenCalled();
  });

  it("a Missing Image Tab never shadows, and reopens from the disk", async () => {
    const pic = "C:\\d\\pic.png";
    disk[pic] = { text: "\uFFFDPNG", hash: "p1" };
    const { result } = await mount();
    const id = await openP(result, pic);
    delete disk[pic];
    act(() => h.fileChanged!({ path: pic, kind: "removed" }));
    await waitFor(() =>
      expect(fileTabOf(result, pic)!.file!.held).toBe("missing"),
    );
    await settle();
    expect(shadows[id]).toBeUndefined();
    await act(() => result.current.closeTab(id));
    expect(shadows[id]).toBeUndefined();
    expect(f.shadowWrite).not.toHaveBeenCalled();

    // It comes back; reopening reads the disk, not a shadow.
    disk[pic] = { text: "\uFFFDPNG2", hash: "p2" };
    await act(() => result.current.reopenEntry(id));
    const tab = fileTabOf(result, pic)!;
    expect([null, "readonly"]).toContain(tab.file!.held);
    expect(tab.file!.fingerprint).toEqual(fp("p2"));
    expect(f.shadowRead).not.toHaveBeenCalledWith(id);
    expect(f.fileWrite).not.toHaveBeenCalled();
    expect(f.fileSaveAs).not.toHaveBeenCalled();
  });

  it("Ctrl+S in a File flushes it", async () => {
    const { result } = await mount();
    const id = await openP(result);
    act(() => result.current.setContent(id, "now"));
    await act(() => result.current.run({ type: "save" }));
    expect(disk[P].text).toBe("now");
    expect(f.filePickSave).not.toHaveBeenCalled();
  });

  it("reopening a File whose closed Tab was pinned keeps the pin", async () => {
    const { result } = await mount();
    const id = await openP(result);
    act(() => result.current.setPinned(id, true));
    await act(() => result.current.closeTab(id));
    await openP(result);
    const tab = fileTabOf(result)!;
    expect(tab.pinned).toBe(true);
    expect(result.current.state.tabs[0].id).toBe(tab.id);
    expect(
      result.current.state.closed.some((e) => e.tab.file?.path === P),
    ).toBe(false);
  });

  it("an opened File starts wrapped when the setting is on", async () => {
    const { result } = await mount();
    act(() => result.current.setSettings({ wrapNewTabs: true }));
    await openP(result);
    expect(fileTabOf(result)!.wrap).toBe(true);
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

  it("renameExtension moves the File to the new extension", async () => {
    const { result } = await mount();
    const id = await openP(result);
    f.fileChangeExtension.mockResolvedValue("C:\\d\\A.ts");
    let err: string | null = "x";
    await act(async () => {
      err = await result.current.renameExtension(id, "ts");
    });
    expect(err).toBeNull();
    expect(f.fileChangeExtension).toHaveBeenCalledWith(P, "ts");
    const tab = result.current.state.tabs.find((t) => t.id === id)!;
    expect(tab.file!.path).toBe("C:\\d\\A.ts");
    expect(tab.title).toBe("A.ts");
  });

  it("renameExtension onto an existing file says so and changes nothing", async () => {
    const { result } = await mount();
    const id = await openP(result);
    f.fileChangeExtension.mockRejectedValue({
      kind: "exists",
      message: "exists",
    });
    let err: string | null = null;
    await act(async () => {
      err = await result.current.renameExtension(id, "ts");
    });
    expect(err).toBe("A.ts already exists");
    expect(result.current.notice).toBe("A.ts already exists");
    expect(fileTabOf(result)!.file!.path).toBe(P);
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

  describe("with autosave off", () => {
    const CRLF = { ...FMT, lineEnding: "crlf" as const };
    async function convertToCrlf() {
      const { result } = await mount(false);
      const id = await openP(result);
      await act(() => result.current.loadContent(id));
      const file = fileTabOf(result)!.file!;
      act(() =>
        result.current.updateTab(id, { file: { ...file, format: CRLF } }),
      );
      await settle();
      return { result, id };
    }

    it("a Convert with autosave off keeps the File unwritten and marks it unsaved", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { result, id } = await convertToCrlf();
      await act(() => vi.advanceTimersByTimeAsync(300));
      expect(f.fileWrite).not.toHaveBeenCalled();
      const file = fileTabOf(result)!.file!;
      expect(file.diskFormat).toEqual(FMT);
      expect(file.format).toEqual(CRLF);
      expect(file.unsaved).toBe(true);
      expect(shadows[id]).toBe("{}");
    });

    it("converting back to the disk format clears unsaved", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const { result, id } = await convertToCrlf();
      await act(() => vi.advanceTimersByTimeAsync(300));
      expect(fileTabOf(result)!.file!.unsaved).toBe(true);
      const file = fileTabOf(result)!.file!;
      act(() =>
        result.current.updateTab(id, { file: { ...file, format: FMT } }),
      );
      await settle();
      const back = fileTabOf(result)!.file!;
      expect(back.unsaved).toBeUndefined();
      expect(back.diskFormat).toBeUndefined();
      expect(f.fileWrite).not.toHaveBeenCalled();
    });

    it("Save after a Convert writes the new format", async () => {
      const { result, id } = await convertToCrlf();
      await act(() => result.current.save(id));
      expect(f.fileWrite).toHaveBeenCalledWith(P, "{}", CRLF, fp("h1"));
      expect(fileTabOf(result)!.file!.diskFormat).toBeUndefined();
    });
  });

  describe("Save", () => {
    it("Mod+S writes an unsaved File and clears the dot", async () => {
      const { result } = await mount(false);
      const id = await openP(result);
      act(() => result.current.setContent(id, "typed"));
      await settle();
      expect(fileTabOf(result)!.file!.unsaved).toBe(true);
      await act(() => result.current.run({ type: "save" }));
      expect(f.fileWrite).toHaveBeenCalledWith(P, "typed", FMT, fp("h1"));
      expect(disk[P].text).toBe("typed");
      expect(fileTabOf(result)!.file!.unsaved).toBeUndefined();
      expect(shadows[id]).toBeUndefined();
    });

    it("Mod+S on a clean File writes nothing", async () => {
      const { result } = await mount(false);
      await openP(result);
      await act(() => result.current.run({ type: "save" }));
      expect(f.fileWrite).not.toHaveBeenCalled();
      expect(f.fileSaveAs).not.toHaveBeenCalled();
    });

    it("Mod+S on a conflict shows a notice and writes nothing", async () => {
      const { result } = await mount(false);
      const id = await openP(result);
      act(() => result.current.setContent(id, "mine"));
      disk[P] = { text: "theirs", hash: "h2" };
      act(() => h.fileChanged!({ path: P, kind: "changed" }));
      await waitFor(() =>
        expect(fileTabOf(result)!.file!.held).toBe("conflict"),
      );
      await settle();
      await act(() => result.current.run({ type: "save" }));
      expect(result.current.notice).toBe("Resolve the conflict first");
      expect(f.fileWrite).not.toHaveBeenCalled();
      expect(disk[P].text).toBe("theirs");
    });

    it("Mod+S on a Missing File recreates it", async () => {
      const { result } = await mount(false);
      const id = await openP(result);
      act(() => result.current.setContent(id, "kept"));
      delete disk[P];
      act(() => h.fileChanged!({ path: P, kind: "removed" }));
      await waitFor(() =>
        expect(fileTabOf(result)!.file!.held).toBe("missing"),
      );
      await settle();
      await act(() => result.current.run({ type: "save" }));
      expect(f.fileSaveAs).toHaveBeenCalledWith(P, "kept", FMT);
      expect(disk[P].text).toBe("kept");
      expect(fileTabOf(result)!.file!.held).toBeNull();
    });

    it("Save all saves every unsaved File and names skipped conflicts", async () => {
      disk[Q] = { text: "q", hash: "q1" };
      const { result } = await mount(false);
      const a = await openP(result);
      const b = await openP(result, Q);
      act(() => result.current.setContent(a, "A2"));
      act(() => result.current.setContent(b, "B2"));
      await settle();
      disk[Q] = { text: "q-theirs", hash: "q2" };
      act(() => h.fileChanged!({ path: Q, kind: "changed" }));
      await waitFor(() =>
        expect(fileTabOf(result, Q)!.file!.held).toBe("conflict"),
      );
      await settle();
      await act(() => result.current.saveAll());
      expect(disk[P].text).toBe("A2");
      expect(fileTabOf(result)!.file!.unsaved).toBeUndefined();
      expect(disk[Q].text).toBe("q-theirs");
      expect(result.current.notice).toBe("Not saved (conflict): notes.txt");
    });
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
    await act(() => result.current.reopenEntry(id));
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

  it("reopeningAnOpenFileFocusesItsSplitHalf", async () => {
    // A stale Recently Closed entry for a File that is open again.
    s.readSession.mockResolvedValue(
      sessionJson(
        [newTabState("a"), fileTab("f", P)],
        [{ tab: fileTab("old", P), index: 1, closedAt: Date.now() }],
      ),
    );
    const { result } = await mount();
    act(() => result.current.splitWith("a", "f"));
    act(() => result.current.activate("a"));
    await act(() => result.current.reopenEntry("old"));
    expect(result.current.state.activeId).toBe("f");
    expect(result.current.state.splits![0].focus).toBe("b");
    expect(result.current.state.closed).toHaveLength(0);
  });

  it("keepsASplitWhenTheLaterCheckDropsAnotherFile", async () => {
    f.grantsFilter.mockRejectedValue(new Error("ipc"));
    s.readSession.mockResolvedValue(
      JSON.stringify(
        toSessionFile({
          tabs: [fileTab("f", P), newTabState("a"), fileTab("g", Q)],
          activeId: "f",
          closed: [],
          splits: [
            { a: "f", b: "a", orientation: "row", ratio: 0.5, focus: "a" },
          ],
        }),
      ),
    );
    const { result } = await mount();
    f.grantsFilter.mockReset();
    f.grantsFilter.mockResolvedValue([P]);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(fileTabOf(result, Q)).toBeUndefined());
    expect(result.current.state.splits).toMatchObject([{ a: "f", b: "a" }]);
  });

  it("dropsASplitWhenTheLaterCheckRemovesAMember", async () => {
    f.grantsFilter.mockRejectedValue(new Error("ipc"));
    s.readSession.mockResolvedValue(
      JSON.stringify(
        toSessionFile({
          tabs: [fileTab("f", P), newTabState("a"), fileTab("g", Q)],
          activeId: "f",
          closed: [],
          splits: [
            { a: "f", b: "g", orientation: "row", ratio: 0.5, focus: "a" },
          ],
        }),
      ),
    );
    const { result } = await mount();
    f.grantsFilter.mockReset();
    f.grantsFilter.mockResolvedValue([P]);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(fileTabOf(result, Q)).toBeUndefined());
    expect(result.current.state.splits ?? []).toEqual([]);
    expect(result.current.state.tabs.map((t) => t.id)).toEqual(["f", "a"]);
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

  it("an orphan shadow of a drawing is recovered as a Canvas", async () => {
    const json = '{"type":"excalidraw","elements":[{"id":"x","version":1}]}';
    shadows.lost = json;
    const { result } = await mount();
    const tab = result.current.state.tabs.find((t) => t.kind === "canvas");
    expect(tab).toBeDefined();
    expect(tab!.title).toBe("Untitled");
    expect(tab!.file).toBeUndefined();
    expect(s.writeScratchpad).toHaveBeenCalledWith(tab!.id, json, "excalidraw");
    expect(await result.current.loadContent(tab!.id)).toBe(json);
    expect(shadows.lost).toBeUndefined();
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

describe("useFiles shadows the Session doesn't know are held (final fix I3)", () => {
  it("a shadow for a non-held Tab at restart holds the Tab with its text", async () => {
    // A crash between the shadow write and the (debounced) Session save,
    // after the disk changed.
    shadows.f = "unsaved";
    disk[P] = { text: "{}", hash: "h2" };
    s.readSession.mockResolvedValue(
      sessionJson([fileTab("f", P), newTabState("a")]),
    );
    const { result } = await mount();
    expect(fileTabOf(result)!.file!.held).toBe("conflict");
    expect(await result.current.loadContent("f")).toBe("unsaved");
    await settle();
    expect(shadows.f).toBe("unsaved");
    expect(f.shadowDelete).not.toHaveBeenCalledWith("f");
    expect(f.fileWrite).not.toHaveBeenCalled();
    expect(disk[P].text).toBe("{}");
  });

  it("holds it Missing when its File is gone", async () => {
    shadows.f = "unsaved";
    delete disk[P];
    s.readSession.mockResolvedValue(
      sessionJson([newTabState("a"), fileTab("f", P, { held: "readonly" })]),
    );
    const { result } = await mount();
    expect(fileTabOf(result)!.file!.held).toBe("missing");
    expect(await result.current.loadContent("f")).toBe("unsaved");
    await settle();
    expect(shadows.f).toBe("unsaved");
  });

  it("does the same for a Recently Closed entry", async () => {
    shadows.f = "unsaved";
    disk[P] = { text: "{}", hash: "h2" };
    s.readSession.mockResolvedValue(
      sessionJson(
        [newTabState("a")],
        [{ tab: fileTab("f", P), index: 1, closedAt: Date.now() }],
      ),
    );
    const { result } = await mount();
    expect(result.current.state.closed[0].tab.file!.held).toBe("conflict");
    expect(shadows.f).toBe("unsaved");
    await act(() => result.current.run({ type: "reopenTab" }));
    expect(fileTabOf(result)!.file!.held).toBe("conflict");
    expect(await result.current.loadContent("f")).toBe("unsaved");
    expect(shadows.f).toBe("unsaved");
  });

  it("saves the Session at once when a Tab becomes held", async () => {
    const { result } = await mount();
    const id = await openP(result);
    act(() => result.current.setContent(id, "mine"));
    s.writeSession.mockClear();
    disk[P] = { text: "theirs", hash: "h2" };
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("conflict"));
    // Well inside the 500 ms Session debounce.
    await act(() => new Promise((res) => setTimeout(res, 50)));
    expect(
      s.writeSession.mock.calls.some(([json]) =>
        json.includes('"held":"conflict"'),
      ),
    ).toBe(true);
  });
});

describe("useFiles unsaved Files (manual save)", () => {
  const unsavedTab = (over: Partial<FileInfo> = {}) =>
    fileTab("f", P, { unsaved: true, ...over });

  it("hasPending counts an unsaved File that isn't loaded", async () => {
    shadows.f = "mine";
    s.readSession.mockResolvedValue(
      sessionJson([newTabState("a"), unsavedTab()]),
    );
    const { result } = await mount(false);
    expect(fileTabOf(result)!.file!.unsaved).toBe(true);
    expect(result.current.hasPending("f")).toBe(true);
  });

  it("restores an unsaved File's text from its shadow and keeps it unsaved", async () => {
    shadows.f = "mine";
    s.readSession.mockResolvedValue(
      sessionJson([newTabState("a"), unsavedTab()]),
    );
    const { result } = await mount(false);
    expect(await result.current.loadContent("f")).toBe("mine");
    const file = fileTabOf(result)!.file!;
    expect(file.unsaved).toBe(true);
    expect(file.held).toBeNull();
    expect(result.current.hasPending("f")).toBe(true);
    // Typing back to the disk's text leaves nothing unsaved.
    act(() => result.current.setContent("f", "{}"));
    await settle();
    expect(fileTabOf(result)!.file!.unsaved).toBeUndefined();
    expect(shadows.f).toBeUndefined();
    expect(f.fileWrite).not.toHaveBeenCalled();
  });

  it("restores an unsaved File as a conflict when the disk changed while closed", async () => {
    shadows.f = "mine";
    disk[P] = { text: "theirs", hash: "b" };
    s.readSession.mockResolvedValue(
      sessionJson([newTabState("a"), unsavedTab({ fingerprint: fp("a") })]),
    );
    const { result } = await mount(false);
    expect(await result.current.loadContent("f")).toBe("mine");
    expect(fileTabOf(result)!.file!.held).toBe("conflict");
    expect(shadows.f).toBe("mine");
    expect(disk[P].text).toBe("theirs");
  });

  it("restores an unsaved File as Missing when its File is gone", async () => {
    shadows.f = "mine";
    delete disk[P];
    s.readSession.mockResolvedValue(
      sessionJson([newTabState("a"), unsavedTab()]),
    );
    const { result } = await mount(false);
    expect(await result.current.loadContent("f")).toBe("mine");
    expect(fileTabOf(result)!.file!.held).toBe("missing");
    expect(shadows.f).toBe("mine");
  });

  it("an unsaved File without a shadow reads its File", async () => {
    s.readSession.mockResolvedValue(
      sessionJson([newTabState("a"), unsavedTab()]),
    );
    const { result } = await mount(false);
    expect(await result.current.loadContent("f")).toBe("{}");
    expect(fileTabOf(result)!.file!.unsaved).toBeUndefined();
    expect(result.current.hasPending("f")).toBe(false);
  });

  it("an orphaned shadow on an unchanged File restores as unsaved, not a conflict", async () => {
    // A crash between the shadow write and the Session save that marks it.
    shadows.f = "mine";
    s.readSession.mockResolvedValue(
      sessionJson([newTabState("a"), fileTab("f", P)]),
    );
    const { result } = await mount(false);
    const file = fileTabOf(result)!.file!;
    expect(file.held).toBeNull();
    expect(file.unsaved).toBe(true);
    expect(await result.current.loadContent("f")).toBe("mine");
    expect(shadows.f).toBe("mine");
  });

  it("a disk change to an unsaved File becomes a Disk conflict", async () => {
    const { result } = await mount(false);
    const id = await openP(result);
    act(() => result.current.setContent(id, "mine"));
    await settle();
    expect(fileTabOf(result)!.file!.unsaved).toBe(true);
    disk[P] = { text: "theirs", hash: "h2" };
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("conflict"));
    expect(await result.current.loadContent(id)).toBe("mine");
    expect(shadows[id]).toBe("mine");
    expect(disk[P].text).toBe("theirs");
  });

  it("a disk change to an unsaved Convert (text as on disk) is a Disk conflict", async () => {
    shadows.f = "{}";
    s.readSession.mockResolvedValue(
      sessionJson([
        newTabState("a"),
        unsavedTab({ format: { ...FMT, lineEnding: "crlf" }, diskFormat: FMT }),
      ]),
    );
    const { result } = await mount(false);
    expect(await result.current.loadContent("f")).toBe("{}");
    expect(fileTabOf(result)!.file!.held).toBeNull();
    disk[P] = { text: "theirs", hash: "h2" };
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("conflict"));
    expect(await result.current.loadContent("f")).toBe("{}");
    expect(shadows.f).toBe("{}");
  });

  it("Load disk version on an unsaved File drops the shadow and clears unsaved", async () => {
    const { result } = await mount(false);
    const id = await openP(result);
    act(() => result.current.setContent(id, "mine"));
    await settle();
    expect(shadows[id]).toBe("mine");
    await act(() => result.current.loadDiskVersion(id));
    expect(await result.current.loadContent(id)).toBe("{}");
    expect(fileTabOf(result)!.file!.unsaved).toBeUndefined();
    expect(shadows[id]).toBeUndefined();
    expect(result.current.hasPending(id)).toBe(false);
  });

  // Closing one asks first (see "useFiles close prompt"); an unsaved entry
  // still comes from a Session saved by an earlier version.
  const unsavedEntry = (): ClosedEntry => ({
    tab: unsavedTab(),
    index: 1,
    closedAt: Date.now(),
  });

  it("reopening an unsaved Recently Closed File restores its shadow", async () => {
    shadows.f = "mine";
    s.readSession.mockResolvedValue(
      sessionJson([newTabState("a")], [unsavedEntry()]),
    );
    const { result } = await mount(false);
    const id = "f";
    await act(() => result.current.reopenEntry(id));
    expect(await result.current.loadContent(id)).toBe("mine");
    expect(fileTabOf(result)!.file!.unsaved).toBe(true);
    expect(fileTabOf(result)!.file!.held).toBeNull();
    // The disk's text is known again: typing back to it leaves nothing unsaved.
    act(() => result.current.setContent(id, "{}"));
    await settle();
    expect(fileTabOf(result)!.file!.unsaved).toBeUndefined();
    expect(shadows[id]).toBeUndefined();
  });

  it("reopening an unsaved File whose disk changed is a conflict", async () => {
    shadows.f = "mine";
    s.readSession.mockResolvedValue(
      sessionJson([newTabState("a")], [unsavedEntry()]),
    );
    const { result } = await mount(false);
    const id = "f";
    disk[P] = { text: "theirs", hash: "h2" };
    await act(() => result.current.reopenEntry(id));
    expect(fileTabOf(result)!.file!.held).toBe("conflict");
    expect(await result.current.loadContent(id)).toBe("mine");
    expect(shadows[id]).toBe("mine");
  });

  it("Save As of an unsaved File drops its shadow", async () => {
    const { result } = await mount(false);
    const id = await openP(result);
    act(() => result.current.setContent(id, "mine"));
    await settle();
    expect(shadows[id]).toBe("mine");
    f.filePickSave.mockResolvedValue(Q);
    await act(() => result.current.saveAs(id));
    expect(disk[Q].text).toBe("mine");
    expect(fileTabOf(result, Q)!.file!.unsaved).toBeUndefined();
    expect(shadows[id]).toBeUndefined();
  });
});

describe("useFiles cheap focus re-checks (final fix M6)", () => {
  it("a focus re-check asks for the quick fingerprint; watcher events hash", async () => {
    const { result } = await mount();
    const id = await openP(result);
    f.fileFingerprint.mockClear();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(f.fileFingerprintQuick).toHaveBeenCalledWith(P, fp("h1")),
    );
    expect(f.fileFingerprint).not.toHaveBeenCalled();
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await waitFor(() => expect(f.fileFingerprint).toHaveBeenCalledWith(P));
    // Writes still always check the full hash in Rust (file_write).
    act(() => result.current.setContent(id, "typed"));
    await settle();
    expect(f.fileWrite).toHaveBeenLastCalledWith(P, "typed", FMT, fp("h1"));
  });

  it("a focus re-check still sees a change with a new time or size", async () => {
    const { result } = await mount();
    const id = await openP(result);
    disk[P] = { text: "changed", hash: "h2" };
    // The test fingerprints share one time and size: make this one differ.
    f.fileFingerprintQuick.mockResolvedValueOnce({
      mtimeMs: 2,
      size: 7,
      hash: "h2",
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(async () =>
      expect(await result.current.loadContent(id)).toBe("changed"),
    );
  });
});

describe("useFiles when Rust can't check the Session's Files (final fix M3)", () => {
  const SUSPENDED =
    "Can't check the open files: tabs aren't remembered until it can";

  it("asks again once, and keeps the Tabs when that works", async () => {
    f.grantsFilter.mockRejectedValueOnce(new Error("ipc"));
    s.readSession.mockResolvedValue(
      sessionJson([fileTab("f", P), newTabState("a")]),
    );
    const { result } = await mount();
    expect(f.grantsFilter).toHaveBeenCalledTimes(2);
    expect(fileTabOf(result)).toBeDefined();
    await waitFor(() => expect(s.writeSession).toHaveBeenCalled());
  });

  it("keeps the Tabs and saves no Session until a later check works", async () => {
    f.grantsFilter.mockRejectedValue(new Error("ipc"));
    s.readSession.mockResolvedValue(
      sessionJson([fileTab("f", P), fileTab("g", Q), newTabState("a")]),
    );
    const { result } = await mount();
    expect(f.grantsFilter).toHaveBeenCalledTimes(2);
    expect(fileTabOf(result)).toBeDefined();
    expect(fileTabOf(result, Q)).toBeDefined();
    await waitFor(() => expect(result.current.notice).toBe(SUSPENDED));
    await act(() => result.current.run({ type: "newTab" }));
    await act(() => new Promise((res) => setTimeout(res, 600)));
    expect(s.writeSession).not.toHaveBeenCalled();
    // A later check works: what isn't granted goes, and saving resumes.
    f.grantsFilter.mockReset();
    f.grantsFilter.mockResolvedValue([P]);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(s.writeSession).toHaveBeenCalled());
    expect(f.grantsFilter).toHaveBeenCalledWith([P, Q]);
    expect(fileTabOf(result)).toBeDefined();
    expect(fileTabOf(result, Q)).toBeUndefined();
    const calls = s.writeSession.mock.calls;
    const saved = calls[calls.length - 1][0];
    expect(saved).toContain("A.json");
    expect(saved).not.toContain("notes.txt");
  });
});

describe("useFiles small fixes (final wave)", () => {
  it("reopens a Recently Closed entry by its id, whatever its position", async () => {
    disk[Q] = { text: "q", hash: "hq" };
    const { result } = await mount();
    const p = await openP(result);
    const q = await openP(result, Q);
    await act(() => result.current.closeTab(p));
    await act(() => result.current.closeTab(q));
    // Newest first: q, then p. A stale index 0 would have opened q.
    expect(result.current.state.closed.map((e) => e.tab.id)).toEqual([q, p]);
    await act(() => result.current.reopenEntry(p));
    expect(fileTabOf(result)?.id).toBe(p);
    expect(fileTabOf(result, Q)).toBeUndefined();
    await act(() => result.current.reopenEntry("no such entry"));
    expect(result.current.state.closed.map((e) => e.tab.id)).toEqual([q]);
    // Mod+Shift+T still reopens the newest.
    await act(() => result.current.run({ type: "reopenTab" }));
    expect(fileTabOf(result, Q)?.id).toBe(q);
  });

  it("reordering Tabs doesn't rebuild the watcher", async () => {
    disk[Q] = { text: "q", hash: "hq" };
    const { result } = await mount();
    const p = await openP(result);
    await openP(result, Q);
    await waitFor(() => expect(f.fileWatch).toHaveBeenLastCalledWith([P, Q]));
    f.fileWatch.mockClear();
    act(() => result.current.moveTab(p, result.current.state.tabs.length - 1));
    await act(() => new Promise((res) => setTimeout(res, 20)));
    expect(f.fileWatch).not.toHaveBeenCalled();
  });

  it("a replace's echo from the editor schedules no write and isn't pending", async () => {
    const { result } = await mount();
    const id = await openP(result);
    disk[P] = { text: "reloaded", hash: "h2" };
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await waitFor(() =>
      expect(result.current.replaceRequests).toContainEqual(
        expect.objectContaining({ id, text: "reloaded" }),
      ),
    );
    // The editor applies the replace and reports the text back.
    act(() => result.current.setContent(id, "reloaded"));
    expect(result.current.hasPending(id)).toBe(false);
    await settle();
    expect(f.fileWrite).not.toHaveBeenCalled();
    expect(fileTabOf(result)!.file!.held).toBeNull();
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
    expect(s.writeScratchpad).not.toHaveBeenCalledWith("a", "alpha 2", "txt");
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
    await act(() => result.current.reopenEntry("f"));
    expect(result.current.state.closed).toHaveLength(1);
    f.shadowRead.mockImplementation(async (id) => shadows[id] ?? null);
    await act(() => result.current.reopenEntry("f"));
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
      "renameExtension",
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
    const quick = f.fileFingerprintQuick.getMockImplementation()!;
    f.fileFingerprintQuick.mockImplementationOnce(async (path, expected) => {
      await g.promise;
      return quick(path, expected);
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(f.fileFingerprintQuick).toHaveBeenCalled());
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

describe("useFiles and a pending rich edit", () => {
  /**
   * A rich editor holding an edit not yet written: its flush writes it
   * through the editor's change path (setContent), as the bridge does.
   */
  function richEdit(r: Result, id: string, text: string) {
    let pending = true;
    const flush = vi.fn(() => {
      if (!pending) return;
      pending = false;
      r.current.setContent(id, text);
    });
    const off = r.current.registerRich(id, { pending: () => pending, flush });
    return { flush, off };
  }

  it("reload_during_a_pending_rich_edit_is_a_conflict", async () => {
    const { result } = await mount();
    const id = await openP(result);
    const rich = richEdit(result, id, "mine");
    expect(result.current.hasPending(id)).toBe(true);
    disk[P] = { text: "theirs", hash: "h2" };
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("conflict"));
    // Held: the edit landed first and is kept aside, not reloaded over.
    expect(rich.flush).toHaveBeenCalled();
    await settle();
    expect(shadows[id]).toBe("mine");
    expect(disk[P].text).toBe("theirs");
    expect(await result.current.loadContent(id)).toBe("mine");
  });

  it("exit_flush_writes_a_pending_rich_edit", async () => {
    const { result } = await mount();
    const id = await openP(result);
    richEdit(result, id, "mine");
    await act(() => h.flushAll!());
    expect(disk[P].text).toBe("mine");
  });

  it("closing_a_tab_writes_its_pending_rich_edit", async () => {
    const { result } = await mount();
    const id = await openP(result);
    const rich = richEdit(result, id, "mine");
    await act(() => result.current.closeTab(id));
    expect(rich.flush).toHaveBeenCalled();
    expect(disk[P].text).toBe("mine");
    expect(fileTabOf(result)).toBeUndefined();
  });

  it("typing_in_rich_during_a_reloads_read_becomes_a_conflict", async () => {
    const { result } = await mount();
    const id = await openP(result);
    // Rich has nothing pending when the reload is decided.
    let pending = false;
    const flush = vi.fn(() => {
      if (!pending) return;
      pending = false;
      result.current.setContent(id, "mine");
    });
    result.current.registerRich(id, { pending: () => pending, flush });
    const g = gate();
    const read = f.fileRead.getMockImplementation()!;
    f.fileRead.mockImplementationOnce(async (path) => {
      await g.promise;
      return read(path);
    });
    disk[P] = { text: "theirs", hash: "h2" };
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await waitFor(() => expect(f.fileRead).toHaveBeenCalledTimes(2));
    // Typed in Rich while the disk is read: pending, not yet in contents.
    pending = true;
    g.open();
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("conflict"));
    expect(flush).toHaveBeenCalled();
    await settle();
    expect(shadows[id]).toBe("mine");
    expect(disk[P].text).toBe("theirs");
    expect(await result.current.loadContent(id)).toBe("mine");
    expect(result.current.replaceRequests).not.toContainEqual(
      expect.objectContaining({ id, text: "theirs" }),
    );
  });

  it("a_rich_conflict_holds_the_file_with_the_edit_as_mine", async () => {
    const { result } = await mount();
    const id = await openP(result);
    const rich = richEdit(result, id, "mine");
    act(() => result.current.richConflict(id));
    expect(fileTabOf(result)!.file!.held).toBe("conflict");
    expect(rich.flush).toHaveBeenCalled();
    await settle();
    expect(shadows[id]).toBe("mine");
    expect(disk[P].text).toBe("{}");
  });

  it("an_unregistered_rich_editor_is_forgotten", async () => {
    const { result } = await mount();
    const id = await openP(result);
    const rich = richEdit(result, id, "mine");
    rich.off();
    expect(result.current.hasPending(id)).toBe(false);
  });
});

describe("useFiles close prompt", () => {
  /** Starts closing `ids` (closeTabs) and waits for the prompt to show. */
  async function startClose(r: Result, ids: string[]) {
    let closed!: Promise<void>;
    act(() => {
      closed = r.current.closeTabs(ids);
    });
    await waitFor(() => expect(r.current.closePrompt).not.toBeNull());
    // Wrapped: an async function returning the promise would wait for it.
    return { closed };
  }

  async function unsavedP() {
    const { result } = await mount(false);
    const id = await openP(result);
    act(() => result.current.setContent(id, "mine"));
    await settle();
    expect(fileTabOf(result)!.file!.unsaved).toBe(true);
    return { result, id };
  }

  it("prompts before closing an unsaved File and keeps it open on cancel", async () => {
    const { result, id } = await unsavedP();
    let closed!: Promise<void>;
    act(() => {
      closed = result.current.closeTab(id);
    });
    await waitFor(() =>
      expect(result.current.closePrompt).toEqual({ id, name: "A.json" }),
    );
    expect(result.current.isClosing(id)).toBe(false);
    act(() => result.current.answerClosePrompt("cancel"));
    await act(() => closed);
    expect(result.current.closePrompt).toBeNull();
    expect(fileTabOf(result)?.id).toBe(id);
    expect(fileTabOf(result)!.file!.unsaved).toBe(true);
    expect(shadows[id]).toBe("mine");
    expect(result.current.state.closed).toEqual([]);
    expect(f.fileWrite).not.toHaveBeenCalled();
  });

  it("don't save closes and drops the shadow", async () => {
    const { result, id } = await unsavedP();
    const { closed } = await startClose(result, [id]);
    act(() => result.current.answerClosePrompt("discard"));
    await act(() => closed);
    expect(fileTabOf(result)).toBeUndefined();
    expect(shadows[id]).toBeUndefined();
    expect(f.fileWrite).not.toHaveBeenCalled();
    expect(disk[P].text).toBe("{}");
    // The Recently Closed entry reopens from disk.
    const entry = result.current.state.closed[0];
    expect(entry.tab.id).toBe(id);
    expect(entry.tab.file?.unsaved).toBeUndefined();
    await act(() => result.current.reopenEntry(id));
    expect(await result.current.loadContent(id)).toBe("{}");
    expect(fileTabOf(result)!.file!.unsaved).toBeUndefined();
    expect(result.current.hasPending(id)).toBe(false);
    expect(shadows[id]).toBeUndefined();
  });

  it("don't save drops an unsaved Convert too", async () => {
    const { result } = await mount(false);
    const id = await openP(result);
    await act(() => result.current.loadContent(id));
    const crlf = { ...FMT, lineEnding: "crlf" as const };
    const file = fileTabOf(result)!.file!;
    act(() =>
      result.current.updateTab(id, { file: { ...file, format: crlf } }),
    );
    await settle();
    expect(fileTabOf(result)!.file!.diskFormat).toEqual(FMT);
    const { closed } = await startClose(result, [id]);
    act(() => result.current.answerClosePrompt("discard"));
    await act(() => closed);
    const entry = result.current.state.closed[0].tab.file!;
    expect(entry.format).toEqual(FMT);
    expect(entry.diskFormat).toBeUndefined();
    expect(entry.unsaved).toBeUndefined();
    expect(shadows[id]).toBeUndefined();
    expect(f.fileWrite).not.toHaveBeenCalled();
  });

  it("save then closes", async () => {
    const { result, id } = await unsavedP();
    const { closed } = await startClose(result, [id]);
    act(() => result.current.answerClosePrompt("save"));
    await act(() => closed);
    expect(disk[P].text).toBe("mine");
    expect(fileTabOf(result)).toBeUndefined();
    expect(shadows[id]).toBeUndefined();
    expect(result.current.state.closed[0].tab.file?.unsaved).toBeUndefined();
  });

  it("a save that ends in a Disk conflict keeps the Tab open", async () => {
    const { result, id } = await unsavedP();
    disk[P] = { text: "theirs", hash: "h2" };
    const { closed } = await startClose(result, [id]);
    act(() => result.current.answerClosePrompt("save"));
    await act(() => closed);
    expect(fileTabOf(result)!.file!.held).toBe("conflict");
    expect(disk[P].text).toBe("theirs");
    expect(shadows[id]).toBe("mine");
    expect(result.current.state.closed).toEqual([]);
  });

  it("prompts when an edit has not reached the shadow yet", async () => {
    const { result } = await mount(false);
    const id = await openP(result);
    await act(() => result.current.loadContent(id));
    vi.useFakeTimers();
    act(() => result.current.setContent(id, "typed"));
    let closed!: Promise<void>;
    act(() => {
      closed = result.current.closeTab(id);
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.closePrompt).toEqual({ id, name: "A.json" });
    // The 300 ms debounce hasn't run: nothing is in the shadow yet.
    expect(fileTabOf(result)!.file!.unsaved).toBeUndefined();
    expect(shadows[id]).toBeUndefined();
    act(() => result.current.answerClosePrompt("discard"));
    await act(() => closed);
    expect(fileTabOf(result)).toBeUndefined();
    expect(shadows[id]).toBeUndefined();
    expect(f.fileWrite).not.toHaveBeenCalled();
  });

  it("cancel stops the remaining closes", async () => {
    disk[Q] = { text: "q", hash: "q1" };
    const { result } = await mount(false);
    const a = await openP(result);
    const b = await openP(result, Q);
    act(() => result.current.setContent(a, "A2"));
    act(() => result.current.setContent(b, "B2"));
    await settle();
    const { closed } = await startClose(result, [a, b]);
    expect(result.current.closePrompt).toEqual({ id: a, name: "A.json" });
    act(() => result.current.answerClosePrompt("cancel"));
    await act(() => closed);
    expect(result.current.closePrompt).toBeNull();
    expect(fileTabOf(result)?.id).toBe(a);
    expect(fileTabOf(result, Q)?.id).toBe(b);
    expect(result.current.state.closed).toEqual([]);
  });

  it("asks once per unsaved Tab, in order, when closing several", async () => {
    disk[Q] = { text: "q", hash: "q1" };
    const { result } = await mount(false);
    const a = await openP(result);
    const b = await openP(result, Q);
    act(() => result.current.setContent(a, "A2"));
    act(() => result.current.setContent(b, "B2"));
    await settle();
    const { closed } = await startClose(result, [a, b]);
    act(() => result.current.answerClosePrompt("save"));
    await waitFor(() =>
      expect(result.current.closePrompt).toEqual({ id: b, name: "notes.txt" }),
    );
    act(() => result.current.answerClosePrompt("discard"));
    await act(() => closed);
    expect(disk[P].text).toBe("A2");
    expect(disk[Q].text).toBe("q");
    expect(result.current.state.closed.map((e) => e.tab.id)).toEqual([b, a]);
  });

  it("never prompts for a held Tab or a Scratchpad", async () => {
    const { result } = await mount(false);
    const id = await openP(result);
    act(() => result.current.setContent(id, "mine"));
    disk[P] = { text: "theirs", hash: "h2" };
    act(() => h.fileChanged!({ path: P, kind: "changed" }));
    await waitFor(() => expect(fileTabOf(result)!.file!.held).toBe("conflict"));
    act(() => result.current.setContent("a", "alpha!"));
    // A prompt would never be answered: this would not resolve.
    await act(() => result.current.closeTabs([id, "a"]));
    expect(result.current.closePrompt).toBeNull();
    expect(result.current.state.closed.map((e) => e.tab.id)).toEqual(["a", id]);
    expect(result.current.state.closed[1].tab.file?.held).toBe("conflict");
    expect(shadows[id]).toBe("mine");
    expect(scratch.a).toBe("alpha!");
  });

  it("an unsaved File whose disk changed while closed closes as a conflict, unasked", async () => {
    shadows.f = "mine";
    disk[P] = { text: "theirs", hash: "b" };
    s.readSession.mockResolvedValue(
      sessionJson([newTabState("a"), fileTab("f", P, { unsaved: true })]),
    );
    const { result } = await mount(false);
    await act(() => result.current.closeTab("f"));
    expect(result.current.closePrompt).toBeNull();
    expect(result.current.state.closed[0].tab.file?.held).toBe("conflict");
    expect(shadows.f).toBe("mine");
  });

  it("with autosave on, closing right after typing writes the File unasked", async () => {
    const { result } = await mount(true);
    const id = await openP(result);
    act(() => result.current.setContent(id, "typed"));
    await act(() => result.current.closeTab(id));
    expect(result.current.closePrompt).toBeNull();
    expect(disk[P].text).toBe("typed");
  });

  it("quitting never prompts", async () => {
    const { result } = await mount(false);
    const id = await openP(result);
    act(() => result.current.setContent(id, "mine"));
    await act(() => h.flushAll!());
    expect(result.current.closePrompt).toBeNull();
    expect(shadows[id]).toBe("mine");
    expect(fileTabOf(result)!.file!.unsaved).toBe(true);
    expect(f.fileWrite).not.toHaveBeenCalled();
  });
});
