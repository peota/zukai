import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onLibraryChanged } from "../library/api";
import { listenSafely } from "../app/useLibrary";
import {
  asGitError,
  gitBranches,
  gitChanges,
  gitCommitPush,
  gitCreateBranch,
  gitPull,
  gitPush,
  gitSetEnabled,
  gitSetup,
  gitStatus,
  gitSwitch,
  type Branches,
  type Change,
  type FolderGit,
  type GitError,
} from "./api";

export type GitOp = "pull" | "commit" | "push" | "setup" | "switch";

export interface GitSyncApi {
  /** Whether git sync is on. It stays true while an op runs after the switch is turned off. */
  enabled: boolean;
  /** Git was found on this machine. */
  available: boolean;
  /** Undefined while disabled or before the first answer. */
  status(folder: string): FolderGit | undefined;
  /** The folder the Git view shows; null when the view is hidden. */
  selected: string | null;
  /** Only the selected folder's changes and branches are read. */
  select(folder: string | null): void;
  changes(folder: string): Change[] | undefined;
  branches(folder: string): Branches | undefined;
  /** Some repo folder has uncommitted changes. */
  anyDirty: boolean;
  switchBranch(
    folder: string,
    name: string,
    fromRemote: boolean,
  ): Promise<void>;
  /** Creates the branch and switches to it. */
  createBranch(folder: string, name: string): Promise<void>;
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

function pick<T>(m: Map_<T>, k: string): Map_<T> {
  return k in m ? { [k]: m[k] } : {};
}

export function useGitSync(opts: {
  /** The setting; `null` while it isn't known yet (nothing is sent). */
  enabled: boolean | null;
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
  const [changesMap, setChanges] = useState<Map_<Change[]>>({});
  const [branchesMap, setBranches] = useState<Map_<Branches>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const detailRequests = useRef(new Map<string, number>());
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
    if (wanted === null) return;
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
      setChanges({});
      setBranches({});
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

  const fetchDetails = useCallback((folder: string) => {
    if (!enabledRef.current || !readyRef.current || !availableRef.current) {
      return;
    }
    if (selectedRef.current !== folder) return;
    const id = (detailRequests.current.get(folder) ?? 0) + 1;
    detailRequests.current.set(folder, id);
    const current = () =>
      mounted.current &&
      enabledRef.current &&
      selectedRef.current === folder &&
      detailRequests.current.get(folder) === id;
    gitChanges(folder).then(
      (c) => {
        if (current()) setChanges((m) => ({ ...m, [folder]: c }));
      },
      () => {},
    );
    gitBranches(folder).then(
      (b) => {
        if (current()) setBranches((m) => ({ ...m, [folder]: b }));
      },
      () => {},
    );
  }, []);

  const fetchOne = useCallback(
    (folder: string) => {
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
          if (s.kind === "repo") fetchDetails(folder);
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
    },
    [fetchDetails],
  );

  const refresh = useCallback(
    (folder?: string) => {
      if (folder !== undefined) fetchOne(folder);
      else for (const f of foldersRef.current) fetchOne(f);
    },
    [fetchOne],
  );

  const select = useCallback(
    (folder: string | null) => {
      selectedRef.current = folder;
      setSelected(folder);
      setChanges((m) => (folder === null ? {} : pick(m, folder)));
      setBranches((m) => (folder === null ? {} : pick(m, folder)));
      if (folder !== null) fetchOne(folder);
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
  const switchBranch = useCallback(
    (folder: string, name: string, fromRemote: boolean) =>
      run(folder, "switch", () => gitSwitch(folder, name, fromRemote)),
    [run],
  );
  const createBranch = useCallback(
    (folder: string, name: string) =>
      run(folder, "switch", () => gitCreateBranch(folder, name)),
    [run],
  );
  const anyDirty = useMemo(
    () =>
      enabled &&
      Object.values(statuses).some((s) => s.kind === "repo" && s.dirty),
    [enabled, statuses],
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
      selected,
      select,
      changes: (f) => (enabled ? changesMap[f] : undefined),
      branches: (f) => (enabled ? branchesMap[f] : undefined),
      anyDirty,
      switchBranch,
      createBranch,
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
      selected,
      select,
      changesMap,
      branchesMap,
      anyDirty,
      switchBranch,
      createBranch,
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
