import { useCallback, useEffect } from "react";
import {
  fileFingerprint,
  shadowDelete,
  shadowList,
  shadowRead,
} from "../../files/api";
import { baseName } from "../../files/paths";
import type { FileInfo, TabState, WorkspaceState } from "../../model/types";
import * as ws from "../../model/workspace";
import { deriveTitle } from "../../model/title";
import { parseScene } from "../../canvas/scene";
import { readScratchpad, writeScratchpad } from "../../storage/api";
import { logError } from "../workspaceEffects";
import {
  asFileError,
  fileInfoOf,
  openFailure,
  readDisk,
  type FilesContext,
} from "./context";

/** Loading a Tab's text, the unreadable-shadow mask, and restore. */
export function useLoading(c: FilesContext) {
  const { contents, onDisk, freshId, keepTitle, keptShadows } = c;
  const { setUnreadable, loadsRef, loadRef, recheckSoonRef } = c;
  const { tabOf, patchFile, showNotice } = c;

  const markUnreadable = useCallback(
    (id: string, on: boolean) => {
      if (keptShadows.has(id) === on) return;
      if (on) keptShadows.add(id);
      else keptShadows.delete(id);
      setUnreadable(new Set(keptShadows));
    },
    [keptShadows, setUnreadable],
  );

  /**
   * A held Tab's shadow: its text, null if there is none, or undefined when
   * it can't be read. Then the Tab is shown read-only and its shadow kept.
   */
  const readShadow = useCallback(
    async (id: string, file: FileInfo): Promise<string | null | undefined> => {
      try {
        const text = await shadowRead(id);
        markUnreadable(id, false);
        return text;
      } catch (err) {
        logError("read shadow")(err);
        markUnreadable(id, true);
        const msg = asFileError(err).message;
        showNotice(
          `Can't read the unsaved text of ${baseName(file.path)}: ${msg}`,
        );
        return undefined;
      }
    },
    [markUnreadable, showNotice],
  );

  /** Refuses an action that would move or overwrite an unread shadow. */
  const refuseUnreadable = useCallback(
    (id: string): boolean => {
      if (!keptShadows.has(id)) return false;
      const path = tabOf(id)?.file?.path;
      showNotice(
        `${path ? baseName(path) : "This tab"} has unsaved text that can't be read yet`,
      );
      return true;
    },
    [keptShadows, showNotice, tabOf],
  );

  const readFileText = useCallback(
    async (id: string, file: FileInfo): Promise<string> => {
      // An Image has no shadow: it always reads its File.
      const image = tabOf(id)?.kind === "image";
      if (file.held !== null && file.held !== "readonly" && !image) {
        const kept = await readShadow(id, file);
        if (kept === undefined) {
          // It stays held as it was (that is what the Session keeps), and
          // nothing is written for it until its shadow reads again.
          onDisk.set(id, "");
          return "";
        }
        // The disk doesn't have this text: it stays pending.
        if (kept !== null) return kept;
      }
      const r = await readDisk(file.path);
      const cur = tabOf(id)?.file ?? file;
      if (r.kind === "ok") {
        patchFile(id, fileInfoOf(cur.path, r.read));
        onDisk.set(id, r.read.text);
        return r.read.text;
      }
      onDisk.set(id, "");
      if (r.kind === "missing") {
        patchFile(id, { ...cur, held: "missing" });
      } else {
        showNotice(openFailure(baseName(cur.path), r.err));
        patchFile(id, { ...cur, held: "readonly" });
      }
      return "";
    },
    [onDisk, patchFile, readShadow, showNotice, tabOf],
  );

  const loadContent = useCallback(
    (id: string): Promise<string> => {
      const have = contents.get(id);
      if (have !== undefined) return Promise.resolve(have);
      let p = loadsRef.current.get(id);
      if (!p) {
        const file = tabOf(id)?.file;
        const read = file
          ? readFileText(id, file)
          : readScratchpad(id).then((text) => {
              if (!onDisk.has(id)) onDisk.set(id, text);
              return text;
            });
        p = read
          .then((text) => {
            if (!contents.has(id)) contents.set(id, text);
            const loaded = contents.get(id)!;
            keepTitle(id, loaded);
            return loaded;
          })
          .finally(() => loadsRef.current.delete(id));
        loadsRef.current.set(id, p);
        if (file && file.held !== null && file.held !== "readonly") {
          void p.then(
            () => recheckSoonRef.current(id),
            () => {},
          );
        }
      }
      return p;
    },
    [
      contents,
      keepTitle,
      loadsRef,
      onDisk,
      readFileText,
      recheckSoonRef,
      tabOf,
    ],
  );

  useEffect(() => {
    loadRef.current = loadContent;
  }, [loadContent, loadRef]);

  /**
   * Shadow files are unsaved text, never thrown away:
   * - One whose File Tab (or Recently Closed entry) the Session doesn't say is
   *   held (a crash before the Session was saved) holds that Tab: a Disk
   *   conflict if the File exists, Missing if not, with the shadow as its text.
   * - One that no Tab or entry refers to (its entry was dropped) is recovered
   *   as a new Scratchpad (a Canvas if it is a drawing), then deleted.
   */
  const afterRestore = useCallback(
    async (state: WorkspaceState): Promise<WorkspaceState> => {
      let ids: string[];
      try {
        ids = await shadowList();
      } catch (err) {
        logError("list shadows")(err);
        return state;
      }
      const shadowed = new Set(ids);
      const holdIfShadowed = async (tab: TabState): Promise<TabState> => {
        const file = tab.file;
        if (!file || !shadowed.has(tab.id) || tab.kind === "image") return tab;
        if (file.held !== null && file.held !== "readonly") return tab;
        let gone = false;
        try {
          gone = (await fileFingerprint(file.path)) === null;
        } catch (err) {
          logError("check file")(err);
        }
        return {
          ...tab,
          file: { ...file, held: gone ? "missing" : "conflict" },
        };
      };
      let next: WorkspaceState = {
        ...state,
        tabs: await Promise.all(state.tabs.map(holdIfShadowed)),
        closed: await Promise.all(
          state.closed.map(async (e) => ({
            ...e,
            tab: await holdIfShadowed(e.tab),
          })),
        ),
      };
      const known = new Set([
        ...state.tabs.map((t) => t.id),
        ...state.closed.map((e) => e.tab.id),
      ]);
      for (const orphan of ids.filter((id) => !known.has(id))) {
        try {
          const text = await shadowRead(orphan);
          if (text === null) continue;
          if (text !== "") {
            // A shadow doesn't say whose it was: a drawing comes back as a
            // Canvas, anything else as text.
            const canvas = text.trim() !== "" && parseScene(text).ok;
            const id = freshId();
            await writeScratchpad(id, text, canvas ? "excalidraw" : "txt");
            contents.set(id, text);
            onDisk.set(id, text);
            const tab = canvas
              ? ws.newTabState(id, "canvas")
              : { ...ws.newTabState(id), title: deriveTitle(text) };
            next = { ...next, tabs: [...next.tabs, tab] };
          }
          await shadowDelete(orphan);
        } catch (err) {
          logError("recover shadow")(err);
        }
      }
      return next;
    },
    [contents, freshId, onDisk],
  );

  return {
    markUnreadable,
    readShadow,
    refuseUnreadable,
    loadContent,
    afterRestore,
  };
}
