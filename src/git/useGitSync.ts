import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onLibraryChanged } from "../library/api";
import { listenSafely } from "../app/useLibrary";
import {
  asGitError,
  gitCommitPush,
  gitPull,
  gitPush,
  gitSetEnabled,
  gitSetup,
  gitStatus,
  type FolderGit,
  type GitError,
} from "./api";

export type GitOp = "pull" | "commit" | "push" | "setup";

export interface GitSyncApi {
  /** Whether git sync is on. It stays true while an op runs after the switch is turned off. */
  enabled: boolean;
  /** Git was found on this machine. */
  available: boolean;
  /** Undefined while disabled or before the first answer. */
  status(folder: string): FolderGit | undefined;
  running(folder: string): GitOp | null;
  /** The op that just finished OK (for a moment). */
  justDone(folder: string): GitOp | null;
  error(folder: string): GitError | null;
  dismiss(folder: string): void;
  pull(folder: string): Promise<void>;
  /** An empty message means push only. */
  commit(folder: string, message: string): Promise<void>;
  push(folder: string): Promise<void>;
  setup(folder: string, url: string): Promise<void>;
  /** One folder, or all of them. */
  refresh(folder?: string): void;
}

const DONE_MS = 1000;
const CHANGED_DEBOUNCE_MS = 1000;

type Map_<T> = Record<string, T>;

function without<T>(m: Map_<T>, k: string): Map_<T> {
  if (!(k in m)) return m;
  const rest = { ...m };
  delete rest[k];
  return rest;
}

export function useGitSync(opts: {
  enabled: boolean;
  folders: string[];
}): GitSyncApi {
  const { enabled: wanted } = opts;
  const foldersKey = opts.folders.join("\0");
  const folders = useMemo(
    () => (foldersKey === "" ? [] : foldersKey.split("\0")),
    [foldersKey],
  );

  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(false);
  const [statuses, setStatuses] = useState<Map_<FolderGit>>({});
  const [runningMap, setRunning] = useState<Map_<GitOp>>({});
  const [doneMap, setDone] = useState<Map_<GitOp>>({});
  const [errors, setErrors] = useState<Map_<GitError>>({});

  const mounted = useRef(true);
  const applied = useRef<boolean | null>(null);
  const enabledRef = useRef(false);
  const availableRef = useRef(false);
  // True once Rust has answered git_set_enabled(true): its gate is open.
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const requests = useRef(new Map<string, number>());
  const runningRef = useRef(new Set<string>());
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const doneTimers = useRef(new Map<string, number>());
  const busy = Object.keys(runningMap).length;

  useEffect(() => {
    mounted.current = true;
    const timers = doneTimers.current;
    return () => {
      mounted.current = false;
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

  // The switch. Turning it off waits for a running op to settle (spec 4.0).
  useEffect(() => {
    if (wanted) {
      if (applied.current === true) return;
      applied.current = true;
      setEnabled(true);
      enabledRef.current = true;
      gitSetEnabled(true).then(
        (a) => {
          if (!mounted.current || applied.current !== true) return;
          availableRef.current = a.available;
          readyRef.current = true;
          setAvailable(a.available);
          setReady(true);
        },
        () => {},
      );
    } else if (busy === 0 && applied.current !== false) {
      applied.current = false;
      enabledRef.current = false;
      readyRef.current = false;
      setReady(false);
      setEnabled(false);
      setStatuses({});
      setErrors({});
      setDone({});
      gitSetEnabled(false).then(
        (a) => {
          if (mounted.current && applied.current === false) {
            availableRef.current = a.available;
            setAvailable(a.available);
          }
        },
        () => {},
      );
    }
  }, [wanted, busy]);

  const fetchOne = useCallback((folder: string) => {
    if (!enabledRef.current || !readyRef.current || !availableRef.current) {
      return;
    }
    const id = (requests.current.get(folder) ?? 0) + 1;
    requests.current.set(folder, id);
    const latest = () => requests.current.get(folder) === id;
    gitStatus(folder).then(
      (s) => {
        if (!mounted.current || !enabledRef.current || !latest()) return;
        if (!foldersRef.current.includes(folder)) return;
        setStatuses((m) => ({ ...m, [folder]: s }));
      },
      (e) => {
        if (!mounted.current || !latest()) return;
        // Keep the last good status on a passing failure.
        const kind = asGitError(e).kind;
        if (kind === "disabled" || kind === "not_allowed") {
          setStatuses((m) => without(m, folder));
        }
      },
    );
  }, []);

  const refresh = useCallback(
    (folder?: string) => {
      if (folder !== undefined) fetchOne(folder);
      else for (const f of foldersRef.current) fetchOne(f);
    },
    [fetchOne],
  );

  // Status for every folder once git is known, and when the folders change.
  useEffect(() => {
    if (!enabled || !ready || !available) return;
    for (const f of folders) fetchOne(f);
  }, [enabled, ready, available, folders, fetchOne]);

  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    let timer: number | undefined;
    const off = listenSafely(
      () =>
        onLibraryChanged(() => {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => refresh(), CHANGED_DEBOUNCE_MS);
        }),
      "listen library changes for git",
    );
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [refresh]);

  const run = useCallback(
    async (folder: string, op: GitOp, work: () => Promise<void>) => {
      if (!enabledRef.current || runningRef.current.has(folder)) return;
      runningRef.current.add(folder);
      setErrors((m) => without(m, folder));
      setDone((m) => without(m, folder));
      const t = doneTimers.current.get(folder);
      if (t !== undefined) window.clearTimeout(t);
      setRunning((m) => ({ ...m, [folder]: op }));
      try {
        await work();
        if (mounted.current) {
          setDone((m) => ({ ...m, [folder]: op }));
          doneTimers.current.set(
            folder,
            window.setTimeout(() => {
              doneTimers.current.delete(folder);
              if (mounted.current) setDone((m) => without(m, folder));
            }, DONE_MS),
          );
        }
      } catch (e) {
        if (mounted.current)
          setErrors((m) => ({ ...m, [folder]: asGitError(e) }));
      } finally {
        runningRef.current.delete(folder);
        if (mounted.current) {
          setRunning((m) => without(m, folder));
          fetchOne(folder);
        }
      }
    },
    [fetchOne],
  );

  const pull = useCallback(
    (folder: string) => run(folder, "pull", () => gitPull(folder)),
    [run],
  );
  const push = useCallback(
    (folder: string) => run(folder, "push", () => gitPush(folder)),
    [run],
  );
  const commit = useCallback(
    (folder: string, message: string) =>
      message === ""
        ? run(folder, "push", () => gitPush(folder))
        : run(folder, "commit", () => gitCommitPush(folder, message)),
    [run],
  );
  const setup = useCallback(
    (folder: string, url: string) =>
      run(folder, "setup", () => gitSetup(folder, url)),
    [run],
  );
  const dismiss = useCallback(
    (folder: string) => setErrors((m) => without(m, folder)),
    [],
  );

  return useMemo<GitSyncApi>(
    () => ({
      enabled,
      available,
      status: (f) => (enabled ? statuses[f] : undefined),
      running: (f) => runningMap[f] ?? null,
      justDone: (f) => doneMap[f] ?? null,
      error: (f) => errors[f] ?? null,
      dismiss,
      pull,
      commit,
      push,
      setup,
      refresh,
    }),
    [
      enabled,
      available,
      statuses,
      runningMap,
      doneMap,
      errors,
      dismiss,
      pull,
      commit,
      push,
      setup,
      refresh,
    ],
  );
}
