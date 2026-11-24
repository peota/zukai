import { vi } from "vitest";
import type { Change, FolderGit, GitError, RepoStatus } from "../../git/api";
import type { GitOp, GitSyncApi } from "../../git/useGitSync";

/** A synced, clean folder on `main` tracking `origin/main`. */
export const REPO: RepoStatus = {
  branch: "main",
  head: "abc1234",
  dirty: false,
  upstream: true,
  origin: true,
  ahead: 0,
  behind: 0,
  state: "none",
};

export const repo = (over: Partial<RepoStatus> = {}): FolderGit => ({
  kind: "repo",
  ...REPO,
  ...over,
});

export const gitError = (over: Partial<GitError> = {}): GitError => ({
  kind: "failed",
  detail: "fatal: something",
  conflicts: null,
  committed: false,
  ...over,
});

/** A stand-in for useGitSync, on and with git found. */
export function fakeGit(
  over: Partial<GitSyncApi> & {
    statuses?: Record<string, FolderGit>;
    changesOf?: Record<string, Change[]>;
    errors?: Record<string, GitError>;
    runningOf?: Record<string, GitOp>;
    doneOf?: Record<string, GitOp>;
  } = {},
): GitSyncApi {
  const {
    statuses = {},
    changesOf = {},
    errors = {},
    runningOf = {},
    doneOf = {},
    ...rest
  } = over;
  return {
    enabled: true,
    available: true,
    status: (f) => statuses[f],
    running: (f) => runningOf[f] ?? null,
    justDone: (f) => doneOf[f] ?? null,
    error: (f) => errors[f] ?? null,
    dismiss: vi.fn(),
    pull: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    push: vi.fn(async () => {}),
    setup: vi.fn(async () => {}),
    refresh: vi.fn(),
    selected: null,
    select: vi.fn(),
    changes: (f) => changesOf[f],
    branches: () => undefined,
    anyDirty: false,
    switchBranch: vi.fn(async () => {}),
    createBranch: vi.fn(async () => {}),
    ...rest,
  };
}
