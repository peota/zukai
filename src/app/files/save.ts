import { useCallback } from "react";
import {
  fileChangeExtension,
  filePickSave,
  fileRename,
  fileSaveAs,
  type WriteOutcome,
} from "../../files/api";
import { inShadow } from "../../files/fileState";
import { baseName, languageOf, stemOf, suggestedName } from "../../files/paths";
import { CANVAS_EXT, kindOf, type Kind } from "../../model/kinds";
import * as ws from "../../model/workspace";
import { deleteScratchpad } from "../../storage/api";
import { logError } from "../workspaceEffects";
import { asFileError, type FilesContext } from "./context";

/** A Canvas's save dialog offers only drawings. */
const CANVAS_FILTER = {
  name: "Excalidraw drawing",
  extensions: ["excalidraw"],
};

export const IMAGE_READ_ONLY = "Images are read-only in Zukai";

/**
 * Why a Tab of Kind `kind` can't be saved to `target`, or null if it can.
 * Save As keeps the Kind: a drawing goes only into a .excalidraw file, and
 * text never into a drawing or an image (it would be unreadable there).
 */
function kindRefusal(kind: Kind, target: string): string | null {
  // An image is only ever viewed: its Tab has no bytes to write.
  if (kind === "image") return IMAGE_READ_ONLY;
  const into = kindOf(target);
  if (into === kind) return null;
  switch (kind) {
    case "pdf":
      // Like an image: Task 5 makes this explicit.
      return IMAGE_READ_ONLY;
    case "diff":
      // Never asked: saveTo stops a diff Tab first.
      return null;
    case "canvas":
      return "A canvas can only be saved as a .excalidraw file";
    case "text":
      return into === "canvas"
        ? "Can't save text as a .excalidraw drawing"
        : `Can't save text as an image (${baseName(target)})`;
  }
}

export interface SaveAsOptions {
  /** Where the save dialog starts. */
  dir?: string;
  /** The file name it offers. */
  suggested?: string;
}

interface SaveDeps {
  refuseUnreadable(id: string): boolean;
  loadContent(id: string): Promise<string>;
  saveToOriginal(id: string): Promise<void>;
}

/** Save, Save As, and rename. */
export function useSave(c: FilesContext, d: SaveDeps) {
  const { stateRef, commit, contents, onDisk, saver, lock } = c;
  const { saveSessionNow, keyOf, newFileFormat } = c;
  const { tabOf, showNotice, keepAside, dropShadow, hasPending, saveNow } = c;
  const { refuseUnreadable, loadContent, saveToOriginal } = d;

  /**
   * Writes Tab `id` to `target` (a path Rust granted: picked in the save
   * dialog, or reserved in the Library) and makes it the Tab's File.
   * Resolves to whether it was saved.
   */
  const saveTo = useCallback(
    async (id: string, target: string): Promise<boolean> => {
      const tab = tabOf(id);
      // A diff Tab is read-only and has no text of its own to save.
      if (!tab || tab.kind === "diff" || refuseUnreadable(id)) return false;
      const refused = kindRefusal(tab.kind, target);
      if (refused) {
        showNotice(refused);
        return false;
      }
      const text = await loadContent(id);
      let saved = false;
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
        } else if (inShadow(now.file)) {
          await dropShadow(id);
        }
        if (contents.get(id) !== latest) keepAside(id);
        saved = true;
      });
      return saved;
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

  /**
   * The save dialog, then `saveTo`. `opts.dir` is where the dialog starts
   * and `opts.suggested` the name it offers (Move to Library…).
   */
  const saveAs = useCallback(
    async (id: string, opts: SaveAsOptions = {}) => {
      const tab = tabOf(id);
      if (!tab || tab.kind === "diff" || refuseUnreadable(id)) return;
      if (tab.kind === "image") return showNotice(IMAGE_READ_ONLY);
      const canvas = tab.kind === "canvas";
      const suggested =
        opts.suggested ??
        (tab.file
          ? baseName(tab.file.path)
          : suggestedName(
              tab.title,
              tab.language,
              canvas ? CANVAS_EXT : undefined,
            ));
      let path: string | null;
      try {
        path = await (canvas
          ? filePickSave(suggested, opts.dir, CANVAS_FILTER)
          : opts.dir === undefined
            ? filePickSave(suggested)
            : filePickSave(suggested, opts.dir));
      } catch (err) {
        return showNotice(`Can't save: ${asFileError(err).message}`);
      }
      if (path === null) return;
      await saveTo(id, path);
    },
    [refuseUnreadable, saveTo, showNotice, tabOf],
  );

  const save = useCallback(
    async (id: string) => {
      const tab = tabOf(id);
      if (!tab || tab.kind === "image" || tab.kind === "diff") return;
      if (!tab.file) return saveAs(id);
      // The same notice as Keep mine: an explicit save never fails silently.
      const failed = (err: unknown) => {
        logError("save")(err);
        const path = tabOf(id)?.file?.path ?? tab.file!.path;
        showNotice(`Can't save ${baseName(path)}: ${asFileError(err).message}`);
      };
      try {
        // A Tab restored but never shown has no text yet, and its held state
        // is known only once it loaded (the disk may have changed meanwhile).
        await loadContent(id);
      } catch (err) {
        return failed(err);
      }
      const file = tabOf(id)?.file;
      if (!file) return;
      switch (file.held) {
        case "conflict":
          return showNotice("Resolve the conflict first");
        case "missing":
          try {
            return await saveToOriginal(id);
          } catch (err) {
            return failed(err);
          }
        case "unencodable":
          return showNotice(
            `Can't save: some characters can't be written in ${file.format.encoding}`,
          );
        case "readonly":
          return;
        case null:
          break;
      }
      try {
        await saver.flush(id);
        const text = contents.get(id);
        // saveNow takes the Tab's lock itself (it isn't re-entrant).
        if (text !== undefined && hasPending(id)) await saveNow(id, text);
      } catch (err) {
        failed(err);
      }
    },
    [
      contents,
      hasPending,
      loadContent,
      saveAs,
      saveNow,
      saveToOriginal,
      saver,
      showNotice,
      tabOf,
    ],
  );

  /** Saves every File Tab with edits not yet in its File, in tab order. */
  const saveAll = useCallback(async () => {
    const skipped: string[] = [];
    for (const { id } of stateRef.current.tabs) {
      const tab = tabOf(id);
      if (!tab?.file || tab.kind === "image" || !hasPending(id)) continue;
      // A Tab restored but never shown: loading it may find a conflict.
      await loadContent(id).catch(logError("load for save"));
      const now = tabOf(id);
      if (!now) continue;
      if (now.file?.held === "conflict") {
        skipped.push(now.title);
        continue;
      }
      await save(id);
    }
    if (skipped.length > 0) {
      showNotice(`Not saved (conflict): ${skipped.join(", ")}`);
    }
  }, [hasPending, loadContent, save, showNotice, stateRef, tabOf]);

  /**
   * Renames Tab `id`'s File with `rename` (Rust's call, given its path),
   * where `to` is the name it asks for. Resolves to the error shown, or null.
   */
  const renameWith = useCallback(
    (
      id: string,
      to: (path: string) => string | null,
      rename: (path: string) => Promise<string>,
    ): Promise<string | null> =>
      lock(id, async () => {
        const file = tabOf(id)?.file;
        if (!file) return null;
        const old = baseName(file.path);
        if (refuseUnreadable(id)) {
          return `${old} has unsaved text that can't be read yet`;
        }
        const name = to(file.path);
        if (name === null) return "Enter a name";
        if (name === old) return null;
        let renamed: string;
        try {
          renamed = await rename(file.path);
        } catch (err) {
          const e = asFileError(err);
          const msg =
            e.kind === "exists"
              ? `${name} already exists`
              : e.kind === "invalid_name"
                ? `${name} isn't a valid file name`
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

  const renameFile = useCallback(
    (id: string, name: string): Promise<string | null> => {
      let stem = "";
      return renameWith(
        id,
        (path) => {
          const old = baseName(path);
          stem = stemOf(name, path);
          return stem === ""
            ? null
            : stem + old.slice(stemOf(old, path).length);
        },
        (path) => fileRename(path, stem),
      );
    },
    [renameWith],
  );

  const renameExtension = useCallback(
    (id: string, ext: string): Promise<string | null> =>
      renameWith(
        id,
        (path) => {
          const old = baseName(path);
          const dot = old.lastIndexOf(".");
          return `${dot > 0 ? old.slice(0, dot) : old}.${ext}`;
        },
        (path) => fileChangeExtension(path, ext),
      ),
    [renameWith],
  );

  return { save, saveAll, saveAs, saveTo, renameFile, renameExtension };
}
