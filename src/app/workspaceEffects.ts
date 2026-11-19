import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { installExitHandshake } from "./exit";
import { detectPlatform } from "./shortcuts";
import { grantsFilter, pathKey, shadowDelete } from "../files/api";
import type { SaveStatus, Saver } from "../storage/autosave";
import {
  DEFAULT_FONT_SIZE,
  defaultSidebar,
  parseSessionFile,
  restoreWorkspace,
  type ScratchFile,
  type SessionFile,
} from "../model/session";
import type { SidebarState, WorkspaceState } from "../model/types";
import {
  backupSession,
  listClosedScratchpads,
  listScratchpads,
  purgeClosed,
  readSession,
  reopenScratchpad,
} from "../storage/api";

const platform = detectPlatform();

export const logError = (what: string) => (err: unknown) =>
  console.error(what, err);

/** Flush both savers; rejects if either has a failed write. */
export function flushAll(savers: Saver[]): Promise<void> {
  return Promise.all(savers.map((s) => s.flush())).then(() => {});
}

/**
 * Read the scratchpad lists and session.json, rebuild the workspace, and purge
 * expired Recently Closed files. A failed read of any source degrades to
 * "nothing there": the others still recover what they can.
 *
 * - An open Tab whose file sits in `closed/` (a crash between moving it and
 *   writing the Session) has its file moved back before anything loads it.
 * - Files in `closed/` that the Session doesn't mention become Recently Closed.
 * - A session.json that exists but can't be read or parsed is copied to
 *   session.json.bak before the rebuilt Session overwrites it.
 */
export interface RestoreOptions {
  /**
   * Rust couldn't say which Session Files are granted (twice): every File Tab
   * was kept, and Session writes must wait until a later check succeeds.
   */
  onGrantsUnchecked?(): void;
  /** The sidebar state the Session holds (the default when there is none). */
  onSidebar?(sidebar: SidebarState): void;
  /** The editor font size the Session holds (the default when none). */
  onFontSize?(px: number): void;
}

export async function restoreSession(
  freshId: () => string,
  opts: RestoreOptions = {},
): Promise<WorkspaceState> {
  const [ids, json, closedList] = await Promise.allSettled([
    listScratchpads(),
    readSession(),
    listClosedScratchpads(),
  ]);
  if (ids.status === "rejected") logError("list scratchpads")(ids.reason);
  if (json.status === "rejected") logError("read session")(json.reason);
  if (closedList.status === "rejected") {
    logError("list closed")(closedList.reason);
  }
  const file = parseSessionFile(
    json.status === "fulfilled" ? json.value : null,
  );
  opts.onSidebar?.(file?.sidebar ?? defaultSidebar());
  opts.onFontSize?.(file?.fontSize ?? DEFAULT_FONT_SIZE);
  const broken =
    json.status === "rejected" || (json.value !== null && file === null);
  if (broken) await backupSession().catch(logError("back up session"));

  const open = new Map<string, ScratchFile>(
    (ids.status === "fulfilled" ? ids.value : []).map((f) => [f.id, f]),
  );
  let closedFiles = closedList.status === "fulfilled" ? closedList.value : null;
  if (file && closedFiles) {
    const inClosed = new Set(closedFiles.map((f) => f.id));
    for (const tab of file.tabs) {
      if (open.has(tab.id) || !inClosed.has(tab.id)) continue;
      try {
        await reopenScratchpad(tab.id);
        const f = closedFiles.find((c) => c.id === tab.id);
        open.set(tab.id, { id: tab.id, ext: f?.ext ?? "txt" });
        inClosed.delete(tab.id);
      } catch (err) {
        logError("move back stranded scratchpad")(err);
      }
    }
    closedFiles = closedFiles.filter((f) => inClosed.has(f.id));
  }

  const { state, expired } = restoreWorkspace(
    file,
    [...open.values()],
    freshId,
    Date.now(),
    closedFiles,
    file ? await grantedPaths(file, opts) : null,
    (p) => pathKey(p, platform),
  );
  // An expired Scratchpad lives in closed/; an expired File only in its shadow.
  const gone = expired.filter((e) => !e.tab.file).map((e) => e.tab.id);
  if (gone.length > 0) {
    await purgeClosed(gone).catch(logError("purge closed"));
  }
  for (const e of expired) {
    if (e.tab.file)
      await shadowDelete(e.tab.id).catch(logError("purge shadow"));
  }
  return state;
}

/** The File paths of a workspace's open Tabs and Recently Closed entries. */
export function filePathsOf(s: {
  tabs: WorkspaceState["tabs"];
  closed: WorkspaceState["closed"];
}): string[] {
  return [...s.tabs, ...s.closed.map((e) => e.tab)].flatMap((t) =>
    t.file ? [t.file.path] : [],
  );
}

/**
 * The Session's File paths that Rust granted under exactly that spelling.
 * The rest are dropped, or session_write would refuse every later Session;
 * a held one's text comes back as an orphan shadow. If Rust can't say (it
 * is asked twice), null: every File is kept and the caller is told.
 */
async function grantedPaths(
  file: SessionFile,
  opts: RestoreOptions,
): Promise<Set<string> | null> {
  const paths = filePathsOf(file);
  if (paths.length === 0) return new Set();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return new Set(await grantsFilter(paths));
    } catch (err) {
      logError("check granted paths")(err);
    }
  }
  opts.onGrantsUnchecked?.();
  return null;
}

/**
 * Install the flush-before-exit handshake once; rejections keep the app open.
 * Waits for in-flight closes/reopens first, so session.json and the moved
 * files agree when the app exits.
 */
export function useExitHandshake(
  savers: Saver[],
  settleInFlight: () => Promise<void>,
): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    const flush = async () => {
      await settleInFlight();
      await flushAll(savers);
    };
    installExitHandshake(flush).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    }, logError("install exit handshake"));
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // savers and settleInFlight are stable for the hook's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Write everything as soon as the window loses focus. */
export function useFlushOnBlur(savers: Saver[]): void {
  useEffect(() => {
    const onBlur = () => {
      for (const s of savers) s.flush().catch(logError("flush on blur"));
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function useWindowTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return;
    getCurrentWindow()
      .setTitle(`${title} — Zukai`)
      .catch(logError("set window title"));
  }, [title]);
}

/** "error" if any saver failed, else "pending" if any is busy, else "saved". */
export function useCombinedSaveStatus(savers: Saver[]): SaveStatus {
  const subscribe = useCallback(
    (cb: () => void) => {
      const offs = savers.map((s) => s.onStatus(cb));
      return () => offs.forEach((off) => off());
    },
    [savers],
  );
  const snapshot = useCallback((): SaveStatus => {
    const all = savers.map((s) => s.status());
    if (all.includes("error")) return "error";
    return all.includes("pending") ? "pending" : "saved";
  }, [savers]);
  return useSyncExternalStore(subscribe, snapshot);
}
