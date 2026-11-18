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
import { createDocumentWriter } from "../files/documentWriter";
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
import type { FileFormat, TabState, WorkspaceState } from "../model/types";
import type { FindRequest } from "../find/findExtension";
import * as ws from "../model/workspace";
import { deriveTitle } from "../model/title";
import { toSessionFile } from "../model/session";
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
    const m = new Map<string, string | null>();
    for (const t of s.tabs) if (t.file) m.set(t.id, t.file.held);
    for (const e of s.closed) {
      if (e.tab.file) m.set(`closed:${e.tab.id}`, e.tab.file.held);
    }
    return m;
  };
  const x = held(a);
  const y = held(b);
  for (const [k, v] of y) if (x.has(k) && x.get(k) !== v) return true;
  return false;
}
const freshId = (): string => crypto.randomUUID();

const platform = detectPlatform();
const keyOf = (p: string) => pathKey(p, platform);
/** New Files: UTF-8, no BOM, the platform Line ending. */
const NEW_FILE: FileFormat = {
  encoding: "utf-8",
  bom: false,
  lineEnding: platform === "windows" ? "crlf" : "lf",
  mixed: false,
};

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
  moveTab(id: string, toIndex: number): void;
  rename(id: string, name: string): Promise<void>;
  /** True while a close is in progress; the editor should be read-only. */
  isClosing(id: string): boolean;
  /** The latest Mod+F / Mod+H request; `seq` changes on every press. */
  findRequest: FindRequest | null;
  saveStatus: SaveStatus;
  ready: boolean;
}

export function useWorkspace(): Workspace {
  const [state, setState] = useState<WorkspaceState>(EMPTY);
  const [ready, setReady] = useState(false);
  const [findRequest, setFindRequest] = useState<FindRequest | null>(null);
  const [grantsUnchecked, setGrantsUnchecked] = useState(false);
  // Contents live in a map: async commands need the latest, and typing must
  // not re-render the App.
  const stateRef = useRef(state);
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
      JSON.stringify(toSessionFile(stateRef.current)),
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
  const commit = useCallback(
    (next: WorkspaceState) => {
      const prev = stateRef.current;
      stateRef.current = next;
      setState(next);
      if (readyRef.current && heldChanged(prev, next)) void saveSessionNow();
    },
    [saveSessionNow],
  );

  const [keptShadows] = useState(() => new Set<string>());
  /** Per-Tab lock shared by autosave writes and File actions. */
  const [lock] = useState(createKeyedLock);
  /** The Saver's write: scratchpad, File or shadow (the writer is stateless). */
  const writeDoc = useCallback(
    (id: string, text: string) =>
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
          // A Tab whose shadow is unread is never written (see useFiles).
          isUnreadable: (tid) => keptShadows.has(tid),
          // Never write text that isn't the Tab's: a defence for any path
          // that schedules a write before the text loaded.
          isLoaded: (tid) => contents.has(tid),
          onWritten: (tid, written) => onDisk.set(tid, written),
        })(id, text),
      ),
    [commit, contents, keptShadows, lock, onDisk],
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
  useExitHandshake(savers, settleInFlight);
  useFlushOnBlur(savers);

  const keepTitle = useCallback(
    (id: string, text: string) => {
      const tab = stateRef.current.tabs.find((t) => t.id === id);
      // A File's Title is its filename.
      if (!tab || tab.renamed || tab.file) return;
      const title = deriveTitle(text);
      if (title !== tab.title) {
        commit(ws.updateTab(stateRef.current, id, { title }));
      }
    },
    [commit],
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
    freshId,
    track,
    saveSessionNow,
    keepTitle,
    keyOf,
    newFileFormat: NEW_FILE,
    keptShadows,
    closing,
  });
  const { internal, ...filesApi } = files;
  const { loadContent, updateTab, afterRestore, closeFile } = internal;
  const { refuseEdit } = internal;
  const { renameFile, reopenEntry, pickAndOpen, save, saveAs } = files;
  const { requestFormat, showNotice } = files;

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
      // An empty name falls back to the automatic Title, which needs the text.
      const text = await loadContent(id);
      commit(ws.rename(stateRef.current, id, name, deriveTitle(text)));
    },
    [commit, loadContent, renameFile],
  );

  const newTab = useCallback(() => {
    const id = freshId();
    contents.set(id, "");
    commit(ws.newTab(stateRef.current, id));
  }, [commit, contents]);

  const setClosing = useCallback((id: string, on: boolean) => {
    if (on) closing.current.add(id);
    else closing.current.delete(id);
    setClosingIds(new Set(closing.current));
  }, []);

  /**
   * Close order: know the content, stop (= final write) its autosave, write
   * anything typed meanwhile, then delete or move the file, then update the
   * Session. Any failure leaves the Tab open so no text is lost; autosave
   * keeps retrying. A File stays on disk; a held one keeps its shadow.
   */
  const closeTab = useCallback(
    (id: string): Promise<void> => {
      if (closing.current.has(id)) return Promise.resolve();
      if (!stateRef.current.tabs.some((t) => t.id === id)) {
        return Promise.resolve();
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
        const isFile = !!stateRef.current.tabs.find((t) => t.id === id)?.file;
        const isEmpty = !isFile && disk === "";
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
      return track(
        work()
          .catch((err) => console.error("close tab aborted", err))
          .finally(() => setClosing(id, false)),
      );
    },
    [
      closeFile,
      commit,
      contents,
      loadContent,
      onDisk,
      saveSessionNow,
      saver,
      setClosing,
      track,
      writeDoc,
    ],
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
        case "replace":
          setFindRequest((r) => ({ mode: cmd.type, seq: (r?.seq ?? 0) + 1 }));
          return;
        case "open":
          return pickAndOpen();
        case "save":
          return save(s.activeId);
        case "saveAs":
          return saveAs(s.activeId);
        case "format":
          return requestFormat();
      }
    },
    [
      closeTab,
      commit,
      newTab,
      pickAndOpen,
      reopenEntry,
      requestFormat,
      save,
      saveAs,
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
              { tabs, activeId, closed: cur.closed.filter((e) => ok(e.tab)) },
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
  }, [ready, state, scheduleSession]);

  // The active Tab's text is read lazily when it is first shown.
  useEffect(() => {
    if (ready && state.activeId) {
      loadContent(state.activeId).catch(logError("load scratchpad"));
    }
  }, [ready, state.activeId, loadContent]);

  const active = state.tabs.find((t) => t.id === state.activeId);
  useWindowTitle(ready && active ? active.title : null);

  return {
    ...filesApi,
    state,
    loadContent,
    setContent,
    updateTab,
    run,
    activate,
    closeTab,
    moveTab,
    rename,
    isClosing,
    findRequest,
    saveStatus,
    ready,
  };
}
