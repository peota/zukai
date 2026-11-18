import { useCallback } from "react";
import {
  filePickSave,
  fileRename,
  fileSaveAs,
  type WriteOutcome,
} from "../../files/api";
import { baseName, languageOf, stemOf, suggestedName } from "../../files/paths";
import * as ws from "../../model/workspace";
import { deleteScratchpad } from "../../storage/api";
import { logError } from "../workspaceEffects";
import { asFileError, type FilesContext } from "./context";

interface SaveDeps {
  refuseUnreadable(id: string): boolean;
  loadContent(id: string): Promise<string>;
}

/** Save, Save As, and rename. */
export function useSave(c: FilesContext, d: SaveDeps) {
  const { stateRef, commit, contents, onDisk, saver, lock } = c;
  const { saveSessionNow, keyOf, newFileFormat } = c;
  const { tabOf, showNotice, keepAside, dropShadow } = c;
  const { refuseUnreadable, loadContent } = d;

  const saveAs = useCallback(
    async (id: string) => {
      const tab = tabOf(id);
      if (!tab || refuseUnreadable(id)) return;
      const text = await loadContent(id);
      const suggested = tab.file
        ? baseName(tab.file.path)
        : suggestedName(tab.title, tab.language);
      let path: string | null;
      try {
        path = await filePickSave(suggested);
      } catch (err) {
        return showNotice(`Can't save: ${asFileError(err).message}`);
      }
      if (path === null) return;
      const target = path;
      await lock(id, async () => {
        const cur = tabOf(id);
        if (!cur) return;
        const other = ws.findByPath(stateRef.current, keyOf(target), keyOf);
        if (other && other.id !== id) {
          return showNotice(`${other.title} is open in another tab`);
        }
        const format = cur.file
          ? { ...cur.file.format, mixed: false }
          : newFileFormat;
        const latest = contents.get(id) ?? text;
        let outcome: WriteOutcome;
        try {
          outcome = await fileSaveAs(target, latest, format);
        } catch (err) {
          const msg = asFileError(err).message;
          return showNotice(`Can't save ${baseName(target)}: ${msg}`);
        }
        if (outcome.kind !== "written") {
          return showNotice(
            outcome.kind === "unencodable"
              ? `Can't save: some characters can't be written in ${format.encoding}`
              : `Can't save ${baseName(target)}`,
          );
        }
        const now = tabOf(id) ?? cur;
        commit(
          ws.updateTab(stateRef.current, id, {
            title: baseName(target),
            renamed: false,
            language: now.languagePicked ? now.language : languageOf(target),
            languageGuessed: true,
            file: {
              path: target,
              format,
              fingerprint: outcome.fingerprint,
              held: null,
            },
          }),
        );
        onDisk.set(id, latest);
        // The Session names the File before its scratchpad goes, so a crash
        // in between never leaves it pointing at a deleted scratchpad.
        await saveSessionNow();
        if (!now.file) {
          await deleteScratchpad(id).catch(logError("delete scratchpad"));
        } else if (now.file.held !== null) {
          await dropShadow(id);
        }
        if (contents.get(id) !== latest) keepAside(id);
      });
    },
    [
      refuseUnreadable,
      commit,
      contents,
      dropShadow,
      keepAside,
      keyOf,
      loadContent,
      lock,
      newFileFormat,
      onDisk,
      saveSessionNow,
      showNotice,
      stateRef,
      tabOf,
    ],
  );

  const save = useCallback(
    async (id: string) => {
      const tab = tabOf(id);
      if (!tab) return;
      if (!tab.file) return saveAs(id);
      // Autosave already runs; Ctrl+S writes now. A failure shows "Not saved".
      await saver.flush(id).catch(logError("save"));
    },
    [saveAs, saver, tabOf],
  );

  const renameFile = useCallback(
    (id: string, name: string): Promise<string | null> =>
      lock(id, async () => {
        const file = tabOf(id)?.file;
        if (!file) return null;
        if (refuseUnreadable(id)) {
          return `${baseName(file.path)} has unsaved text that can't be read yet`;
        }
        const old = baseName(file.path);
        const stem = stemOf(name, file.path);
        const ext = old.slice(stemOf(old, file.path).length);
        if (stem === "") return "Enter a name";
        if (stem + ext === old) return null;
        let renamed: string;
        try {
          renamed = await fileRename(file.path, stem);
        } catch (err) {
          const e = asFileError(err);
          const msg =
            e.kind === "exists"
              ? `${stem}${ext} already exists`
              : e.kind === "invalid_name"
                ? `${stem}${ext} isn't a valid file name`
                : `Can't rename ${old}: ${e.message}`;
          showNotice(msg);
          return msg;
        }
        const cur = tabOf(id)?.file ?? file;
        commit(
          ws.updateTab(stateRef.current, id, {
            title: baseName(renamed),
            file: { ...cur, path: renamed },
          }),
        );
        await saveSessionNow();
        return null;
      }),
    [
      refuseUnreadable,
      commit,
      lock,
      saveSessionNow,
      showNotice,
      stateRef,
      tabOf,
    ],
  );

  return { save, saveAs, renameFile };
}
