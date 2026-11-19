import { useCallback, useEffect, useRef } from "react";
import {
  fileFingerprint,
  fileFingerprintQuick,
  fileWatch,
  onFileChanged,
  onOpenPaths,
  type OpenPaths,
} from "../../files/api";
import { decide, inShadow, type DiskEvent } from "../../files/fileState";
import { baseName } from "../../files/paths";
import type { WorkspaceState } from "../../model/types";
import * as ws from "../../model/workspace";
import { logError } from "../workspaceEffects";
import {
  fileInfoOf,
  openFailure,
  readDisk,
  sameFingerprint,
  type DiskRead,
  type FilesContext,
} from "./context";

/** Disk changes: re-checks, reloads, and what triggers them. */
export function useDiskChanges(
  c: FilesContext,
  refuseUnreadable: (id: string) => boolean,
) {
  const { stateRef, contents, lock, keptShadows, closing } = c;
  const { richPending } = c;
  const { loadsRef, recheckSoonRef } = c;
  const { tabOf, patchFile, showNotice, hasPending } = c;
  const { hold, replaceText, dropShadow } = c;

  /**
   * Under the lock: read the File again and show the disk's text. A silent
   * reload passes `typed`, the Tab's text when it decided to reload: text
   * typed during the read makes it a Disk conflict instead, so no keystroke
   * is lost. An explicit one (Load disk version) discards the edits.
   */
  const reloadLocked = useCallback(
    async (id: string, read: () => Promise<DiskRead>, typed?: string) => {
      const file = tabOf(id)?.file;
      if (!file) return;
      if (refuseUnreadable(id)) return;
      const r = await read();
      const cur = tabOf(id)?.file;
      if (!cur || cur.path !== file.path) return;
      if (r.kind === "missing") return hold(id, cur, "missing");
      if (r.kind === "failed") {
        return showNotice(openFailure(baseName(cur.path), r.err));
      }
      // Typed during the read, in the plain editor (in contents) or in the
      // rich one (still pending there; the hold writes it first).
      if (
        typed !== undefined &&
        (contents.get(id) !== typed || (richPending?.(id) ?? false))
      ) {
        return hold(id, cur, "conflict");
      }
      patchFile(id, fileInfoOf(cur.path, r.read));
      replaceText(id, r.read.text);
      if (inShadow(cur)) await dropShadow(id);
    },
    [
      contents,
      dropShadow,
      hold,
      patchFile,
      refuseUnreadable,
      replaceText,
      richPending,
      showNotice,
      tabOf,
    ],
  );

  /**
   * Under the lock: compare the disk with what the Tab last saw. The watcher
   * event only says "look"; the decision uses the disk as it is now.
   */
  const recheck = useCallback(
    async (id: string, path?: string, quick = false) => {
      const file = tabOf(id)?.file;
      if (!file || (path !== undefined && file.path !== path)) return;
      // A Tab not loaded yet reads the disk when it is.
      if (!contents.has(id) || loadsRef.current.has(id)) return;
      if (keptShadows.has(id) || closing.current.has(id)) return;
      let disk;
      try {
        // A focus re-check skips the hash when time and size still match;
        // watcher events and writes always compare the content.
        disk =
          quick && file.fingerprint
            ? await fileFingerprintQuick(file.path, file.fingerprint)
            : await fileFingerprint(file.path);
      } catch (err) {
        return logError("check file")(err);
      }
      const cur = tabOf(id)?.file;
      if (!cur || cur.path !== file.path) return;
      const ev: DiskEvent =
        disk === null
          ? { kind: "removed" }
          : cur.held === "missing"
            ? { kind: "reappeared", disk }
            : { kind: "changed", disk };
      switch (decide(cur, ev, hasPending(id))) {
        case "ignore":
          // Same content; remember the new time so the next check is cheap.
          if (disk && cur.held === null && !sameFingerprint(cur, disk))
            patchFile(id, { ...cur, fingerprint: disk });
          return;
        case "reload":
          return reloadLocked(
            id,
            () => readDisk(cur.path),
            contents.get(id) ?? "",
          );
        case "conflict":
          return hold(id, cur, "conflict");
        case "missing":
          return hold(id, cur, "missing");
      }
    },
    [
      closing,
      contents,
      hasPending,
      hold,
      keptShadows,
      loadsRef,
      patchFile,
      reloadLocked,
      tabOf,
    ],
  );

  useEffect(() => {
    recheckSoonRef.current = (id) =>
      void lock(id, () => recheck(id)).catch(logError("check file"));
  }, [lock, recheck, recheckSoonRef]);

  const recheckAll = useCallback(() => {
    for (const t of stateRef.current.tabs) {
      if (t.file) {
        void lock(t.id, () => recheck(t.id, undefined, true)).catch(
          logError("check file"),
        );
      }
    }
  }, [lock, recheck, stateRef]);

  return { reloadLocked, recheck, recheckAll };
}

/** Events: disk changes, and paths from a second launch or a drop. */
export function useFileEvents(
  c: FilesContext,
  recheck: (id: string, path?: string) => Promise<void>,
  openFrom: (e: OpenPaths) => Promise<void>,
) {
  const { stateRef, lock, keyOf, ready } = c;
  useEffect(() => {
    let cancelled = false;
    const offs: (() => void)[] = [];
    const keep = (p: Promise<() => void>, what: string) =>
      p.then((off) => (cancelled ? off() : offs.push(off)), logError(what));
    keep(
      onFileChanged((e) => {
        const tab = ws.findByPath(stateRef.current, keyOf(e.path), keyOf);
        const path = tab?.file?.path;
        if (tab && path) {
          void lock(tab.id, () => recheck(tab.id, path)).catch(
            logError("check file"),
          );
        }
      }),
      "listen file changes",
    );
    keep(
      onOpenPaths((e) => void ready.promise.then(() => openFrom(e))),
      "listen open paths",
    );
    return () => {
      cancelled = true;
      offs.forEach((off) => off());
    };
  }, [keyOf, lock, openFrom, ready, recheck, stateRef]);
}

/** A focus re-check (a backstop for missed watcher events). */
export function useFocusRecheck(recheckAll: () => void) {
  useEffect(() => {
    window.addEventListener("focus", recheckAll);
    return () => window.removeEventListener("focus", recheckAll);
  }, [recheckAll]);
}

/** Watch exactly the open Files. */
export function useWatchFiles(ready: boolean, tabs: WorkspaceState["tabs"]) {
  const watched = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    // Sorted: reordering Tabs doesn't rebuild the watcher.
    const paths = tabs.flatMap((t) => (t.file ? [t.file.path] : [])).sort();
    const key = JSON.stringify(paths);
    if (key === watched.current) return;
    watched.current = key;
    fileWatch(paths).catch(logError("watch files"));
  }, [ready, tabs]);
}
