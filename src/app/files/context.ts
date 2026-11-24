import { useCallback, useRef, useState } from "react";
import {
  fileFingerprint,
  fileRead,
  shadowDelete,
  type FileError,
  type FileRead,
} from "../../files/api";
import type {
  FileFormat,
  FileInfo,
  Fingerprint,
  TabState,
  WorkspaceState,
} from "../../model/types";
import { sameContent } from "../../files/fileState";
import * as ws from "../../model/workspace";
import type { Saver } from "../../storage/autosave";
import type { KeyedLock } from "../keyedLock";
import { logError } from "../workspaceEffects";

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
  /**
   * An explicit save: writes the File now (the writer's "save" mode) under
   * the Tab's lock. The lock isn't re-entrant: never call it while holding
   * that Tab's lock.
   */
  saveNow(id: string, text: string): Promise<void>;
  /** True when Files are saved automatically (the Settings switch). */
  autosaveFiles(): boolean;
  freshId(): string;
  track(p: Promise<void>): Promise<void>;
  saveSessionNow(): Promise<void>;
  keyOf(path: string): string;
  newFileFormat: FileFormat;
  /** Whether a newly opened File's Tab starts with word wrap on. */
  newTabWrap(): boolean;
  /**
   * Held Tabs whose shadow couldn't be read (this run only, never saved):
   * their shadow is never deleted or overwritten, nothing can be typed into
   * them, and they can't be moved, until the shadow reads again.
   */
  keptShadows: Set<string>;
  /** A rich editor holds an edit for the Tab not yet in its text. */
  richPending?(id: string): boolean;
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

export type DiskRead =
  | { kind: "ok"; read: FileRead }
  | { kind: "missing" }
  | { kind: "failed"; err: FileError };

export function asFileError(err: unknown): FileError {
  if (typeof err === "object" && err !== null && "kind" in err) {
    const e = err as Partial<FileError>;
    return { kind: e.kind ?? "io", message: String(e.message ?? "") };
  }
  return { kind: "io", message: String(err) };
}

export async function readDisk(path: string): Promise<DiskRead> {
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

/**
 * The disk under an unsaved File whose text comes from its shadow: its text
 * (undefined if it can't be read) and the hold it needs, if any. A changed
 * disk is a Disk conflict; a gone one is Missing.
 */
export async function unsavedDisk(
  file: FileInfo,
): Promise<{ text?: string; held: FileInfo["held"] }> {
  const r = await readDisk(file.path);
  if (r.kind === "missing") return { held: "missing" };
  // A failed read changes nothing: a later disk check tries again.
  if (r.kind === "failed") return { held: file.held };
  const same = sameContent(file.fingerprint, r.read.fingerprint);
  return { text: r.read.text, held: same ? file.held : "conflict" };
}

export function openFailure(name: string, e: FileError): string {
  if (e.kind === "too_large") return "Too large to open yet";
  if (e.kind === "not_a_file") return "Open files, not folders";
  return `Can't open ${name}: ${e.message}`;
}

export const fileInfoOf = (path: string, r: FileRead): FileInfo => ({
  path,
  format: r.format,
  fingerprint: r.fingerprint,
  held: r.readable ? null : "readonly",
});

/**
 * A File whose text is the disk's (no shadow): nothing unsaved, and its
 * format the disk's.
 */
export function settledFile(file: FileInfo): FileInfo {
  const next: FileInfo = { ...file, format: file.diskFormat ?? file.format };
  delete next.unsaved;
  delete next.diskFormat;
  return next;
}

export const sameFingerprint = (f: FileInfo, d: Fingerprint) =>
  f.fingerprint !== null &&
  f.fingerprint.mtimeMs === d.mtimeMs &&
  f.fingerprint.size === d.size &&
  f.fingerprint.hash === d.hash;

export const sameFormat = (a: FileFormat, b: FileFormat) =>
  a.encoding === b.encoding &&
  a.bom === b.bom &&
  a.lineEnding === b.lineEnding &&
  a.mixed === b.mixed;

type Setter<T> = (next: T | ((prev: T) => T)) => void;

/** What every piece of useFiles shares: the internals plus common helpers. */
export interface FilesContext extends Omit<FilesInternals, "state" | "ready"> {
  setNotice: Setter<string | null>;
  setConvert: Setter<ConvertRequest | null>;
  setFormat: Setter<FormatRequest | null>;
  setReplace: Setter<ReplaceRequest[]>;
  setUnreadable: Setter<ReadonlySet<string>>;
  noticeTimerRef: { current: ReturnType<typeof setTimeout> | null };
  loadsRef: { current: Map<string, Promise<string>> };
  openingRef: { current: Promise<void> };
  ready: { promise: Promise<void>; resolve: () => void };
  /** Loads a Tab's text; set by useLoading (loadContent is defined there). */
  loadRef: { current: (id: string) => Promise<string> };
  /** A held Tab may already be resolved on disk (a Missing File came back). */
  recheckSoonRef: { current: (id: string) => void };
  tabOf(id: string): TabState | undefined;
  patchFile(id: string, file: FileInfo): void;
  showNotice(text: string): void;
  /** Edits not yet in the File itself (held or unsaved text counts). */
  hasPending(id: string): boolean;
  keepAside(id: string): void;
  hold(id: string, file: FileInfo, held: FileInfo["held"]): void;
  replaceText(id: string, text: string): void;
  dropShadow(id: string): Promise<void>;
}

/** The state, refs and common helpers; see FilesContext. */
export function useFilesContext(x: FilesInternals) {
  const { stateRef, commit, contents, onDisk, saver } = x;
  const { keptShadows } = x;
  const [notice, setNotice] = useState<string | null>(null);
  const [convertRequest, setConvert] = useState<ConvertRequest | null>(null);
  const [formatRequest, setFormat] = useState<FormatRequest | null>(null);
  const [replaceRequests, setReplace] = useState<ReplaceRequest[]>([]);
  const [shadowUnreadable, setUnreadable] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const seqRef = useRef(0);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadsRef = useRef(new Map<string, Promise<string>>());
  const openingRef = useRef<Promise<void>>(Promise.resolve());
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
    if (noticeTimerRef.current !== null) clearTimeout(noticeTimerRef.current);
    setNotice(text);
    noticeTimerRef.current = setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, NOTICE_MS);
  }, []);

  /** Edits not yet in the File itself (held or unsaved text counts). */
  const { richPending } = x;
  const hasPending = useCallback(
    (id: string) =>
      (richPending?.(id) ?? false) ||
      tabOf(id)?.file?.unsaved === true ||
      (contents.has(id) && contents.get(id) !== onDisk.get(id)),
    [contents, onDisk, richPending, tabOf],
  );

  /** Loads a Tab's text; set by useLoading (loadContent is defined there). */
  const loadRef = useRef<(id: string) => Promise<string>>(() =>
    Promise.reject(new Error("not ready")),
  );

  /**
   * Get the Tab's text written soon (to its shadow while held, otherwise to
   * the File). Never before its text loaded: the write would carry "".
   */
  const keepAside = useCallback(
    (id: string) => {
      // An Image Tab's text is a lossy decode of its bytes: never kept.
      if (stateRef.current.tabs.find((t) => t.id === id)?.kind === "image") {
        return;
      }
      const schedule = () => {
        if (
          !contents.has(id) ||
          !stateRef.current.tabs.some((t) => t.id === id)
        )
          return;
        saver.schedule(id, () => contents.get(id) ?? "");
      };
      if (contents.has(id)) return schedule();
      void loadRef.current(id).then(schedule, logError("load for write"));
    },
    [contents, saver, stateRef],
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
      const n = ++seqRef.current;
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

  const dropShadow = useCallback(
    async (id: string) => {
      if (keptShadows.has(id)) return;
      await shadowDelete(id).catch(logError("delete shadow"));
    },
    [keptShadows],
  );

  /** A held Tab may already be resolved on disk (a Missing File came back). */
  const recheckSoonRef = useRef<(id: string) => void>(() => {});

  const { state: _state, ready: _ready, ...internals } = x;
  void _state;
  void _ready;
  const c: FilesContext = {
    ...internals,
    setNotice,
    setConvert,
    setFormat,
    setReplace,
    setUnreadable,
    noticeTimerRef,
    loadsRef,
    openingRef,
    ready,
    loadRef,
    recheckSoonRef,
    tabOf,
    patchFile,
    showNotice,
    hasPending,
    keepAside,
    hold,
    replaceText,
    dropShadow,
  };
  return {
    c,
    notice,
    convertRequest,
    formatRequest,
    replaceRequests,
    shadowUnreadable,
  };
}
