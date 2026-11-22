import { useCallback, useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { detectPlatform, type Command } from "./shortcuts";
import {
  fileFingerprint,
  fileWrite,
  grantsFilter,
  pathKey,
  shadowDelete,
  shadowWrite,
} from "../files/api";
import { createDocumentWriter, type WriteMode } from "../files/documentWriter";
import { BEFORE_EXIT_EVENT } from "./exit";
import { createKeyedLock } from "./keyedLock";
import { useFiles, type FilesApi } from "./files";
import {
  filePathsOf,
  logError,
  restoreSession,
  useCombinedSaveStatus,
  useExitHandshake,
  useFlushOnBlur,
  useWindowTitle,
} from "./workspaceEffects";
import type {
  FileFormat,
  SidebarState,
  SplitOrientation,
  TabState,
  WorkspaceState,
} from "../model/types";
import type { FindRequest } from "../find/findExtension";
import * as ws from "../model/workspace";
import * as sp from "../model/split";
import { touchRecent } from "../model/recent";
import { deriveTitle } from "../model/title";
import {
  clampFontSize,
  clampSidebarWidth,
  DEFAULT_FONT_SIZE,
  defaultSidebar,
  toSessionFile,
} from "../model/session";
import { focusSidebar as focusSidebarElement } from "../ui/Sidebar";
import type { CloseChoice } from "../ui/SaveChangesDialog";
import { DEFAULT_SETTINGS, type Settings } from "../model/settings";
import type { FileInfo, MarkdownMode, PreviewMode } from "../model/types";
import { inShadow } from "../files/fileState";
import { baseName } from "../files/paths";
import {
  CANT_KEEP_NOTICE,
  TOO_LARGE_NOTICE,
  effectiveMode,
  tooLargeForRich,
} from "../model/markdownMode";
import type { TextBridge } from "../editor/EditorHost";
import type { RichSync } from "../rich/RichEditor";
import { useLibrary, type LibraryApi } from "./useLibrary";
import {
  closeScratchpad,
  deleteScratchpad,
  startupMark,
  writeScratchpad,
} from "../storage/api";
import {
  SESSION_ID,
  createSaver,
  sessionSaver,
  type SaveStatus,
} from "../storage/autosave";

const EMPTY: WorkspaceState = { tabs: [], activeId: "", closed: [] };
/** How often a failed check of the Session's Files is tried again. */
export const GRANTS_RETRY_MS = 5000;
export const SESSION_SUSPENDED_NOTICE =
  "Can't check the open files: tabs aren't remembered until it can";

/** True if any Tab or Recently Closed entry changed whether it is held. */
function heldChanged(a: WorkspaceState, b: WorkspaceState): boolean {
  if (a.tabs === b.tabs && a.closed === b.closed) return false;
  const held = (s: WorkspaceState) => {
    const m = new Map<string, string>();
    // A pending Convert (diskFormat) is in the Session too.
    const key = (f: FileInfo) =>
      `${f.held}:${inShadow(f)}:${f.diskFormat !== undefined}`;
    for (const t of s.tabs) if (t.file) m.set(t.id, key(t.file));
    for (const e of s.closed) {
      if (e.tab.file) m.set(`closed:${e.tab.id}`, key(e.tab.file));
    }
    return m;
  };
  const x = held(a);
  const y = held(b);
  for (const [k, v] of y) if (x.has(k) && x.get(k) !== v) return true;
  return false;
}
const freshId = (): string => crypto.randomUUID();

const sameSidebar = (a: SidebarState, b: SidebarState) =>
  a.open === b.open &&
  a.width === b.width &&
  a.expanded.length === b.expanded.length &&
  a.expanded.every((p, i) => p === b.expanded[i]) &&
  a.recent.length === b.recent.length &&
  a.recent.every((id, i) => id === b.recent[i]);

const platform = detectPlatform();
const keyOf = (p: string) => pathKey(p, platform);
/** New Files: UTF-8, no BOM, the platform Line ending. */
const NEW_FILE: FileFormat = {
  encoding: "utf-8",
  bom: false,
  lineEnding: platform === "windows" ? "crlf" : "lf",
  mixed: false,
};

/** The close prompt on screen: the File Tab it asks about. */
export interface ClosePrompt {
  id: string;
  name: string;
}

export interface Workspace extends FilesApi {
  state: WorkspaceState;
  loadContent(id: string): Promise<string>;
  setContent(id: string, text: string): void;
  /** A `file` patch changes only the format (a Convert), which is then written. */
  updateTab(id: string, patch: Partial<TabState>): void;
  run(cmd: Command): Promise<void>;
  /** Tab bar actions that target a specific Tab. */
  activate(id: string): void;
  closeTab(id: string): Promise<void>;
  /** Closes in order; the first Cancel on a close prompt stops the rest. */
  closeTabs(ids: string[]): Promise<void>;
  /** Asking whether to save a File Tab's Unsaved changes before it closes. */
  closePrompt: ClosePrompt | null;
  answerClosePrompt(choice: CloseChoice): void;
  moveTab(id: string, toIndex: number): void;
  rename(id: string, name: string): Promise<void>;
  /** True while a close is in progress; the editor should be read-only. */
  isClosing(id: string): boolean;
  /** The latest Mod+F / Mod+H request; `seq` changes on every press. */
  findRequest: FindRequest | null;
  saveStatus: SaveStatus;
  ready: boolean;
  /** The Library sidebar's contents and operations. */
  library: LibraryApi;
  /** Open, width and expanded folders; saved in the Session. */
  sidebar: SidebarState;
  setSidebarWidth(w: number): void;
  toggleSidebar(): void;
  /** Opens the sidebar if needed and puts the keyboard in its tree. */
  focusSidebar(): void;
  /** A new Canvas Scratchpad (Mod+Shift+N). */
  newCanvas(): void;
  /** The editor's text size in px, for every text Tab; saved in the Session. */
  fontSize: number;
  /** 1 bigger, -1 smaller, 0 back to the default (Mod+wheel, Mod+=/-/0). */
  zoomEditor(dir: 1 | -1 | 0): void;
  /** Pins or unpins a Tab, open or in Recently Closed. */
  setPinned(id: string, pinned: boolean): void;
  /** Sets the editor's text size (clamped to 8–40 px). */
  setFontSize(px: number): void;
  /** Theme, word wrap for new Tabs, line numbers; saved in the Session. */
  settings: Settings;
  setSettings(patch: Partial<Settings>): void;
  /** A Markdown Tab's preview: beside the editor, alone, or off (null). */
  setPreview(id: string, mode: PreviewMode | null): void;
  /**
   * A Markdown Tab's editor. Rich is refused (with a notice) for a note too
   * large for it; leaving Rich starts the plain editor's undo afresh.
   */
  setMarkdownMode(id: string, mode: MarkdownMode): Promise<void>;
  /** The rich editor couldn't show the Tab: Markdown, with `notice`. */
  richFallback(id: string, notice: string): void;
  /** The editor host's text bridge, once it has handed it over. */
  bridge: TextBridge | null;
  /** Give to the editor host (stable). */
  bridgeRef(b: TextBridge | null): void;
  /**
   * A rich editor's edit not yet written counts as pending, and is written
   * first on close, exit, window blur and a Tab becoming held. Returns the
   * unregister.
   */
  registerRich(id: string, sync: RichSync): () => void;
  /**
   * The Tab's text changed while its rich edit was pending: a File is held
   * as a Disk conflict, with the edit (written as the hold starts) as mine.
   */
  richConflict(id: string): void;
  /** Joins Tab `b` to Tab `a` in a Split (a no-op if either is in one). */
  splitWith(a: string, b: string, orientation?: SplitOrientation): void;
  /** Ends the Split holding `id`; both Tabs stay open. */
  unsplit(id: string): void;
  swapSplit(id: string): void;
  setSplitOrientation(id: string, o: SplitOrientation): void;
  setSplitRatio(id: string, r: number): void;
  /** Closes both Tabs of the Split holding `id`. */
  closeSplit(id: string): Promise<void>;
}

export function useWorkspace(): Workspace {
  const [state, setState] = useState<WorkspaceState>(EMPTY);
  const [ready, setReady] = useState(false);
  const [findRequest, setFindRequest] = useState<FindRequest | null>(null);
  const [grantsUnchecked, setGrantsUnchecked] = useState(false);
  const [sidebar, setSidebar] = useState<SidebarState>(defaultSidebar);
  const sidebarRef = useRef(sidebar);
  const [fontSize, setFontSizeState] = useState(DEFAULT_FONT_SIZE);
  const fontSizeRef = useRef(fontSize);
  const [settings, setSettingsState] = useState<Settings>(() => ({
    ...DEFAULT_SETTINGS,
  }));
  const settingsRef = useRef(settings);
  // Contents live in a map: async commands need the latest, and typing must
  // not re-render the App.
  const stateRef = useRef(state);
  /** The Tab active just before (not saved): Mod+\ pairs with it. */
  const previousActiveRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const [contents] = useState(() => new Map<string, string>());
  /** Text known to be on disk per id (last loaded or successfully written). */
  const [onDisk] = useState(() => new Map<string, string>());
  const closing = useRef(new Set<string>());
  const [closingIds, setClosingIds] = useState<ReadonlySet<string>>(new Set());
  /** Close/reopen operations in flight; exit waits for them. */
  const inFlight = useRef(new Set<Promise<void>>());

  /**
   * True while Rust couldn't say which Session Files are granted: the Tabs
   * are kept, but no Session is written (session_write could refuse it, and
   * then nothing could quit) until a later check succeeds.
   */
  const sessionSuspended = useRef(false);

  const scheduleSession = useCallback(() => {
    if (sessionSuspended.current) return;
    sessionSaver.schedule(SESSION_ID, () =>
      JSON.stringify(
        toSessionFile(
          stateRef.current,
          sidebarRef.current,
          fontSizeRef.current,
          settingsRef.current,
        ),
      ),
    );
  }, []);

  /** Write session.json now, so it agrees with a file just moved on disk. */
  const saveSessionNow = useCallback(async () => {
    scheduleSession();
    await sessionSaver.flush(SESSION_ID).catch(logError("save session"));
  }, [scheduleSession]);

  /**
   * Every state change goes through here so async code sees it at once. A
   * Tab becoming held or released saves the Session at once: its shadow and
   * session.json must agree if Zukai stops right after.
   */
  /** Each shown rich editor's pending edit, by Tab id. */
  const [richSyncs] = useState(() => new Map<string, RichSync>());
  /** Write a rich editor's pending edit now (every Tab's when no id). */
  const flushRich = useCallback(
    (id?: string) => {
      for (const [tid, sync] of richSyncs) {
        if (id !== undefined && tid !== id) continue;
        try {
          sync.flush();
        } catch (err) {
          logError("write rich edit")(err);
        }
      }
    },
    [richSyncs],
  );
  const registerRich = useCallback(
    (id: string, sync: RichSync) => {
      richSyncs.set(id, sync);
      return () => {
        if (richSyncs.get(id) === sync) richSyncs.delete(id);
      };
    },
    [richSyncs],
  );
  const richPending = useCallback(
    (id: string) => richSyncs.get(id)?.pending() ?? false,
    [richSyncs],
  );

  const commit = useCallback(
    (next: WorkspaceState) => {
      // A Tab about to be held (read-only, conflict, missing) takes its
      // rich edit first, while its text still accepts it.
      for (const t of next.tabs) {
        const was = stateRef.current.tabs.find((p) => p.id === t.id);
        if (was?.file && t.file && was.file.held !== t.file.held) {
          flushRich(t.id);
        }
      }
      const prev = stateRef.current;
      stateRef.current = next;
      // Moving focus within a Split doesn't change the "previous" Tab.
      const within = sp.splitOf(prev, prev.activeId);
      if (
        next.activeId !== prev.activeId &&
        prev.activeId &&
        next.tabs.some((t) => t.id === prev.activeId) &&
        !(within && sp.splitOf(prev, next.activeId) === within)
      ) {
        previousActiveRef.current = prev.activeId;
      }
      setState(next);
      if (readyRef.current && heldChanged(prev, next)) void saveSessionNow();
    },
    [saveSessionNow, flushRich],
  );

  const [keptShadows] = useState(() => new Set<string>());
  /** Per-Tab lock shared by autosave writes and File actions. */
  const [lock] = useState(createKeyedLock);
  /** The Saver's write: scratchpad, File or shadow (the writer is stateless). */
  const writeDoc = useCallback(
    (id: string, text: string, mode: WriteMode = "auto") =>
      lock(id, () =>
        createDocumentWriter({
          getTab: (tid) => stateRef.current.tabs.find((t) => t.id === tid),
          patchFile: (tid, file) =>
            commit(ws.updateTab(stateRef.current, tid, { file })),
          writeScratchpad,
          fileWrite,
          fileFingerprint,
          shadowWrite,
          shadowDelete,
          autosaveFiles: () => settingsRef.current.autosaveFiles,
          diskText: (tid) => onDisk.get(tid),
          // A Tab whose shadow is unread is never written (see useFiles).
          isUnreadable: (tid) => keptShadows.has(tid),
          // Never write text that isn't the Tab's: a defence for any path
          // that schedules a write before the text loaded.
          isLoaded: (tid) => contents.has(tid),
          onWritten: (tid, written) => onDisk.set(tid, written),
        })(id, text, mode),
      ),
    [commit, contents, keptShadows, lock, onDisk],
  );
  /**
   * An explicit save. Takes the Tab's lock, which is not re-entrant (work
   * under it waits for earlier work under the same key), so never call this
   * from code already holding that Tab's lock.
   */
  const saveNow = useCallback(
    (id: string, text: string) => writeDoc(id, text, "save"),
    [writeDoc],
  );
  // createSaver only stores writeDoc; refs are read when a write runs.
  // eslint-disable-next-line react-hooks/refs
  const [saver] = useState(() => createSaver(writeDoc));
  const [savers] = useState(() => [saver, sessionSaver]);

  const track = useCallback((p: Promise<void>): Promise<void> => {
    inFlight.current.add(p);
    void p.finally(() => inFlight.current.delete(p));
    return p;
  }, []);

  const settleInFlight = useCallback(async () => {
    while (inFlight.current.size > 0) {
      await Promise.allSettled([...inFlight.current]);
    }
  }, []);

  const saveStatus = useCombinedSaveStatus(savers);
  // Exit writes the rich editors' pending edits before the savers flush.
  const beforeExit = useCallback(async () => {
    flushRich();
    await settleInFlight();
  }, [flushRich, settleInFlight]);
  useExitHandshake(savers, beforeExit);
  useFlushOnBlur(savers, flushRich);

  const keepTitle = useCallback(
    (id: string, text: string) => {
      const tab = stateRef.current.tabs.find((t) => t.id === id);
      // A File's Title is its filename; a Canvas's text is JSON, no Title.
      if (!tab || tab.renamed || tab.file || tab.kind !== "text") return;
      const title = deriveTitle(text);
      if (title !== tab.title) {
        commit(ws.updateTab(stateRef.current, id, { title }));
      }
    },
    [commit],
  );

  const newTabWrap = useCallback(() => settingsRef.current.wrapNewTabs, []);
  const autosaveFiles = useCallback(
    () => settingsRef.current.autosaveFiles,
    [],
  );
  const files = useFiles({
    state,
    ready,
    stateRef,
    commit,
    contents,
    onDisk,
    saver,
    lock,
    saveNow,
    autosaveFiles,
    freshId,
    track,
    saveSessionNow,
    keepTitle,
    keyOf,
    newFileFormat: NEW_FILE,
    newTabWrap,
    keptShadows,
    closing,
    richPending,
  });
  const { internal, ...filesApi } = files;
  const { loadContent, afterRestore, closeFile } = internal;
  const patchTab = internal.updateTab;
  /** A new Language decides the Markdown editor afresh (the default). */
  const updateTab = useCallback(
    (id: string, patch: Partial<TabState>) => {
      const tab = stateRef.current.tabs.find((t) => t.id === id);
      const relanguage =
        patch.language !== undefined &&
        tab?.language !== patch.language &&
        !("markdownMode" in patch);
      patchTab(id, relanguage ? { ...patch, markdownMode: undefined } : patch);
    },
    [patchTab],
  );
  const { saveTo, rewriteTabPaths, recheckTabs } = internal;
  const { refuseEdit, discardUnsaved } = internal;
  const { renameFile, reopenEntry, pickAndOpen, save, saveAll, saveAs } = files;
  const { requestFormat, showNotice, hasPending } = files;

  const setContent = useCallback(
    (id: string, text: string) => {
      // The editor reports a reload's own text back: nothing new to write.
      if (contents.get(id) === text || refuseEdit(id)) return;
      contents.set(id, text);
      saver.schedule(id, () => contents.get(id) ?? text);
      keepTitle(id, text);
    },
    [contents, saver, keepTitle, refuseEdit],
  );

  const activate = useCallback(
    (id: string) => commit(ws.activate(stateRef.current, id)),
    [commit],
  );

  const splitWith = useCallback(
    (a: string, b: string, orientation?: SplitOrientation) =>
      commit(sp.makeSplit(stateRef.current, a, b, orientation)),
    [commit],
  );

  const unsplit = useCallback(
    (id: string) => commit(sp.unsplit(stateRef.current, id)),
    [commit],
  );

  const swapSplit = useCallback(
    (id: string) => commit(sp.swapSides(stateRef.current, id)),
    [commit],
  );

  const setSplitOrientation = useCallback(
    (id: string, o: SplitOrientation) =>
      commit(sp.setOrientation(stateRef.current, id, o)),
    [commit],
  );

  const setSplitRatio = useCallback(
    (id: string, r: number) =>
      commit(sp.setSplitRatio(stateRef.current, id, r)),
    [commit],
  );

  const moveTab = useCallback(
    (id: string, toIndex: number) =>
      commit(ws.moveTab(stateRef.current, id, toIndex)),
    [commit],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      // A File's name is its filename on disk.
      if (stateRef.current.tabs.find((t) => t.id === id)?.file) {
        await renameFile(id, name);
        return;
      }
      // An empty name falls back to the automatic Title, which needs the
      // text (a Canvas has none: it's "Untitled").
      const tab = stateRef.current.tabs.find((t) => t.id === id);
      const derived =
        tab?.kind === "text" ? deriveTitle(await loadContent(id)) : "Untitled";
      commit(ws.rename(stateRef.current, id, name, derived));
    },
    [commit, loadContent, renameFile],
  );

  const newTab = useCallback(() => {
    const id = freshId();
    contents.set(id, "");
    const next = ws.newTab(stateRef.current, id);
    const wrap = settingsRef.current.wrapNewTabs;
    commit(wrap ? ws.updateTab(next, id, { wrap }) : next);
  }, [commit, contents]);

  const newCanvas = useCallback(() => {
    const id = freshId();
    contents.set(id, "");
    commit(ws.newTab(stateRef.current, id, "canvas"));
  }, [commit, contents]);

  // --- The Library sidebar -------------------------------------------------

  const patchSidebar = useCallback((patch: Partial<SidebarState>) => {
    const next = { ...sidebarRef.current, ...patch };
    if (sameSidebar(sidebarRef.current, next)) return;
    sidebarRef.current = next;
    setSidebar(next);
  }, []);

  const setSidebarWidth = useCallback(
    (w: number) => patchSidebar({ width: clampSidebarWidth(w) }),
    [patchSidebar],
  );

  const toggleSidebar = useCallback(
    () => patchSidebar({ open: !sidebarRef.current.open }),
    [patchSidebar],
  );

  const setPinned = useCallback(
    (id: string, pinned: boolean) =>
      commit(ws.setPinned(stateRef.current, id, pinned)),
    [commit],
  );

  const setFontSize = useCallback((px: number) => {
    const next = clampFontSize(px);
    if (next === fontSizeRef.current) return;
    fontSizeRef.current = next;
    setFontSizeState(next);
  }, []);

  const zoomEditor = useCallback(
    (dir: 1 | -1 | 0) =>
      setFontSize(dir === 0 ? DEFAULT_FONT_SIZE : fontSizeRef.current + dir),
    [setFontSize],
  );

  const setPreview = useCallback(
    (id: string, mode: PreviewMode | null) =>
      commit(
        ws.updateTab(stateRef.current, id, { preview: mode ?? undefined }),
      ),
    [commit],
  );

  const [bridge, setBridge] = useState<TextBridge | null>(null);
  const bridgeRef = useRef<TextBridge | null>(null);
  const takeBridge = useCallback((b: TextBridge | null) => {
    bridgeRef.current = b;
    setBridge(b);
  }, []);

  /** The Tab's text, for the size check (loaded if it isn't yet). */
  const textOf = useCallback(
    async (id: string) => contents.get(id) ?? (await loadContent(id)),
    [contents, loadContent],
  );

  const setMarkdownMode = useCallback(
    async (id: string, mode: MarkdownMode) => {
      const tab = stateRef.current.tabs.find((t) => t.id === id);
      if (!tab) return;
      const was = effectiveMode(tab, settingsRef.current);
      if (was === null || was === mode) return;
      if (mode === "rich") {
        let text: string;
        try {
          text = await textOf(id);
        } catch (err) {
          logError("load for rich")(err);
          return;
        }
        if (tooLargeForRich(text)) {
          showNotice(TOO_LARGE_NOTICE);
          return;
        }
        // Lazy: the check is the rich editor's own (Milkdown).
        const { canKeep } = await import("../rich/richMarkdown");
        if (!(await canKeep(text))) {
          showNotice(CANT_KEEP_NOTICE);
          return;
        }
      } else {
        // Rich wrote outside the plain editor's history: its old entries no
        // longer line up.
        bridgeRef.current?.clearHistory(id);
      }
      commit(ws.updateTab(stateRef.current, id, { markdownMode: mode }));
    },
    [commit, showNotice, textOf],
  );

  const richFallback = useCallback(
    (id: string, notice: string) => {
      commit(ws.updateTab(stateRef.current, id, { markdownMode: "markdown" }));
      showNotice(notice);
    },
    [commit, showNotice],
  );

  const setSettings = useCallback((patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettingsState(next);
  }, []);

  const focusSidebar = useCallback(() => {
    patchSidebar({ open: true });
    // After the (possibly just opened) sidebar has rendered.
    requestAnimationFrame(() => focusSidebarElement());
  }, [patchSidebar]);

  const flushTabs = useCallback(
    async (ids: string[]) => {
      await Promise.all(ids.map((id) => saver.flush(id)));
    },
    [saver],
  );

  /** Every lock in one order (sorted), so two callers never deadlock. */
  const withTabsLocked = useCallback(
    <T>(ids: string[], work: () => Promise<T>): Promise<T> =>
      [...ids]
        .sort()
        .reduceRight<() => Promise<T>>(
          (inner, id) => () => lock(id, inner),
          work,
        )(),
    [lock],
  );

  const library = useLibrary({
    ready,
    state,
    stateRef,
    sidebar,
    sidebarRef,
    patchSidebar,
    keyOf,
    openPaths: files.openPaths,
    flushTabs,
    withTabsLocked,
    rewriteTabPaths,
    recheckTabs,
    saveAs,
    saveTo,
    showNotice,
    revealActive: settings.revealActiveFile,
  });
  const collapseLibrary = library.collapseAll;

  const setClosing = useCallback((id: string, on: boolean) => {
    if (on) closing.current.add(id);
    else closing.current.delete(id);
    setClosingIds(new Set(closing.current));
  }, []);

  const [closePrompt, setClosePrompt] = useState<ClosePrompt | null>(null);
  /** Resolves the open close prompt's wait. */
  const answerRef = useRef<((c: CloseChoice) => void) | null>(null);
  /** Close prompts take turns: only one is ever open. */
  const promptChain = useRef<Promise<unknown>>(Promise.resolve());

  const answerClosePrompt = useCallback((choice: CloseChoice) => {
    const answer = answerRef.current;
    answerRef.current = null;
    setClosePrompt(null);
    answer?.(choice);
  }, []);

  /**
   * Before a File Tab closes: if it has Unsaved changes, asks whether to
   * save them, then saves or discards them as answered. Resolves to false
   * when the Tab must stay open (Cancel, or a save that didn't write).
   * A held Tab never asks: its text stays in its shadow. Neither does one
   * whose shadow can't be read, nor (autosave on) one whose edits the
   * close's own write will save.
   */
  const confirmClose = useCallback(
    (id: string): Promise<boolean> => {
      const turn = promptChain.current.then(async () => {
        if (closing.current.has(id)) return true;
        // Its held state and the disk's text are known only once loaded.
        await loadContent(id);
        const file = stateRef.current.tabs.find((t) => t.id === id)?.file;
        if (
          !file ||
          file.held !== null ||
          keptShadows.has(id) ||
          (settingsRef.current.autosaveFiles && !file.unsaved) ||
          !hasPending(id)
        ) {
          return true;
        }
        const choice = await new Promise<CloseChoice>((resolve) => {
          answerRef.current = resolve;
          setClosePrompt({ id, name: baseName(file.path) });
        });
        switch (choice) {
          case "cancel":
            return false;
          case "save":
            // A Tab held meanwhile is saved (or refused) as held Tabs are.
            await save(id);
            return !hasPending(id);
          case "discard": {
            // Held while the prompt was open (a Disk conflict): it closes as
            // a held Tab, its text kept in its shadow, never discarded.
            const now = stateRef.current.tabs.find((t) => t.id === id)?.file;
            if (now && now.held === null) await discardUnsaved(id);
            return true;
          }
        }
      });
      promptChain.current = turn.catch(() => {});
      return turn;
    },
    [discardUnsaved, hasPending, keptShadows, loadContent, save],
  );

  /**
   * Close order: know the content, stop (= final write) its autosave, write
   * anything typed meanwhile, then delete or move the file, then update the
   * Session. Any failure leaves the Tab open so no text is lost; autosave
   * keeps retrying. A File stays on disk; a held one keeps its shadow.
   * Resolves to false when the owner cancelled or the save failed.
   */
  const closeOne = useCallback(
    async (id: string): Promise<boolean> => {
      if (closing.current.has(id)) return true;
      const tab = stateRef.current.tabs.find((t) => t.id === id);
      if (!tab) return true;
      // While the Tab still takes edits (closing makes it read-only).
      flushRich(id);
      if (tab.file) {
        let go: boolean;
        try {
          go = await confirmClose(id);
        } catch (err) {
          // Its text couldn't be read: it stays open, the others still close.
          console.error("close tab aborted", err);
          return true;
        }
        if (!go) return false;
        // Closed meanwhile (asked twice, the first answer closed it).
        if (closing.current.has(id)) return true;
        if (!stateRef.current.tabs.some((t) => t.id === id)) return true;
      }
      setClosing(id, true);
      const work = async () => {
        await loadContent(id);
        await saver.stop(id);
        // The stopped saver ignores edits made during its final write.
        let disk = onDisk.get(id) ?? "";
        const latest = contents.get(id) ?? disk;
        if (latest !== disk) {
          try {
            await writeDoc(id, latest);
          } catch (err) {
            saver.resume(id);
            saver.schedule(id, () => contents.get(id) ?? latest);
            throw err;
          }
          disk = latest;
        }
        const tab = stateRef.current.tabs.find((t) => t.id === id);
        const isFile = !!tab?.file;
        // A pinned Scratchpad is kept even empty: the Pinned list shows it.
        const isEmpty = !isFile && !tab?.pinned && disk === "";
        try {
          if (isFile) await closeFile(id);
          else await (isEmpty ? deleteScratchpad(id) : closeScratchpad(id));
        } catch (err) {
          saver.resume(id);
          throw err;
        }
        const { state: next } = ws.closeTab(
          stateRef.current,
          id,
          isEmpty,
          Date.now(),
          keyOf,
        );
        contents.delete(id);
        onDisk.delete(id);
        commit(ws.ensureOneTab(next, freshId()));
        await saveSessionNow();
      };
      await track(
        work()
          .catch((err) => console.error("close tab aborted", err))
          .finally(() => setClosing(id, false)),
      );
      return true;
    },
    [
      closeFile,
      commit,
      confirmClose,
      contents,
      flushRich,
      loadContent,
      onDisk,
      saveSessionNow,
      saver,
      setClosing,
      track,
      writeDoc,
    ],
  );

  const closeTab = useCallback(
    async (id: string) => {
      await closeOne(id);
    },
    [closeOne],
  );

  /** Closes `ids` one by one; a Cancel (or a failed save) stops the rest. */
  const closeTabs = useCallback(
    async (ids: string[]) => {
      for (const id of ids) if (!(await closeOne(id))) return;
    },
    [closeOne],
  );

  const closeSplit = useCallback(
    async (id: string) => {
      const split = sp.splitOf(stateRef.current, id);
      if (split) await closeTabs([split.a, split.b]);
    },
    [closeTabs],
  );

  const isClosing = useCallback(
    (id: string) => closingIds.has(id),
    [closingIds],
  );

  const run = useCallback(
    async (cmd: Command) => {
      // Before restore there is no Session to act on.
      if (!readyRef.current) return;
      const s = stateRef.current;
      switch (cmd.type) {
        case "newTab":
          return newTab();
        case "closeTab":
          return closeTab(s.activeId);
        case "reopenTab":
          // The newest entry.
          return s.closed[0] ? reopenEntry(s.closed[0].tab.id) : undefined;
        case "cycleTab":
          return commit(ws.cycle(s, cmd.dir));
        case "goToTab":
          return commit(ws.activateIndex(s, cmd.n));
        case "toggleWrap": {
          const tab = s.tabs.find((t) => t.id === s.activeId);
          if (tab) commit(ws.updateTab(s, tab.id, { wrap: !tab.wrap }));
          return;
        }
        case "quit":
          // Same flush-then-exit path as the window close and the OS quit.
          await emit(BEFORE_EXIT_EVENT);
          return;
        case "find":
        case "replace": {
          // The find bar is the plain editor's.
          const tab = s.tabs.find((t) => t.id === s.activeId);
          if (tab && effectiveMode(tab, settingsRef.current) === "rich") {
            await setMarkdownMode(tab.id, "markdown");
          }
          setFindRequest((r) => ({ mode: cmd.type, seq: (r?.seq ?? 0) + 1 }));
          return;
        }
        case "open":
          return pickAndOpen();
        case "save":
          // A rich editor's pending edit counts as typed text.
          flushRich(s.activeId);
          return save(s.activeId);
        case "saveAs":
          return saveAs(s.activeId);
        case "format":
          return requestFormat();
        case "toggleSidebar":
          return toggleSidebar();
        case "focusSidebar":
          return focusSidebar();
        case "collapseLibrary":
          return collapseLibrary();
        case "newCanvas":
          return newCanvas();
        case "togglePreview": {
          const tab = s.tabs.find((t) => t.id === s.activeId);
          if (tab?.kind !== "text" || tab.language !== "markdown") return;
          // Rich is already the rendered view: it has no preview.
          if (effectiveMode(tab, settingsRef.current) === "rich") return;
          const next = NEXT_PREVIEW[tab.preview ?? "edit"];
          return setPreview(tab.id, next === "edit" ? null : next);
        }
        case "toggleSplit": {
          if (sp.splitOf(s, s.activeId)) return unsplit(s.activeId);
          const prev = previousActiveRef.current;
          if (prev && prev !== s.activeId && !sp.splitOf(s, prev)) {
            splitWith(s.activeId, prev);
          }
          return;
        }
        case "toggleRichMarkdown": {
          const tab = s.tabs.find((t) => t.id === s.activeId);
          const mode = tab && effectiveMode(tab, settingsRef.current);
          if (!tab || !mode) return;
          return setMarkdownMode(tab.id, mode === "rich" ? "markdown" : "rich");
        }
        case "zoom":
          // A canvas or an image zooms itself (Excalidraw, the viewer).
          if (s.tabs.find((t) => t.id === s.activeId)?.kind === "text") {
            zoomEditor(cmd.dir);
          }
          return;
      }
    },
    [
      closeTab,
      collapseLibrary,
      commit,
      focusSidebar,
      newCanvas,
      newTab,
      pickAndOpen,
      reopenEntry,
      flushRich,
      requestFormat,
      save,
      saveAs,
      toggleSidebar,
      zoomEditor,
      setPreview,
      setMarkdownMode,
      splitWith,
      unsplit,
    ],
  );

  // Restore once on mount, then show the (hidden) window.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: WorkspaceState;
      try {
        next = await afterRestore(
          await restoreSession(freshId, {
            onGrantsUnchecked: () => {
              sessionSuspended.current = true;
              setGrantsUnchecked(true);
            },
            onSidebar: (restored) => {
              sidebarRef.current = restored;
              setSidebar(restored);
            },
            onFontSize: (px) => {
              fontSizeRef.current = px;
              setFontSizeState(px);
            },
            onSettings: (restored) => {
              settingsRef.current = restored;
              setSettingsState(restored);
            },
          }),
        );
      } catch (err) {
        console.error("restore failed", err);
        next = ws.ensureOneTab(EMPTY, freshId());
      }
      if (cancelled) return;
      commit(next);
      readyRef.current = true;
      setReady(true);
      const mark = (event: string) =>
        startupMark(event).catch(logError("startup log"));
      void mark("restored");
      try {
        await getCurrentWindow().show();
        void mark("shown");
      } catch (err) {
        logError("show window")(err);
        void mark("show failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [afterRestore, commit]);

  // Session Files Rust couldn't check at restore: ask again on focus and
  // every few seconds; once it answers, drop what isn't granted and resume
  // saving the Session.
  useEffect(() => {
    if (!ready || !grantsUnchecked) return;
    showNotice(SESSION_SUSPENDED_NOTICE);
    let busy = false;
    let done = false;
    const check = async () => {
      if (busy || done) return;
      busy = true;
      const paths = filePathsOf(stateRef.current);
      try {
        const granted = new Set(await grantsFilter(paths));
        if (done) return;
        done = true;
        const ok = (t: TabState) => !t.file || granted.has(t.file.path);
        const cur = stateRef.current;
        if (!cur.tabs.every(ok) || !cur.closed.every((e) => ok(e.tab))) {
          const tabs = cur.tabs.filter(ok);
          const activeId = tabs.some((t) => t.id === cur.activeId)
            ? cur.activeId
            : (tabs[0]?.id ?? "");
          commit(
            ws.ensureOneTab(
              sp.normalizeSplits({
                ...cur,
                tabs,
                activeId,
                closed: cur.closed.filter((e) => ok(e.tab)),
              }),
              freshId(),
            ),
          );
        }
        sessionSuspended.current = false;
        setGrantsUnchecked(false);
        scheduleSession();
      } catch (err) {
        logError("check granted paths")(err);
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void check(), GRANTS_RETRY_MS);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      done = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [ready, grantsUnchecked, commit, scheduleSession, showNotice]);

  // Persist the Session on every state change (debounced by the saver).
  useEffect(() => {
    if (ready) scheduleSession();
  }, [ready, state, sidebar, fontSize, settings, scheduleSession]);

  // A File Tab that becomes active goes to the front of the Recent list.
  useEffect(() => {
    if (!ready) return;
    const s = stateRef.current;
    const tab = s.tabs.find((t) => t.id === state.activeId);
    if (!tab?.file) return;
    patchSidebar({
      recent: touchRecent(sidebarRef.current.recent, tab.id, s),
    });
  }, [ready, state.activeId, patchSidebar]);

  // The active Tab's text is read lazily when it is first shown.
  useEffect(() => {
    if (ready && state.activeId) {
      loadContent(state.activeId).catch(logError("load scratchpad"));
    }
  }, [ready, state.activeId, loadContent]);

  // A Markdown Tab's editor is decided the first time it's shown, so the
  // Settings default no longer changes it after that.
  const deciding = useRef(new Set<string>());
  useEffect(() => {
    if (!ready) return;
    const split = sp.splitOf(state, state.activeId);
    const shown = split ? [split.a, split.b] : [state.activeId];
    for (const id of shown) {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab || tab.markdownMode || deciding.current.has(id)) continue;
      const mode = effectiveMode(tab, settingsRef.current);
      if (!mode) continue;
      deciding.current.add(id);
      void (async () => {
        let decided = mode;
        if (mode === "rich" && tooLargeForRich(await textOf(id))) {
          decided = "markdown";
          showNotice(TOO_LARGE_NOTICE);
        }
        const now = stateRef.current.tabs.find((t) => t.id === id);
        // Not if it was decided meanwhile, or is no longer Markdown.
        if (
          now &&
          !now.markdownMode &&
          effectiveMode(now, settingsRef.current)
        ) {
          commit(ws.updateTab(stateRef.current, id, { markdownMode: decided }));
        }
      })()
        .catch(logError("decide markdown mode"))
        .finally(() => deciding.current.delete(id));
    }
  }, [ready, state, commit, showNotice, textOf]);

  const active = state.tabs.find((t) => t.id === state.activeId);
  useWindowTitle(ready && active ? active.title : null);

  const saveAllFlushed = useCallback(() => {
    flushRich();
    return saveAll();
  }, [flushRich, saveAll]);

  return {
    ...filesApi,
    saveAll: saveAllFlushed,
    state,
    loadContent,
    setContent,
    updateTab,
    run,
    activate,
    closeTab,
    closeTabs,
    closePrompt,
    answerClosePrompt,
    moveTab,
    rename,
    isClosing,
    findRequest,
    saveStatus,
    ready,
    library,
    sidebar,
    setSidebarWidth,
    toggleSidebar,
    focusSidebar,
    newCanvas,
    fontSize,
    zoomEditor,
    setPinned,
    setFontSize,
    settings,
    setSettings,
    setPreview,
    setMarkdownMode,
    richFallback,
    bridge,
    bridgeRef: takeBridge,
    registerRich,
    richConflict: internal.holdConflict,
    splitWith,
    unsplit,
    swapSplit,
    setSplitOrientation,
    setSplitRatio,
    closeSplit,
  };
}

/** Mod+Shift+V on a Markdown Tab. */
const NEXT_PREVIEW = {
  edit: "split",
  split: "only",
  only: "edit",
} as const;
