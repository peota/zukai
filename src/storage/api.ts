import { invoke } from "@tauri-apps/api/core";
import type { ClosedFile, ScratchExt, ScratchFile } from "../model/session";

export const readScratchpad = (id: string): Promise<string> =>
  invoke<string>("scratchpad_read", { id });

export const writeScratchpad = (
  id: string,
  content: string,
  ext: ScratchExt,
): Promise<void> => invoke<void>("scratchpad_write", { id, content, ext });

export const deleteScratchpad = (id: string): Promise<void> =>
  invoke<void>("scratchpad_delete", { id });

export const closeScratchpad = (id: string): Promise<void> =>
  invoke<void>("scratchpad_close", { id });

export const reopenScratchpad = (id: string): Promise<void> =>
  invoke<void>("scratchpad_reopen", { id });

export const listScratchpads = (): Promise<ScratchFile[]> =>
  invoke<ScratchFile[]>("scratchpad_list");

export const listClosedScratchpads = (): Promise<ClosedFile[]> =>
  invoke<ClosedFile[]>("scratchpad_list_closed");

export const purgeClosed = (ids: string[]): Promise<void> =>
  invoke<void>("scratchpad_purge_closed", { ids });

export const readSession = (): Promise<string | null> =>
  invoke<string | null>("session_read");

export const writeSession = (json: string): Promise<void> =>
  invoke<void>("session_write", { json });

/** Copy session.json to session.json.bak before a broken one is overwritten. */
export const backupSession = (): Promise<void> =>
  invoke<void>("session_backup");

/** Append a startup milestone to the diagnostic startup.log. */
export const startupMark = (event: string): Promise<void> =>
  invoke<void>("app_startup_mark", { event });
