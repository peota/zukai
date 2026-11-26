import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";

/** Where a copy that can't update itself (Linux .deb, Arch) gets the new one. */
export const RELEASES_URL = "https://github.com/peota/zukai/releases/latest";

/** The first check waits for startup to settle; later ones run in the background. */
export const FIRST_CHECK_DELAY_MS = 10_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export interface UpdaterState {
  status: UpdateStatus;
  /** This copy's version, once known. */
  currentVersion: string | null;
  /** The newer version found, if any. */
  newVersion: string | null;
  /** Download progress from 0 to 1, or null when the size isn't known. */
  progress: number | null;
  error: string | null;
  /** False where the package manager owns the install (Linux .deb, Arch). */
  canInstall: boolean;
}

export interface Updater extends UpdaterState {
  /** Ask GitHub for a newer release; `manual` shows a failure, a background check doesn't. */
  checkNow(manual?: boolean): Promise<void>;
  /** Download, save everything, install and restart. */
  install(): Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Checks the GitHub releases for a newer Zukai, shortly after startup and
 * every few hours, and installs it on request. `flushForExit` writes
 * everything an exit would, since installing quits the app.
 */
export function useUpdater(flushForExit: () => Promise<void>): Updater {
  const [state, setState] = useState<UpdaterState>({
    status: "idle",
    currentVersion: null,
    newVersion: null,
    progress: null,
    error: null,
    canInstall: true,
  });
  const update = useRef<Update | null>(null);
  const busy = useRef(false);
  const flush = useRef(flushForExit);
  flush.current = flushForExit;

  useEffect(() => {
    getVersion().then(
      (currentVersion) => setState((s) => ({ ...s, currentVersion })),
      () => {},
    );
    invoke<boolean>("update_can_install").then(
      (canInstall) => setState((s) => ({ ...s, canInstall })),
      () => {},
    );
  }, []);

  const checkNow = useCallback(async (manual = false) => {
    // Never check over a download or install in progress.
    if (busy.current) return;
    busy.current = true;
    if (manual) setState((s) => ({ ...s, status: "checking", error: null }));
    try {
      const found = await check();
      if (found) {
        const old = update.current;
        update.current = found;
        void old?.close().catch(() => {});
        setState((s) => ({
          ...s,
          status: "available",
          newVersion: found.version,
          error: null,
        }));
      } else {
        // A background check that finds nothing leaves the row quiet.
        setState((s) =>
          s.status === "available"
            ? s
            : { ...s, status: manual ? "current" : "idle", error: null },
        );
      }
    } catch (e) {
      console.error("update check failed", e);
      if (manual) {
        setState((s) => ({ ...s, status: "error", error: message(e) }));
      }
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void checkNow(), FIRST_CHECK_DELAY_MS);
    const every = setInterval(() => void checkNow(), CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [checkNow]);

  const install = useCallback(async () => {
    const found = update.current;
    if (!found || busy.current) return;
    busy.current = true;
    setState((s) => ({
      ...s,
      status: "downloading",
      progress: 0,
      error: null,
    }));
    try {
      let total = 0;
      let got = 0;
      await found.download((e) => {
        if (e.event === "Started") {
          total = e.data.contentLength ?? 0;
          setState((s) => ({ ...s, progress: total > 0 ? 0 : null }));
        } else if (e.event === "Progress") {
          got += e.data.chunkLength;
          if (total > 0) {
            setState((s) => ({ ...s, progress: Math.min(1, got / total) }));
          }
        }
      });
      setState((s) => ({ ...s, status: "installing", progress: null }));
      // Windows quits as the installer starts: everything is written first.
      await flush.current();
      await found.install();
      await relaunch();
    } catch (e) {
      console.error("update install failed", e);
      setState((s) => ({
        ...s,
        status: "error",
        progress: null,
        error: message(e),
      }));
    } finally {
      busy.current = false;
    }
  }, []);

  return { ...state, checkNow, install };
}
