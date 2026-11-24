import type { GitError } from "./api";

function base(e: GitError): string {
  switch (e.kind) {
    case "rejected":
      return "The remote has newer changes. Pull first, then push.";
    case "conflict": {
      const n = e.conflicts ?? 0;
      const files = n === 1 ? "1 file conflicts" : `${n} files conflict`;
      return `Pull stopped: ${files}. Finish it in a terminal (git rebase --continue or --abort).`;
    }
    case "repo_unreachable":
      return "Couldn't reach that repo. Check the URL and your git credentials.";
    case "network":
      return "Couldn't reach the remote. Check your connection.";
    case "timeout":
      return "Git took too long and was stopped.";
    case "dirty":
      return "You have uncommitted changes. Commit first, then pull.";
    case "remote_not_empty":
      return "That repo isn't empty. To use its notes here, use Add folder from git… instead.";
    case "in_progress":
      return "Finish the rebase in a terminal first";
    case "bad_url":
      return "That doesn't look like a git URL.";
    case "dest_exists":
      return "A folder with that name already exists there.";
    case "busy":
      return "Another git action is still running on this folder.";
    case "not_allowed":
      return "That folder can't be used here. Choose the folder again.";
    case "disabled":
      return "Git sync is turned off in Settings.";
    case "no_git":
      return "Install git to sync folders.";
    case "refused":
      // Rust words every refusal as a sentence for the user.
      return e.detail;
    default:
      return "Git failed.";
  }
}

export function errorCopy(e: GitError): string {
  return (e.committed ? "Committed. Push failed: " : "") + base(e);
}

/**
 * The folder name a clone suggests: the URL's last path part, less `.git`
 * (as Rust's `repo_name`, but the suffix in any case).
 */
export function repoName(url: string): string {
  const trimmed = url.trim().replace(/[/\\]+$/, "");
  const last = trimmed.split(/[/\\:]/).pop() ?? "";
  return last.replace(/\.git$/i, "");
}

export function defaultCommitMessage(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `Sync ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
