import type { FileInfo, Fingerprint, TabState } from "../model/types";
import type { WriteOutcome } from "./api";
import { onWriteOutcome } from "./fileState";

export interface DocumentWriterDeps {
  getTab(id: string): TabState | undefined;
  patchFile(id: string, f: FileInfo): void;
  writeScratchpad(id: string, text: string): Promise<void>;
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
  /** The text reached the Document's own storage (scratchpad or File). */
  onWritten?(id: string, text: string): void;
}

/**
 * The Saver's one write function. A Scratchpad goes to its scratchpad file.
 * A File is written only when it isn't held and its fingerprint still matches
 * the disk; otherwise the Tab is held and the text goes to its shadow file.
 * Only a failed scratchpad, File or shadow write rejects: a held Tab whose
 * shadow is written is saved as far as the Saver (and quitting) is concerned.
 */
export function createDocumentWriter(
  deps: DocumentWriterDeps,
): (id: string, text: string) => Promise<void> {
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

  return async (id, text) => {
    const tab = deps.getTab(id);
    if (!tab) {
      // Closed Tabs are finalised by the close itself; nothing to write.
      console.error("write for an unknown tab", id);
      return;
    }
    const file = tab.file;
    if (!file) {
      await deps.writeScratchpad(id, text);
      deps.onWritten?.(id, text);
      return;
    }
    if (file.held !== null) {
      await deps.shadowWrite(id, text);
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
