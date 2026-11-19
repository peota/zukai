import { useCallback, useEffect } from "react";
import { filePickOpen, takeLaunchPaths, type OpenPaths } from "../../files/api";
import { baseName, languageOf } from "../../files/paths";
import { kindOf } from "../../model/kinds";
import type { TabState } from "../../model/types";
import * as ws from "../../model/workspace";
import { logError } from "../workspaceEffects";
import {
  fileInfoOf,
  openFailure,
  readDisk,
  type FilesContext,
} from "./context";

/** Opening Files: by path, from the OS, from the picker. */
export function useOpening(c: FilesContext) {
  const { stateRef, commit, contents, onDisk, freshId, keyOf } = c;
  const { openingRef, showNotice, newTabWrap } = c;

  const openOne = useCallback(
    async (path: string) => {
      const existing = () =>
        ws.findByPath(stateRef.current, keyOf(path), keyOf);
      let tab = existing();
      if (!tab) {
        const r = await readDisk(path);
        if (r.kind === "missing") {
          return showNotice(`Can't find ${baseName(path)}`);
        }
        if (r.kind === "failed") {
          return showNotice(openFailure(baseName(path), r.err));
        }
        tab = existing();
        if (!tab) {
          const id = freshId();
          contents.set(id, r.read.text);
          onDisk.set(id, r.read.text);
          const fresh: TabState = {
            ...ws.newTabState(id, kindOf(path)),
            title: baseName(path),
            language: languageOf(path),
            languageGuessed: true,
            wrap: newTabWrap(),
            file: fileInfoOf(path, r.read),
          };
          return commit(ws.openFileTab(stateRef.current, fresh, keyOf));
        }
      }
      commit(ws.activate(stateRef.current, tab.id));
    },
    [
      commit,
      contents,
      freshId,
      keyOf,
      newTabWrap,
      onDisk,
      showNotice,
      stateRef,
    ],
  );

  /** Opens one after another, so the last one ends up active. */
  const openPaths = useCallback(
    (paths: string[]): Promise<void> => {
      const run = openingRef.current.then(async () => {
        for (const p of paths) await openOne(p);
      });
      openingRef.current = run.catch(logError("open files"));
      return openingRef.current;
    },
    [openOne, openingRef],
  );

  const openFrom = useCallback(
    (e: OpenPaths) => {
      const parts: string[] = [];
      if (e.folders.length > 0) parts.push("Open files, not folders");
      if (e.missing.length > 0) {
        parts.push(`Can't find ${e.missing.map(baseName).join(", ")}`);
      }
      if (parts.length > 0) showNotice(parts.join(". "));
      return openPaths(e.paths);
    },
    [openPaths, showNotice],
  );

  const pickAndOpen = useCallback(async () => {
    const paths = await filePickOpen().catch((err: unknown) => {
      logError("open dialog")(err);
      return [] as string[];
    });
    await openPaths(paths);
  }, [openPaths]);

  return { openPaths, openFrom, pickAndOpen };
}

/** Launch paths open on top of the restored Session. */
export function useLaunchPaths(
  ready: FilesContext["ready"],
  openFrom: (e: OpenPaths) => Promise<void>,
) {
  useEffect(() => {
    let cancelled = false;
    void ready.promise.then(async () => {
      if (cancelled) return;
      try {
        await openFrom(await takeLaunchPaths());
      } catch (err) {
        logError("launch paths")(err);
      }
    });
    return () => {
      cancelled = true;
    };
    // Once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
