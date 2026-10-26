import { useCallback, useEffect, useRef, useState } from "react";
import {
  fileFingerprint,
  filePickOpen,
  filePickSave,
  fileRead,
  fileRename,
  fileRereadAs,
  fileSaveAs,
  fileWatch,
  fileWrite,
  onFileChanged,
  onOpenPaths,
  shadowDelete,
  shadowList,
  shadowRead,
  shadowWrite,
  takeLaunchPaths,
  type FileError,
  type FileRead,
  type OpenPaths,
  type WriteOutcome,
} from "../files/api";
import { decide, onWriteOutcome, type DiskEvent } from "../files/fileState";
import { baseName, languageOf, stemOf, suggestedName } from "../files/paths";
import type {
  FileFormat,
  FileInfo,
  TabState,
  WorkspaceState,
} from "../model/types";
import * as ws from "../model/workspace";
import { deriveTitle } from "../model/title";
import {
  deleteScratchpad,
  readScratchpad,
  reopenScratchpad,
  writeScratchpad,
} from "../storage/api";
import type { Saver } from "../storage/autosave";
import type { KeyedLock } from "./keyedLock";
import { logError } from "./workspaceEffects";

export const NOTICE_MS = 4000;

/** The workspace internals useFiles works on; all but state/ready are stable. */
export interface FilesInternals {
  state: WorkspaceState;
  ready: boolean;
  stateRef: { current: WorkspaceState };
  commit(next: WorkspaceState): void;
  /** Latest text per loaded Tab. */
  contents: Map<string, string>;
  /** Text known to be in the Document's own storage (scratchpad or File). */
  onDisk: Map<string, string>;
  saver: Saver;
  lock: KeyedLock;
  freshId(): string;
  track(p: Promise<void>): Promise<void>;
  saveSessionNow(): Promise<void>;
  keepTitle(id: string, text: string): void;
  keyOf(path: string): string;
  newFileFormat: FileFormat;
  /**
   * Held Tabs whose shadow couldn't be read (this run only, never saved):
   * their shadow is never deleted or overwritten, nothing can be typed into
   * them, and they can't be moved, until the shadow reads again.
   */
  keptShadows: Set<string>;
  /** Tabs being closed: disk checks leave them to the close. */
  closing: { current: ReadonlySet<string> };
}

export interface ConvertRequest {
  seq: number;
  id: string;
  patch: Partial<FileFormat>;
}

/** Replace a Tab's text as one undoable step (reload, Load disk version). */
export interface ReplaceRequest {
  seq: number;
  id: string;
  text: string;
}

export interface FormatRequest {
  seq: number;
  kind: "beautify" | "minify";
}

/** What useFiles adds to the Workspace. */
export interface FilesApi {
  openPaths(paths: string[]): Promise<void>;
  pickAndOpen(): Promise<void>;
  /** Scratchpad: Save As. File: write now. */
  save(id: string): Promise<void>;
  saveAs(id: string): Promise<void>;
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
  /** `index` into Recently Closed, newest first. */
  reopenEntry(index: number): Promise<void>;
  requestFormat(kind?: FormatRequest["kind"]): void;
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
}

type DiskRead =
  | { kind: "ok"; read: FileRead }
  | { kind: "missing" }
  | { kind: "failed"; err: FileError };

function asFileError(err: unknown): FileError {
  if (typeof err === "object" && err !== null && "kind" in err) {
    const e = err as Partial<FileError>;
    return { kind: e.kind ?? "io", message: String(e.message ?? "") };
  }
  return { kind: "io", message: String(err) };
}

async function readDisk(path: string): Promise<DiskRead> {
  try {
    return { kind: "ok", read: await fileRead(path) };
  } catch (err) {
    const e = asFileError(err);
    if (e.kind === "io") {
      const fp = await fileFingerprint(path).catch(() => undefined);
      if (fp === null) return { kind: "missing" };
    }
    return { kind: "failed", err: e };
  }
}

function openFailure(name: string, e: FileError): string {
  if (e.kind === "too_large") return "Too large to open yet";
  if (e.kind === "not_a_file") return "Open files, not folders";
  return `Can't open ${name}: ${e.message}`;
}

const fileInfoOf = (path: string, r: FileRead): FileInfo => ({
  path,
  format: r.format,
  fingerprint: r.fingerprint,
  held: r.readable ? null : "readonly",
});

const sameFormat = (a: FileFormat, b: FileFormat) =>
  a.encoding === b.encoding &&
  a.bom === b.bom &&
  a.lineEnding === b.lineEnding &&
  a.mixed === b.mixed;

export function useFiles(
  x: FilesInternals,
): FilesApi & { internal: FilesInternalApi } {
  const { stateRef, commit, contents, onDisk, saver, lock, freshId } = x;
  const { track, saveSessionNow, keepTitle, keyOf, newFileFormat } = x;
  const { keptShadows, closing } = x;
  const [notice, setNotice] = useState<string | null>(null);
  const [convertRequest, setConvert] = useState<ConvertRequest | null>(null);
  const [formatRequest, setFormat] = useState<FormatRequest | null>(null);
  const [replaceRequests, setReplace] = useState<ReplaceRequest[]>([]);
  const [shadowUnreadable, setUnreadable] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const seq = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loads = useRef(new Map<string, Promise<string>>());
  const opening = useRef<Promise<void>>(Promise.resolve());
  const [ready] = useState(() => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  });

  const tabOf = useCallback(
    (id: string) => stateRef.current.tabs.find((t) => t.id === id),
    [stateRef],
  );

  const patchFile = useCallback(
    (id: string, file: FileInfo) =>
      commit(ws.updateTab(stateRef.current, id, { file })),
    [commit, stateRef],
  );

  const showNotice = useCallback((text: string) => {
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => {
      noticeTimer.current = null;
      setNotice(null);
    }, NOTICE_MS);
  }, []);

  /** Edits not yet in the File itself (held text counts). */
  const hasPending = useCallback(
    (id: string) => contents.has(id) && contents.get(id) !== onDisk.get(id),
    [contents, onDisk],
  );

  /** Get the Tab's text into its shadow soon (it's held now). */
  const keepAside = useCallback(
    (id: string) => saver.schedule(id, () => contents.get(id) ?? ""),
    [contents, saver],
  );

  const hold = useCallback(
    (id: string, file: FileInfo, held: FileInfo["held"]) => {
      if (file.held === held) return;
      patchFile(id, { ...file, held });
      keepAside(id);
    },
    [keepAside, patchFile],
  );

  /** The disk's text is now the Tab's text, as one undoable editor step. */
  const replaceText = useCallback(
    (id: string, text: string) => {
      contents.set(id, text);
      onDisk.set(id, text);
      const n = ++seq.current;
      setReplace((list) => [
        ...list.filter(
          (r) =>
            r.id !== id && stateRef.current.tabs.some((t) => t.id === r.id),
        ),
        { seq: n, id, text },
      ]);
    },
    [contents, onDisk, stateRef],
  );

  const markUnreadable = useCallback(
    (id: string, on: boolean) => {
      if (keptShadows.has(id) === on) return;
      if (on) keptShadows.add(id);
      else keptShadows.delete(id);
      setUnreadable(new Set(keptShadows));
    },
    [keptShadows],
  );

  const dropShadow = useCallback(
    async (id: string) => {
      if (keptShadows.has(id)) return;
      await shadowDelete(id).catch(logError("delete shadow"));
    },
    [keptShadows],
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

  // --- Loading -------------------------------------------------------------

  const readFileText = useCallback(
    async (id: string, file: FileInfo): Promise<string> => {
      if (file.held !== null && file.held !== "readonly") {
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

  /** A held Tab may already be resolved on disk (a Missing File came back). */
  const recheckSoon = useRef<(id: string) => void>(() => {});

  const loadContent = useCallback(
    (id: string): Promise<string> => {
      const have = contents.get(id);
      if (have !== undefined) return Promise.resolve(have);
      let p = loads.current.get(id);
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
          .finally(() => loads.current.delete(id));
        loads.current.set(id, p);
        if (file && file.held !== null && file.held !== "readonly") {
          void p.then(
            () => recheckSoon.current(id),
            () => {},
          );
        }
      }
      return p;
    },
    [contents, keepTitle, onDisk, readFileText, tabOf],
  );

  // --- Opening -------------------------------------------------------------

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
            ...ws.newTabState(id),
            title: baseName(path),
            language: languageOf(path),
            languageGuessed: true,
            file: fileInfoOf(path, r.read),
          };
          return commit(ws.openFileTab(stateRef.current, fresh));
        }
      }
      commit(ws.activate(stateRef.current, tab.id));
    },
    [commit, contents, freshId, keyOf, onDisk, showNotice, stateRef],
  );

  /** Opens one after another, so the last one ends up active. */
  const openPaths = useCallback(
    (paths: string[]): Promise<void> => {
      const run = opening.current.then(async () => {
        for (const p of paths) await openOne(p);
      });
      opening.current = run.catch(logError("open files"));
      return opening.current;
    },
    [openOne],
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

  // --- Disk changes --------------------------------------------------------

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
      if (typed !== undefined && contents.get(id) !== typed) {
        return hold(id, cur, "conflict");
      }
      patchFile(id, fileInfoOf(cur.path, r.read));
      replaceText(id, r.read.text);
      if (cur.held !== null) await dropShadow(id);
    },
    [
      contents,
      dropShadow,
      hold,
      keptShadows,
      patchFile,
      replaceText,
      showNotice,
      tabOf,
    ],
  );

  /**
   * Under the lock: compare the disk with what the Tab last saw. The watcher
   * event only says "look"; the decision uses the disk as it is now.
   */
  const recheck = useCallback(
    async (id: string, path?: string) => {
      const file = tabOf(id)?.file;
      if (!file || (path !== undefined && file.path !== path)) return;
      // A Tab not loaded yet reads the disk when it is.
      if (!contents.has(id) || loads.current.has(id)) return;
      if (keptShadows.has(id) || closing.current.has(id)) return;
      let disk;
      try {
        disk = await fileFingerprint(file.path);
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
          if (disk && cur.held === null)
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
      patchFile,
      reloadLocked,
      tabOf,
    ],
  );

  useEffect(() => {
    recheckSoon.current = (id) =>
      void lock(id, () => recheck(id)).catch(logError("check file"));
  }, [lock, recheck]);

  const recheckAll = useCallback(() => {
    for (const t of stateRef.current.tabs) {
      if (t.file) {
        void lock(t.id, () => recheck(t.id)).catch(logError("check file"));
      }
    }
  }, [lock, recheck, stateRef]);

  // --- Bar actions ---------------------------------------------------------

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
    [contents, hold, loadContent, lock, showNotice, tabOf, wrote],
  );

  const loadDiskVersion = useCallback(
    (id: string) =>
      lock(id, () => {
        const path = tabOf(id)?.file?.path;
        return path
          ? reloadLocked(id, () => readDisk(path))
          : Promise.resolve();
      }),
    [lock, reloadLocked, tabOf],
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
    [refuseUnreadable],
  );

  const requestFormat = useCallback(
    (kind: FormatRequest["kind"] = "beautify") =>
      setFormat((r) => ({ seq: (r?.seq ?? 0) + 1, kind })),
    [],
  );

  const updateTab = useCallback(
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

  // --- Save, Save As, rename -----------------------------------------------

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
    [commit, lock, saveSessionNow, showNotice, stateRef, tabOf],
  );

  // --- Close and reopen ----------------------------------------------------

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
        loads.current.delete(id);
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
    [contents, dropShadow, keptShadows, lock, markUnreadable, patchFile, tabOf],
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
        recheckSoon.current(id);
      }
      return true;
    },
    [
      commit,
      contents,
      keptShadows,
      keyOf,
      onDisk,
      readShadow,
      saver,
      showNotice,
      stateRef,
    ],
  );

  const reopenEntry = useCallback(
    (index: number): Promise<void> => {
      const entry = stateRef.current.closed[index];
      if (!entry) return Promise.resolve();
      const id = entry.tab.id;
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

  // --- Restore -------------------------------------------------------------

  /**
   * A shadow file that no Tab or Recently Closed entry refers to (its entry
   * was dropped) is recovered as a new Scratchpad, then deleted: unsaved text
   * is never thrown away.
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
      const known = new Set([
        ...state.tabs.map((t) => t.id),
        ...state.closed.map((e) => e.tab.id),
      ]);
      let next = state;
      for (const orphan of ids.filter((id) => !known.has(id))) {
        try {
          const text = await shadowRead(orphan);
          if (text === null) continue;
          if (text !== "") {
            const id = freshId();
            await writeScratchpad(id, text);
            contents.set(id, text);
            onDisk.set(id, text);
            const tab = { ...ws.newTabState(id), title: deriveTitle(text) };
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

  // --- Effects -------------------------------------------------------------

  useEffect(() => {
    if (x.ready) ready.resolve();
  }, [x.ready, ready]);

  // Events: disk changes, and paths from a second launch or a drop.
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

  // Launch paths open on top of the restored Session.
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

  // A backstop for missed watcher events.
  useEffect(() => {
    window.addEventListener("focus", recheckAll);
    return () => window.removeEventListener("focus", recheckAll);
  }, [recheckAll]);

  // Watch exactly the open Files.
  const watched = useRef<string | null>(null);
  const tabs = x.state.tabs;
  useEffect(() => {
    if (!x.ready) return;
    const paths = tabs.flatMap((t) => (t.file ? [t.file.path] : []));
    const key = JSON.stringify(paths);
    if (key === watched.current) return;
    watched.current = key;
    fileWatch(paths).catch(logError("watch files"));
  }, [x.ready, tabs]);

  useEffect(
    () => () => {
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    },
    [],
  );

  return {
    openPaths,
    pickAndOpen,
    save,
    saveAs,
    keepMine,
    loadDiskVersion,
    saveToOriginal,
    reopenWithEncoding,
    hasPending,
    convert,
    renameFile,
    reopenEntry,
    requestFormat,
    notice,
    convertRequest,
    replaceRequests,
    formatRequest,
    shadowUnreadable,
    internal: {
      loadContent,
      updateTab,
      afterRestore,
      closeFile,
      refuseEdit: refuseUnreadable,
    },
  };
}
