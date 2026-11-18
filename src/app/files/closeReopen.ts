import { useCallback } from "react";
import { shadowWrite } from "../../files/api";
import { baseName } from "../../files/paths";
import type { FileInfo } from "../../model/types";
import * as ws from "../../model/workspace";
import { reopenScratchpad } from "../../storage/api";
import { logError } from "../workspaceEffects";
import {
  fileInfoOf,
  openFailure,
  readDisk,
  type FilesContext,
} from "./context";

interface CloseReopenDeps {
  markUnreadable(id: string, on: boolean): void;
  readShadow(id: string, file: FileInfo): Promise<string | null | undefined>;
}

/** Closing a File Tab, and reopening Recently Closed entries. */
export function useCloseReopen(c: FilesContext, d: CloseReopenDeps) {
  const { stateRef, commit, contents, onDisk, saver, lock } = c;
  const { track, saveSessionNow, keyOf, keptShadows } = c;
  const { loadsRef, recheckSoonRef } = c;
  const { tabOf, patchFile, showNotice, dropShadow } = c;
  const { markUnreadable, readShadow } = d;

  /**
   * Called after the close wrote the Tab's text (a held File's went to its
   * shadow). Rejects to abort the close.
   */
  const closeFile = useCallback(
    // Under the lock: a disk check already running finishes first (and the
    // shadow write below covers what it held); later ones skip closing Tabs.
    (id: string) =>
      lock(id, async () => {
        const file = tabOf(id)?.file;
        if (!file) return;
        loadsRef.current.delete(id);
        if (keptShadows.has(id)) {
          // Its entry keeps its real held state: a reopen reads it again.
          markUnreadable(id, false);
          return;
        }
        if (file.held === null || file.held === "readonly") {
          // Its text is on disk: nothing to keep, and the entry never expires.
          if (file.held !== null) patchFile(id, { ...file, held: null });
          return dropShadow(id);
        }
        // A re-check may have held it after the final write went to the File:
        // the entry must still carry the text.
        await shadowWrite(id, contents.get(id) ?? "");
      }),
    [
      contents,
      dropShadow,
      keptShadows,
      loadsRef,
      lock,
      markUnreadable,
      patchFile,
      tabOf,
    ],
  );

  const reopenFile = useCallback(
    async (id: string, file: FileInfo): Promise<boolean> => {
      const open = ws.findByPath(stateRef.current, keyOf(file.path), keyOf);
      const at = () =>
        stateRef.current.closed.findIndex((e) => e.tab.id === id);
      if (open) {
        const s = stateRef.current;
        commit({
          ...s,
          activeId: open.id,
          closed: s.closed.filter((e) => e.tab.id !== id),
        });
        return true;
      }
      let text: string | null = null;
      let info = file;
      let disk: string | undefined;
      if (file.held !== null && file.held !== "readonly") {
        const kept = await readShadow(id, file);
        // Unreadable: the entry stays, with its shadow, for a later try.
        if (kept === undefined) {
          markUnreadable(id, false);
          return false;
        }
        text = kept;
      }
      if (text === null) {
        const r = await readDisk(file.path);
        if (r.kind === "failed") {
          showNotice(openFailure(baseName(file.path), r.err));
          return false;
        }
        // Its text was on disk; a gone path opens Missing, with no text.
        text = r.kind === "ok" ? r.read.text : "";
        info =
          r.kind === "ok"
            ? fileInfoOf(file.path, r.read)
            : { ...file, held: "missing" };
        disk = text;
      }
      const i = at();
      if (i < 0) return false;
      contents.set(id, text);
      if (disk === undefined) onDisk.delete(id);
      else onDisk.set(id, disk);
      saver.resume(id);
      const { state } = ws.reopenClosed(stateRef.current, i);
      commit(ws.updateTab(state, id, { file: info }));
      if (info.held !== null && info.held !== "readonly") {
        recheckSoonRef.current(id);
      }
      return true;
    },
    [
      commit,
      contents,
      keyOf,
      markUnreadable,
      onDisk,
      readShadow,
      recheckSoonRef,
      saver,
      showNotice,
      stateRef,
    ],
  );

  const reopenEntry = useCallback(
    (id: string): Promise<void> => {
      const entry = stateRef.current.closed.find((e) => e.tab.id === id);
      if (!entry) return Promise.resolve();
      const work = async () => {
        if (entry.tab.file) {
          if (!(await reopenFile(id, entry.tab.file))) return;
        } else {
          try {
            await reopenScratchpad(id);
          } catch (err) {
            return logError("reopen tab failed")(err);
          }
          // Another command may have run meanwhile; only reopen this entry.
          const i = stateRef.current.closed.findIndex((e) => e.tab.id === id);
          if (i < 0) return;
          saver.resume(id);
          commit(ws.reopenClosed(stateRef.current, i).state);
        }
        await saveSessionNow();
      };
      return track(work());
    },
    [commit, reopenFile, saveSessionNow, saver, stateRef, track],
  );

  return { closeFile, reopenEntry };
}
