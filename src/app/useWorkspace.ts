import { useCallback, useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Command } from "./shortcuts";
import { BEFORE_EXIT_EVENT } from "./exit";
import {
  logError,
  restoreSession,
  useCombinedSaveStatus,
  useExitHandshake,
  useFlushOnBlur,
  useWindowTitle,
} from "./workspaceEffects";
import type { TabState, WorkspaceState } from "../model/types";
import * as ws from "../model/workspace";
import { deriveTitle } from "../model/title";
import { toSessionFile } from "../model/session";
import {
  closeScratchpad,
  deleteScratchpad,
  readScratchpad,
  reopenScratchpad,
  writeScratchpad,
} from "../storage/api";
import {
  SESSION_ID,
  createSaver,
  sessionSaver,
  type SaveStatus,
} from "../storage/autosave";

export interface FindRequest {
  mode: "find" | "replace";
  seq: number;
}

const EMPTY: WorkspaceState = { tabs: [], activeId: "", closed: [] };
const freshId = (): string => crypto.randomUUID();

export interface Workspace {
  state: WorkspaceState;
  /** Loaded text of a Tab, or undefined while it hasn't been read yet. */
  contentOf(id: string): string | undefined;
  loadContent(id: string): Promise<string>;
  setContent(id: string, text: string): void;
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
  // Contents live in a ref (async commands need the latest); this re-renders.
  const [, setContentVersion] = useState(0);
  const stateRef = useRef(state);
  const contents = useRef(new Map<string, string>());
  const loads = useRef(new Map<string, Promise<string>>());
  /** Text known to be on disk per id (last loaded or successfully written). */
  const [onDisk] = useState(() => new Map<string, string>());
  const closing = useRef(new Set<string>());
  const [closingIds, setClosingIds] = useState<ReadonlySet<string>>(new Set());
  /** Close/reopen operations in flight; exit waits for them. */
  const inFlight = useRef(new Set<Promise<void>>());
  const [saver] = useState(() =>
    createSaver(async (id, text) => {
      await writeScratchpad(id, text);
      onDisk.set(id, text);
    }),
  );
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

  /** Every state change goes through here so async code sees it at once. */
  const commit = useCallback((next: WorkspaceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const scheduleSession = useCallback(() => {
    sessionSaver.schedule(SESSION_ID, () =>
      JSON.stringify(toSessionFile(stateRef.current)),
    );
  }, []);

  /** Write session.json now, so it agrees with a file just moved on disk. */
  const saveSessionNow = useCallback(async () => {
    scheduleSession();
    await sessionSaver.flush(SESSION_ID).catch(logError("save session"));
  }, [scheduleSession]);

  const keepTitle = useCallback(
    (id: string, text: string) => {
      const tab = stateRef.current.tabs.find((t) => t.id === id);
      if (!tab || tab.renamed) return;
      const title = deriveTitle(text);
      if (title !== tab.title) {
        commit(ws.updateTab(stateRef.current, id, { title }));
      }
    },
    [commit],
  );

  const contentOf = useCallback((id: string) => contents.current.get(id), []);

  const loadContent = useCallback(
    (id: string): Promise<string> => {
      const have = contents.current.get(id);
      if (have !== undefined) return Promise.resolve(have);
      let p = loads.current.get(id);
      if (!p) {
        p = readScratchpad(id)
          .then((text) => {
            if (!onDisk.has(id)) onDisk.set(id, text);
            if (!contents.current.has(id)) contents.current.set(id, text);
            setContentVersion((v) => v + 1);
            const loaded = contents.current.get(id)!;
            keepTitle(id, loaded);
            return loaded;
          })
          .finally(() => loads.current.delete(id));
        loads.current.set(id, p);
      }
      return p;
    },
    [keepTitle, onDisk],
  );

  const setContent = useCallback(
    (id: string, text: string) => {
      contents.current.set(id, text);
      setContentVersion((v) => v + 1);
      saver.schedule(id, () => contents.current.get(id) ?? text);
      keepTitle(id, text);
    },
    [saver, keepTitle],
  );

  const updateTab = useCallback(
    (id: string, patch: Partial<TabState>) =>
      commit(ws.updateTab(stateRef.current, id, patch)),
    [commit],
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
      // An empty name falls back to the automatic Title, which needs the text.
      const text = await loadContent(id);
      commit(ws.rename(stateRef.current, id, name, deriveTitle(text)));
    },
    [commit, loadContent],
  );

  const newTab = useCallback(() => {
    const id = freshId();
    contents.current.set(id, "");
    commit(ws.newTab(stateRef.current, id));
  }, [commit]);

  const setClosing = useCallback((id: string, on: boolean) => {
    if (on) closing.current.add(id);
    else closing.current.delete(id);
    setClosingIds(new Set(closing.current));
  }, []);

  /**
   * Close order: know the content, stop (= final write) its autosave, write
   * anything typed meanwhile, then delete or move the file, then update the
   * Session. Any failure leaves the Tab open so no text is lost; autosave
   * keeps retrying.
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
        const latest = contents.current.get(id) ?? disk;
        if (latest !== disk) {
          try {
            await writeScratchpad(id, latest);
          } catch (err) {
            saver.resume(id);
            saver.schedule(id, () => contents.current.get(id) ?? latest);
            throw err;
          }
          onDisk.set(id, latest);
          disk = latest;
        }
        const isEmpty = disk === "";
        try {
          await (isEmpty ? deleteScratchpad(id) : closeScratchpad(id));
        } catch (err) {
          saver.resume(id);
          throw err;
        }
        const { state: next } = ws.closeTab(
          stateRef.current,
          id,
          isEmpty,
          Date.now(),
        );
        contents.current.delete(id);
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
    [commit, loadContent, onDisk, saveSessionNow, saver, setClosing, track],
  );

  const reopenTab = useCallback((): Promise<void> => {
    const entry = stateRef.current.closed[0];
    if (!entry) return Promise.resolve();
    const id = entry.tab.id;
    const work = async () => {
      try {
        await reopenScratchpad(id);
      } catch (err) {
        console.error("reopen tab failed", err);
        return;
      }
      // Another command may have run meanwhile; only reopen the same entry.
      if (stateRef.current.closed[0]?.tab.id !== id) return;
      saver.resume(id);
      commit(ws.reopenClosed(stateRef.current).state);
      await saveSessionNow();
    };
    return track(work());
  }, [commit, saveSessionNow, saver, track]);

  const isClosing = useCallback(
    (id: string) => closingIds.has(id),
    [closingIds],
  );

  const run = useCallback(
    async (cmd: Command) => {
      const s = stateRef.current;
      switch (cmd.type) {
        case "newTab":
          return newTab();
        case "closeTab":
          return closeTab(s.activeId);
        case "reopenTab":
          return reopenTab();
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
      }
    },
    [closeTab, commit, newTab, reopenTab],
  );

  // Restore once on mount, then show the (hidden) window.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: WorkspaceState;
      try {
        next = await restoreSession(freshId);
      } catch (err) {
        console.error("restore failed", err);
        next = ws.ensureOneTab(EMPTY, freshId());
      }
      if (cancelled) return;
      commit(next);
      setReady(true);
      await getCurrentWindow().show().catch(logError("show window"));
    })();
    return () => {
      cancelled = true;
    };
  }, [commit]);

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
    state,
    contentOf,
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
