import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Platform } from "../app/shortcuts";
import type { FileFormat, Fingerprint } from "../model/types";

export interface FileRead {
  text: string;
  format: FileFormat;
  readable: boolean;
  fingerprint: Fingerprint;
}

export type WriteOutcome =
  | { kind: "written"; fingerprint: Fingerprint }
  | { kind: "conflict"; fingerprint: Fingerprint }
  | { kind: "missing" }
  | { kind: "unencodable"; ch: string; line: number; col: number };

export interface FileError {
  kind:
    | "io"
    | "not_granted"
    | "not_a_file"
    | "too_large"
    | "exists"
    | "invalid_name";
  message: string;
}

export interface OpenPaths {
  paths: string[];
  folders: string[];
  missing: string[];
}

export interface FileChanged {
  /** The exact granted canonical string. */
  path: string;
  kind: "changed" | "removed";
}

export const fileRead = (path: string): Promise<FileRead> =>
  invoke<FileRead>("file_read", { path });

export const fileRereadAs = (
  path: string,
  encoding: string,
): Promise<FileRead> => invoke<FileRead>("file_reread_as", { path, encoding });

export const fileWrite = (
  path: string,
  text: string,
  format: FileFormat,
  expected: Fingerprint,
): Promise<WriteOutcome> =>
  invoke<WriteOutcome>("file_write", { path, text, format, expected });

export const fileSaveAs = (
  path: string,
  text: string,
  format: FileFormat,
): Promise<WriteOutcome> =>
  invoke<WriteOutcome>("file_save_as", { path, text, format });

export const fileRename = (path: string, newStem: string): Promise<string> =>
  invoke<string>("file_rename", { path, newStem });

export const fileFingerprint = (path: string): Promise<Fingerprint | null> =>
  invoke<Fingerprint | null>("file_fingerprint", { path });

/**
 * For re-checks only (never before a write): `expected` back unchanged,
 * without hashing, when the file's time and size still match it.
 */
export const fileFingerprintQuick = (
  path: string,
  expected: Fingerprint,
): Promise<Fingerprint | null> =>
  invoke<Fingerprint | null>("file_fingerprint_quick", { path, expected });

export const filePickOpen = (): Promise<string[]> =>
  invoke<string[]>("file_pick_open");

export const filePickSave = (suggestedName: string): Promise<string | null> =>
  invoke<string | null>("file_pick_save", { suggestedName });

export const shadowWrite = (id: string, text: string): Promise<void> =>
  invoke<void>("shadow_write", { id, text });

export const shadowRead = (id: string): Promise<string | null> =>
  invoke<string | null>("shadow_read", { id });

export const shadowDelete = (id: string): Promise<void> =>
  invoke<void>("shadow_delete", { id });

export const shadowList = (): Promise<string[]> =>
  invoke<string[]>("shadow_list");

export const fileWatch = (paths: string[]): Promise<void> =>
  invoke<void>("file_watch", { paths });

export const takeLaunchPaths = (): Promise<OpenPaths> =>
  invoke<OpenPaths>("take_launch_paths");

/** The Session File paths Rust granted under exactly that spelling. */
export const grantsFilter = (paths: string[]): Promise<string[]> =>
  invoke<string[]>("grants_filter", { paths });

export const onFileChanged = (
  cb: (e: FileChanged) => void,
): Promise<UnlistenFn> =>
  listen<FileChanged>("zukai://file-changed", (e) => cb(e.payload));

export const onOpenPaths = (cb: (e: OpenPaths) => void): Promise<UnlistenFn> =>
  listen<OpenPaths>("zukai://open-paths", (e) => cb(e.payload));

/** The key two spellings of one path share: case-insensitive on Windows and macOS. */
export function pathKey(path: string, platform: Platform): string {
  return platform === "mac" || platform === "windows"
    ? path.toLowerCase()
    : path;
}
