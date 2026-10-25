import { invoke } from "@tauri-apps/api/core";

/** Error shape serialized by the Rust storage commands. */
export interface StorageError {
  kind: "invalid_id" | "io";
  message: string;
}

export const readScratchpad = (id: string): Promise<string> =>
  invoke<string>("scratchpad_read", { id });

export const writeScratchpad = (id: string, content: string): Promise<void> =>
  invoke<void>("scratchpad_write", { id, content });

export const deleteScratchpad = (id: string): Promise<void> =>
  invoke<void>("scratchpad_delete", { id });

export const closeScratchpad = (id: string): Promise<void> =>
  invoke<void>("scratchpad_close", { id });

export const reopenScratchpad = (id: string): Promise<void> =>
  invoke<void>("scratchpad_reopen", { id });

export const listScratchpads = (): Promise<string[]> =>
  invoke<string[]>("scratchpad_list");

export const purgeClosed = (ids: string[]): Promise<void> =>
  invoke<void>("scratchpad_purge_closed", { ids });

export const readSession = (): Promise<string | null> =>
  invoke<string | null>("session_read");

export const writeSession = (json: string): Promise<void> =>
  invoke<void>("session_write", { json });
