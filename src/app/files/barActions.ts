import { useCallback } from "react";
import {
  fileFingerprint,
  fileRereadAs,
  fileSaveAs,
  fileWrite,
  type WriteOutcome,
} from "../../files/api";
import { decide, onWriteOutcome, type DiskEvent } from "../../files/fileState";
import { baseName } from "../../files/paths";
import type { FileFormat, TabState } from "../../model/types";
import * as ws from "../../model/workspace";
import { logError } from "../workspaceEffects";
import {
  asFileError,
  readDisk,
  sameFormat,
  type DiskRead,
  type FilesContext,
  type FormatRequest,
} from "./context";

interface BarDeps {
  refuseUnreadable(id: string): boolean;
  loadContent(id: string): Promise<string>;
  reloadLocked(
    id: string,
    read: () => Promise<DiskRead>,
    typed?: string,
  ): Promise<void>;
}

/** The Tab bar's actions on held Files, Convert, and Tab patches. */
export function useBarActions(c: FilesContext, d: BarDeps) {
  const { stateRef, commit, contents, onDisk, lock } = c;
  const { setConvert, setFormat } = c;
  const { tabOf, patchFile, showNotice, hasPending } = c;
  const { keepAside, hold, dropShadow } = c;
  const { refuseUnreadable, loadContent, reloadLocked } = d;

  /** After a write of `text` by an action: record it and clear the shadow. */
  const wrote = useCallback(
    async (id: string, path: string, text: string, outcome: WriteOutcome) => {
      const cur = tabOf(id)?.file;
      if (!cur || cur.path !== path) return;
      patchFile(id, onWriteOutcome({ ...cur, held: null }, outcome));
      if (outcome.kind !== "written") return keepAside(id);
      onDisk.set(id, text);
      await dropShadow(id);
      // Typed while writing: autosave takes it from here.
      if (contents.get(id) !== text) keepAside(id);
    },
    [contents, dropShadow, keepAside, onDisk, patchFile, tabOf],
  );

  const keepMine = useCallback(
    async (id: string) => {
      if (refuseUnreadable(id)) return;
      const text = await loadContent(id);
      await lock(id, async () => {
        const file = tabOf(id)?.file;
        if (!file) return;
        const latest = contents.get(id) ?? text;
        try {
          const disk = await fileFingerprint(file.path);
          if (disk === null) return hold(id, file, "missing");
          const outcome = await fileWrite(file.path, latest, file.format, disk);
          await wrote(id, file.path, latest, outcome);
        } catch (err) {
          showNotice(
            `Can't save ${baseName(file.path)}: ${asFileError(err).message}`,
          );
        }
      });
    },
    [
      refuseUnreadable,
      contents,
      hold,
      loadContent,
      lock,
      showNotice,
      tabOf,
      wrote,
    ],
  );

  const loadDiskVersion = useCallback(
    async (id: string) => {
      // Its text first: a Missing or failed read keeps (and writes) the
      // Tab's text, which must be the real one, never "".
      await loadContent(id);
      await lock(id, () => {
        const path = tabOf(id)?.file?.path;
        return path
          ? reloadLocked(id, () => readDisk(path))
          : Promise.resolve();
      });
    },
    [loadContent, lock, reloadLocked, tabOf],
  );

  const saveToOriginal = useCallback(
    async (id: string) => {
      if (refuseUnreadable(id)) return;
      const text = await loadContent(id);
      await lock(id, async () => {
        const file = tabOf(id)?.file;
        if (!file) return;
        const latest = contents.get(id) ?? text;
        try {
          // save_as doesn't check fingerprints: never write over a File that
          // came back meanwhile. Treat it as the disk change it is.
          const disk = await fileFingerprint(file.path);
          if (disk !== null) {
            const ev: DiskEvent = { kind: "reappeared", disk };
            switch (decide(file, ev, hasPending(id))) {
              case "reload":
                return reloadLocked(id, () => readDisk(file.path), latest);
              case "conflict":
                return hold(id, file, "conflict");
              default:
                return;
            }
          }
          const outcome = await fileSaveAs(file.path, latest, file.format);
          await wrote(id, file.path, latest, outcome);
        } catch (err) {
          showNotice(
            `Can't recreate ${baseName(file.path)}: ${asFileError(err).message}. Use Save as…`,
          );
        }
      });
    },
    [
      refuseUnreadable,
      contents,
      hasPending,
      hold,
      loadContent,
      lock,
      reloadLocked,
      showNotice,
      tabOf,
      wrote,
    ],
  );

  const reopenWithEncoding = useCallback(
    (id: string, label: string) =>
      lock(id, () => {
        const path = tabOf(id)?.file?.path;
        if (!path || refuseUnreadable(id)) return Promise.resolve();
        // Re-decoding replaces the text: never over edits not on disk.
        if (hasPending(id)) {
          showNotice(
            `Can't reopen ${baseName(path)} with another encoding while it has unsaved edits`,
          );
          return Promise.resolve();
        }
        return reloadLocked(id, async () => {
          try {
            return { kind: "ok", read: await fileRereadAs(path, label) };
          } catch (err) {
            const e = asFileError(err);
            return {
              kind: "failed",
              err: { ...e, message: `${label}: ${e.message}` },
            };
          }
        });
      }),
    [hasPending, lock, refuseUnreadable, reloadLocked, showNotice, tabOf],
  );

  const convert = useCallback(
    (id: string, patch: Partial<FileFormat>) => {
      if (refuseUnreadable(id)) return;
      setConvert((r) => ({ seq: (r?.seq ?? 0) + 1, id, patch }));
    },
    [refuseUnreadable, setConvert],
  );

  const requestFormat = useCallback(
    (kind: FormatRequest["kind"] = "beautify") =>
      setFormat((r) => ({ seq: (r?.seq ?? 0) + 1, kind })),
    [setFormat],
  );

  const applyTabPatch = useCallback(
    (id: string, patch: Partial<TabState>) => {
      const cur = tabOf(id)?.file;
      if (!patch.file || !cur) {
        return commit(ws.updateTab(stateRef.current, id, patch));
      }
      // Its unread shadow is the only copy of its text: no Convert, which
      // would clear `held` and write the (empty) loaded text.
      if (refuseUnreadable(id)) {
        const { file: _ignored, ...rest } = patch;
        void _ignored;
        return commit(ws.updateTab(stateRef.current, id, rest));
      }
      const format = patch.file.format;
      const changed = !sameFormat(format, cur.format);
      // A Convert to a wider encoding may make held text writable again.
      const held = changed && cur.held === "unencodable" ? null : cur.held;
      commit(
        ws.updateTab(stateRef.current, id, {
          ...patch,
          file: { ...cur, format, held },
        }),
      );
      // A Convert is a Pending edit: write the File in its new form.
      if (changed) keepAside(id);
    },
    [commit, keepAside, refuseUnreadable, stateRef, tabOf],
  );

  const updateTab = useCallback(
    (id: string, patch: Partial<TabState>) => {
      // A Convert needs the Tab's text (it is written right away), and a held
      // Tab's text is its shadow, read only while it is still held: apply it
      // once the text has loaded, never before.
      if (patch.file && tabOf(id)?.file && !contents.has(id)) {
        void loadContent(id).then(() => {
          if (contents.has(id)) applyTabPatch(id, patch);
        }, logError("load for convert"));
        return;
      }
      applyTabPatch(id, patch);
    },
    [applyTabPatch, contents, loadContent, tabOf],
  );

  return {
    keepMine,
    loadDiskVersion,
    saveToOriginal,
    reopenWithEncoding,
    convert,
    requestFormat,
    updateTab,
  };
}
