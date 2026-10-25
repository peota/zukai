import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { installExitHandshake } from "./exit";
import type { SaveStatus, Saver } from "../storage/autosave";
import { parseSessionFile, restoreWorkspace } from "../model/session";
import type { WorkspaceState } from "../model/types";
import { listScratchpads, purgeClosed, readSession } from "../storage/api";

export const logError = (what: string) => (err: unknown) =>
  console.error(what, err);

/** Flush both savers; rejects if either has a failed write. */
export function flushAll(savers: Saver[]): Promise<void> {
  return Promise.all(savers.map((s) => s.flush())).then(() => {});
}

/**
 * Read the scratchpad list and session.json, rebuild the workspace, and purge
 * expired Recently Closed files. A failed read of either source degrades to
 * "nothing there": the other source still recovers what it can.
 */
export async function restoreSession(
  freshId: () => string,
): Promise<WorkspaceState> {
  const [ids, json] = await Promise.allSettled([
    listScratchpads(),
    readSession(),
  ]);
  if (ids.status === "rejected") logError("list scratchpads")(ids.reason);
  if (json.status === "rejected") logError("read session")(json.reason);
  const { state, expired } = restoreWorkspace(
    parseSessionFile(json.status === "fulfilled" ? json.value : null),
    ids.status === "fulfilled" ? ids.value : [],
    freshId,
    Date.now(),
  );
  if (expired.length > 0) {
    await purgeClosed(expired.map((e) => e.tab.id)).catch(
      logError("purge closed"),
    );
  }
  return state;
}

/** Install the flush-before-exit handshake once; rejections keep the app open. */
export function useExitHandshake(savers: Saver[]): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    installExitHandshake(() => flushAll(savers)).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    }, logError("install exit handshake"));
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // savers are created once per mount
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
