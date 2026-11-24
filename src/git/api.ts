import { invoke } from "@tauri-apps/api/core";
import type { RootState } from "../library/api";

export interface RepoStatus {
  branch: string | null;
  head: string;
  dirty: boolean;
  upstream: boolean;
  origin: boolean;
  ahead: number;
  behind: number;
  state: "none" | "rebasing" | "merging";
}

export type FolderGit =
  | { kind: "notRepo" }
  | { kind: "insideRepo"; top: string }
  | ({ kind: "repo" } & RepoStatus);

export type GitKind =
  | "disabled"
  | "no_git"
  | "not_allowed"
  | "busy"
  | "in_progress"
  | "dirty"
  | "rejected"
  | "conflict"
  | "repo_unreachable"
  | "network"
  | "timeout"
  | "remote_not_empty"
  | "bad_url"
  | "dest_exists"
  | "refused"
  | "cancelled"
  | "failed";

export interface GitError {
  kind: GitKind;
  detail: string;
  conflicts: number | null;
  committed: boolean;
}

export interface PickedParent {
  token: string;
  path: string;
}

export interface CloneRequest {
  token: string;
  url: string;
  name: string;
  useAsLibrary: boolean;
  opId: string;
  /** The Files the UI holds (open or Recently Closed), kept granted. */
  openPaths: string[];
}

export interface GitAvailability {
  available: boolean;
}

const KINDS: ReadonlySet<string> = new Set<GitKind>([
  "disabled",
  "no_git",
  "not_allowed",
  "busy",
  "in_progress",
  "dirty",
  "rejected",
  "conflict",
  "repo_unreachable",
  "network",
  "timeout",
  "remote_not_empty",
  "bad_url",
  "dest_exists",
  "refused",
  "cancelled",
  "failed",
]);

/** What a rejected git command carries, or "failed" for anything else. */
export function asGitError(e: unknown): GitError {
  if (typeof e === "object" && e !== null) {
    const o = e as Record<string, unknown>;
    if (typeof o.kind === "string" && KINDS.has(o.kind)) {
      return {
        kind: o.kind as GitKind,
        detail: typeof o.detail === "string" ? o.detail : "",
        conflicts: typeof o.conflicts === "number" ? o.conflicts : null,
        committed: o.committed === true,
      };
    }
  }
  return {
    kind: "failed",
    detail: String(e),
    conflicts: null,
    committed: false,
  };
}

export const gitSetEnabled = (enabled: boolean): Promise<GitAvailability> =>
  invoke("git_set_enabled", { enabled });
export const gitStatus = (folder: string): Promise<FolderGit> =>
  invoke("git_status", { folder });
export const gitPull = (folder: string): Promise<void> =>
  invoke("git_pull", { folder });
export const gitCommitPush = (folder: string, message: string): Promise<void> =>
  invoke("git_commit_push", { folder, message });
export const gitPush = (folder: string): Promise<void> =>
  invoke("git_push", { folder });
export const gitSetup = (folder: string, url: string): Promise<void> =>
  invoke("git_setup", { folder, url });
export const gitPickCloneParent = (): Promise<PickedParent | null> =>
  invoke("git_pick_clone_parent");
export const gitClone = (req: CloneRequest): Promise<RootState> =>
  invoke("git_clone", { ...req });
export const gitCancel = (opId: string): Promise<void> =>
  invoke("git_cancel", { opId });
