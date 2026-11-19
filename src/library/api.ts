import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { FileError } from "../files/api";

export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  link: "inside" | "outside" | null;
}

/** A folder added to the sidebar beside the Library. */
export interface AddedState {
  path: string;
  available: boolean;
}

export interface RootState {
  root: string | null;
  available: boolean;
  /** The added folders, in the order added. */
  added: AddedState[];
  /** Names of added folders dropped because a re-pointed Library overlaps them. */
  removed?: string[];
}

export interface CopyResult {
  path: string | null;
  error: FileError | null;
}

export interface SearchResult {
  entries: Entry[];
  ready: boolean;
}

/** A file Quick open offers. */
export interface QuickHit {
  entry: Entry;
  /** Its path relative to its tree, `/`-separated: what was matched. */
  rel: string;
  /** The matched characters of `rel`, as code-point indices. */
  positions: number[];
  score: number;
}

export interface QuickResult {
  /** Best first. */
  hits: QuickHit[];
  ready: boolean;
}

export interface LibraryChanged {
  dirs: string[];
}

/** A drop from outside onto a Library folder: what was copied. */
export interface LibraryDropped {
  dir: string;
  copied: number;
  /** Names that couldn't be copied. */
  failed: string[];
}

/** An OS drag over the window, in CSS pixels; `null` when it left or dropped. */
export type DragPoint = { x: number; y: number } | null;

export const libraryRoot = (): Promise<RootState> => invoke("library_root");
export const libraryUseDefault = (): Promise<RootState> =>
  invoke("library_use_default");
/** `openPaths`: the Files the UI holds, kept granted if an added folder goes. */
export const libraryChoose = (openPaths: string[]): Promise<RootState> =>
  invoke("library_choose", { openPaths });
/** Opens the folder picker; cancelling resolves to the current state. */
export const libraryAddFolder = (): Promise<RootState> =>
  invoke("library_add_folder");
/** Picks the folder that replaces the added `path` (missing or moved). */
export const libraryLocateFolder = (path: string): Promise<RootState> =>
  invoke("library_locate_folder", { path });
/** Forgets the added `path`; `openPaths` under it keep their file grants. */
export const libraryRemoveFolder = (
  path: string,
  openPaths: string[],
): Promise<RootState> => invoke("library_remove_folder", { path, openPaths });
/** Creates the stored root's folder again ("Create it again"). */
export const libraryRecreate = (): Promise<RootState> =>
  invoke("library_recreate");
export const libraryList = (dir: string): Promise<Entry[]> =>
  invoke("library_list", { dir });
export const libraryCreateFolder = (
  parent: string,
  name: string,
): Promise<string> => invoke("library_create_folder", { parent, name });
export const libraryCreateFile = (
  parent: string,
  stem: string,
  ext: string,
): Promise<string> => invoke("library_create_file", { parent, stem, ext });
export const libraryRename = (path: string, newName: string): Promise<string> =>
  invoke("library_rename", { path, newName });
export const libraryMove = (path: string, destDir: string): Promise<string> =>
  invoke("library_move", { path, destDir });
export const libraryCopyInto = (
  srcs: string[],
  destDir: string,
): Promise<CopyResult[]> => invoke("library_copy_into", { srcs, destDir });
/** The canonical path a Library file opens as (an inside link's target). */
export const libraryResolve = (path: string): Promise<string> =>
  invoke("library_resolve", { path });
export const libraryTrash = (path: string): Promise<void> =>
  invoke("library_trash", { path });
export const libraryReveal = (path: string): Promise<void> =>
  invoke("library_reveal", { path });
export const librarySearch = (query: string): Promise<SearchResult> =>
  invoke("library_search", { query });
/** Quick open: the best files whose relative path fuzzy-matches `query`. */
export const libraryQuickOpen = (query: string): Promise<QuickResult> =>
  invoke("library_quick_open", { query });
export const libraryWatch = (): Promise<void> => invoke("library_watch");
/**
 * After `from` became `to`: where each of `paths` (Files the UI holds) is
 * now, granted exactly as returned; null for one Rust didn't confirm.
 */
export const libraryFollow = (
  from: string,
  to: string,
  paths: string[],
): Promise<(string | null)[]> => invoke("library_follow", { from, to, paths });
/** A new empty `stem.ext` (or `stem (2).ext`…) in `parent`, to save into. */
export const libraryReserve = (
  parent: string,
  stem: string,
  ext: string,
): Promise<string> => invoke("library_reserve", { parent, stem, ext });
/** The folder an OS drag is over: a drop then copies into it. */
export const librarySetDropTarget = (dir: string | null): Promise<void> =>
  invoke("library_set_drop_target", { dir });
/** Rebuilds the name index if it is older than 30 s (on window focus). */
export const libraryResync = (): Promise<boolean> => invoke("library_resync");

export const onLibraryChanged = (
  cb: (e: LibraryChanged) => void,
): Promise<UnlistenFn> =>
  listen<LibraryChanged>("zukai://library-changed", (e) => cb(e.payload));

export const onLibraryDropped = (
  cb: (e: LibraryDropped) => void,
): Promise<UnlistenFn> =>
  listen<LibraryDropped>("zukai://library-dropped", (e) => cb(e.payload));

/** OS drags over the window (Rust receives the drop itself). */
export const onDragDrop = (cb: (p: DragPoint) => void): Promise<UnlistenFn> =>
  getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === "enter" || p.type === "over") {
      const scale = window.devicePixelRatio || 1;
      cb({ x: p.position.x / scale, y: p.position.y / scale });
    } else {
      cb(null);
    }
  });
