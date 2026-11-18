import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FileError } from "../files/api";

export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  link: "inside" | "outside" | null;
}

export interface RootState {
  root: string | null;
  available: boolean;
}

export interface CopyResult {
  path: string | null;
  error: FileError | null;
}

export interface SearchResult {
  entries: Entry[];
  ready: boolean;
}

export interface LibraryChanged {
  dirs: string[];
}

export const libraryRoot = (): Promise<RootState> => invoke("library_root");
export const libraryUseDefault = (): Promise<RootState> =>
  invoke("library_use_default");
export const libraryChoose = (): Promise<RootState> => invoke("library_choose");
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
export const libraryTrash = (path: string): Promise<void> =>
  invoke("library_trash", { path });
export const libraryReveal = (path: string): Promise<void> =>
  invoke("library_reveal", { path });
export const librarySearch = (query: string): Promise<SearchResult> =>
  invoke("library_search", { query });
export const libraryWatch = (): Promise<void> => invoke("library_watch");

export const onLibraryChanged = (
  cb: (e: LibraryChanged) => void,
): Promise<UnlistenFn> =>
  listen<LibraryChanged>("zukai://library-changed", (e) => cb(e.payload));
