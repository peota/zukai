import { useCallback, useEffect } from "react";
import * as ws from "../../model/workspace";
import type { FileFormat, TabState, WorkspaceState } from "../../model/types";
import { useBarActions } from "./barActions";
import { useCloseReopen } from "./closeReopen";
import {
  useFilesContext,
  type ConvertRequest,
  type FilesInternals,
  type FormatRequest,
  type ReplaceRequest,
} from "./context";
import {
  useDiskChanges,
  useFileEvents,
  useFocusRecheck,
  useWatchFiles,
} from "./diskChanges";
import { useLoading } from "./loading";
import { useLaunchPaths, useOpening } from "./opening";
import { useSave, type SaveAsOptions } from "./save";
import { logError } from "../workspaceEffects";

export {
  NOTICE_MS,
  type ConvertRequest,
  type FilesInternals,
  type FormatRequest,
  type ReplaceRequest,
} from "./context";

/** What useFiles adds to the Workspace. */
export interface FilesApi {
  openPaths(paths: string[]): Promise<void>;
  pickAndOpen(): Promise<void>;
  /** Scratchpad: Save As. File: write now. */
  save(id: string): Promise<void>;
  /** Saves every File Tab with pending edits; names skipped conflicts. */
  saveAll(): Promise<void>;
  /** The save dialog (starting in `opts.dir`, offering `opts.suggested`). */
  saveAs(id: string, opts?: SaveAsOptions): Promise<void>;
  keepMine(id: string): Promise<void>;
  loadDiskVersion(id: string): Promise<void>;
  saveToOriginal(id: string): Promise<void>;
  reopenWithEncoding(id: string, label: string): Promise<void>;
  /** Edits not yet in the File itself (held text counts); read on demand. */
  hasPending(id: string): boolean;
  /** Asks the editor to apply the change as an undoable step. */
  convert(id: string, patch: Partial<FileFormat>): void;
  /** Resolves to an error message to show inline, or null on success. */
  renameFile(id: string, stem: string): Promise<string | null>;
  /** Renames a File to `ext` (a Language's); same result as renameFile. */
  renameExtension(id: string, ext: string): Promise<string | null>;
  /**
   * Reopens the Recently Closed entry of Tab `id` (by id, not position: the
   * list may change between showing it and the click). Unknown ids do nothing.
   */
  reopenEntry(id: string): Promise<void>;
  requestFormat(kind?: FormatRequest["kind"]): void;
  /** Show a short status-bar notice (e.g. a Beautify that failed). */
  showNotice(text: string): void;
  notice: string | null;
  convertRequest: ConvertRequest | null;
  /** At most one per Tab; apply each seq once. */
  replaceRequests: ReplaceRequest[];
  formatRequest: FormatRequest | null;
  /**
   * Held Tabs whose unsaved text (shadow) can't be read right now. Not
   * saved in the Session: a restart reads the shadow again. The editor
   * should be read-only for them.
   */
  shadowUnreadable: ReadonlySet<string>;
}

/** Used by useWorkspace only. */
export interface FilesInternalApi {
  loadContent(id: string): Promise<string>;
  /** A `file` patch changes only the format (the rest belongs to useFiles). */
  updateTab(id: string, patch: Partial<TabState>): void;
  /** Recover orphan shadow files as Scratchpads. */
  afterRestore(state: WorkspaceState): Promise<WorkspaceState>;
  /** Called when a File Tab's close has written its text. */
  closeFile(id: string): Promise<void>;
  /** True (with a notice) if the Tab's text can't be changed now. */
  refuseEdit(id: string): boolean;
  /** Holds a File Tab as a Disk conflict (its text is kept as "mine"). */
  holdConflict(id: string): void;
  /** Writes the Tab to a granted `target`; resolves to whether it did. */
  saveTo(id: string, target: string): Promise<boolean>;
  /**
   * After a Library rename or move: open Tabs and Recently Closed entries
   * whose path is a key of `moved` take its value (Rust's granted string),
   * and the Session is saved with the new paths.
   */
  rewriteTabPaths(moved: ReadonlyMap<string, string>): Promise<void>;
  /** Compares each File Tab with the disk now (after a Library trash). */
  recheckTabs(ids: string[]): Promise<void>;
}

export function useFiles(
  x: FilesInternals,
): FilesApi & { internal: FilesInternalApi } {
  const files = useFilesContext(x);
  const { c } = files;
  const {
    markUnreadable,
    readShadow,
    refuseUnreadable,
    loadContent,
    afterRestore,
  } = useLoading(c);
  const { openPaths, openFrom, pickAndOpen } = useOpening(c);
  const { reloadLocked, recheck, recheckAll } = useDiskChanges(
    c,
    refuseUnreadable,
  );
  const bar = useBarActions(c, { refuseUnreadable, loadContent, reloadLocked });
  const { save, saveAll, saveAs, saveTo, renameFile, renameExtension } =
    useSave(c, {
      refuseUnreadable,
      loadContent,
      saveToOriginal: bar.saveToOriginal,
    });
  const { closeFile, reopenEntry } = useCloseReopen(c, {
    markUnreadable,
    readShadow,
  });

  const { stateRef, commit, saveSessionNow, lock } = c;
  const rewriteTabPaths = useCallback(
    async (moved: ReadonlyMap<string, string>) => {
      const next = ws.rewritePaths(stateRef.current, moved);
      if (next === stateRef.current) return;
      commit(next);
      await saveSessionNow();
    },
    [commit, saveSessionNow, stateRef],
  );
  const recheckTabs = useCallback(
    async (ids: string[]) => {
      await Promise.all(
        ids.map((id) =>
          lock(id, () => recheck(id)).catch(logError("check file")),
        ),
      );
    },
    [lock, recheck],
  );

  // --- Effects -------------------------------------------------------------

  const { ready } = c;
  useEffect(() => {
    if (x.ready) ready.resolve();
  }, [x.ready, ready]);

  useFileEvents(c, recheck, openFrom);
  useLaunchPaths(ready, openFrom);
  useFocusRecheck(recheckAll);
  useWatchFiles(x.ready, x.state.tabs);

  const { noticeTimerRef } = c;
  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current);
    },
    [noticeTimerRef],
  );

  return {
    openPaths,
    pickAndOpen,
    save,
    saveAll,
    saveAs,
    keepMine: bar.keepMine,
    loadDiskVersion: bar.loadDiskVersion,
    saveToOriginal: bar.saveToOriginal,
    reopenWithEncoding: bar.reopenWithEncoding,
    hasPending: c.hasPending,
    convert: bar.convert,
    renameFile,
    renameExtension,
    reopenEntry,
    requestFormat: bar.requestFormat,
    showNotice: c.showNotice,
    notice: files.notice,
    convertRequest: files.convertRequest,
    replaceRequests: files.replaceRequests,
    formatRequest: files.formatRequest,
    shadowUnreadable: files.shadowUnreadable,
    internal: {
      loadContent,
      updateTab: bar.updateTab,
      afterRestore,
      closeFile,
      refuseEdit: refuseUnreadable,
      holdConflict: (id: string) => {
        const file = c.tabOf(id)?.file;
        if (file && file.held === null) c.hold(id, file, "conflict");
      },
      saveTo,
      rewriteTabPaths,
      recheckTabs,
    },
  };
}
