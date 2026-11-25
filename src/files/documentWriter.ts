import { isViewerKind } from "../model/kinds";
import type { FileInfo, Fingerprint, TabState } from "../model/types";
import type { WriteOutcome } from "./api";
import { onWriteOutcome } from "./fileState";

export interface DocumentWriterDeps {
  getTab(id: string): TabState | undefined;
  patchFile(id: string, f: FileInfo): void;
  writeScratchpad(
    id: string,
    text: string,
    ext: "txt" | "excalidraw",
  ): Promise<void>;
  fileWrite(
    path: string,
    text: string,
    format: FileInfo["format"],
    expected: Fingerprint,
  ): Promise<WriteOutcome>;
  /** Used when a File's fingerprint is unknown: null means it's gone. */
  fileFingerprint(path: string): Promise<Fingerprint | null>;
  shadowWrite(id: string, text: string): Promise<void>;
  shadowDelete(id: string): Promise<void>;
  /** True when Files are saved automatically (the Settings switch). */
  autosaveFiles(): boolean;
  /** The text last read from or written to the File (undefined: unknown). */
  diskText(id: string): string | undefined;
  /** The text reached the Document's own storage (scratchpad or File). */
  onWritten?(id: string, text: string): void;
  /**
   * True for a held Tab whose shadow couldn't be read: its loaded text isn't
   * its real text, so nothing is written for it at all.
   */
  isUnreadable?(id: string): boolean;
  /**
   * False when the Tab's text was never loaded: the text handed in can't be
   * its real text, so the write is refused (rejects, so nothing claims it
   * was saved).
   */
  isLoaded?(id: string): boolean;
}

/**
 * "auto" is the Saver's write: with autosave off, a File's edits go to its
 * shadow. "save" is an explicit save (Ctrl+S): it writes the File.
 */
export type WriteMode = "auto" | "save";

/**
 * The Saver's one write function. A Scratchpad goes to its scratchpad file.
 * A File is written only when it isn't held and its fingerprint still matches
 * the disk; otherwise the Tab is held and the text goes to its shadow file.
 * Only a failed scratchpad, File or shadow write rejects: a held Tab whose
 * shadow is written is saved as far as the Saver (and quitting) is concerned.
 */
export function createDocumentWriter(
  deps: DocumentWriterDeps,
): (id: string, text: string, mode?: WriteMode) => Promise<void> {
  /** Hold the File (unless it moved meanwhile) and keep the text aside. */
  const hold = async (
    id: string,
    path: string,
    next: FileInfo,
    text: string,
  ) => {
    const cur = deps.getTab(id)?.file;
    if (cur && cur.path === path)
      deps.patchFile(id, { ...cur, held: next.held });
    await deps.shadowWrite(id, text);
  };

  return async (id, text, mode = "auto") => {
    const tab = deps.getTab(id);
    if (!tab) {
      // Closed Tabs are finalised by the close itself; nothing to write.
      console.error("write for an unknown tab", id);
      return;
    }
    // Resolves rather than rejects: edits to it are refused, so there is
    // nothing unsaved (its text is in the untouched shadow), and a rejection
    // would block closing the Tab and quitting.
    // An Image or PDF is only viewed: its text is a lossy decode of its bytes, never
    // written to the File or a shadow.
    if (isViewerKind(tab.kind)) return;
    if (deps.isUnreadable?.(id)) {
      console.error("write refused: unreadable shadow", id);
      return;
    }
    if (deps.isLoaded?.(id) === false) {
      throw new Error(`write refused: the text of ${id} never loaded`);
    }
    const file = tab.file;
    if (!file) {
      await deps.writeScratchpad(
        id,
        text,
        tab.kind === "canvas" ? "excalidraw" : "txt",
      );
      deps.onWritten?.(id, text);
      return;
    }
    if (file.held !== null) {
      await deps.shadowWrite(id, text);
      return;
    }
    if (mode === "auto" && !deps.autosaveFiles()) {
      // Manual mode: the File is untouched; the text waits in the shadow.
      // The patches below start from the Tab's File as it is after the await:
      // a Convert (no lock) may have changed its format meanwhile.
      const latest = () => {
        const cur = deps.getTab(id)?.file;
        return cur && cur.path === file.path ? cur : undefined;
      };
      if (text === deps.diskText(id) && !file.diskFormat) {
        // Back to the disk's text with nothing else pending: nothing unsaved.
        // A failed delete rejects (unlike the written path, which only logs):
        // the shadow would keep stale text, so the Saver must retry.
        await deps.shadowDelete(id);
        const cur = latest();
        if (cur?.unsaved) {
          const next = { ...cur };
          delete next.unsaved;
          deps.patchFile(id, next);
        }
        return;
      }
      await deps.shadowWrite(id, text);
      const cur = latest();
      if (cur && !cur.unsaved) deps.patchFile(id, { ...cur, unsaved: true });
      return;
    }
    const { path } = file;
    if (file.fingerprint === null) {
      // Never write blind: without a fingerprint the disk might hold changes
      // Zukai never saw.
      const disk = await deps.fileFingerprint(path);
      const held = disk === null ? "missing" : "conflict";
      await hold(id, path, { ...file, held }, text);
      return;
    }
    const outcome = await deps.fileWrite(
      path,
      text,
      file.format,
      file.fingerprint,
    );
    const cur = deps.getTab(id)?.file;
    if (outcome.kind !== "written") {
      await hold(id, path, onWriteOutcome(cur ?? file, outcome), text);
      return;
    }
    // A Save As or rename moved the Tab while writing: this outcome is the
    // old path's, so it says nothing about the File the Tab now shows.
    if (!cur || cur.path !== path) return;
    deps.patchFile(id, onWriteOutcome(cur, outcome));
    deps.onWritten?.(id, text);
    await deps
      .shadowDelete(id)
      .catch((err: unknown) => console.error("delete shadow", err));
  };
}
