import { describe, expect, it } from "vitest";
import { asGitError, type GitError, type GitKind } from "./api";
import { defaultCommitMessage, errorCopy, repoName } from "./messages";

const err = (kind: GitKind, extra: Partial<GitError> = {}): GitError => ({
  kind,
  detail: "",
  conflicts: null,
  committed: false,
  ...extra,
});

describe("defaultCommitMessage", () => {
  it("is Sync with the local date", () => {
    expect(defaultCommitMessage(new Date(2026, 10, 24))).toBe(
      "Sync 2026-11-24",
    );
  });
});

describe("errorCopy", () => {
  it.each([
    ["rejected", "The remote has newer changes. Pull first, then push."],
    [
      "repo_unreachable",
      "Couldn't reach that repo. Check the URL and your git credentials.",
    ],
    ["network", "Couldn't reach the remote. Check your connection."],
    ["timeout", "Git took too long and was stopped."],
    ["dirty", "You have uncommitted changes. Commit first, then pull."],
    [
      "remote_not_empty",
      "That repo isn't empty. To use its notes here, use Add folder from git… instead.",
    ],
    ["in_progress", "Finish the rebase in a terminal first"],
    ["bad_url", "That doesn't look like a git URL."],
    ["dest_exists", "A folder with that name already exists there."],
    ["busy", "Another git action is still running on this folder."],
    ["not_allowed", "That folder can't be used here. Choose the folder again."],
    ["disabled", "Git sync is turned off in Settings."],
    ["no_git", "Install git to sync folders."],
    ["failed", "Git failed."],
  ] as [GitKind, string][])("%s", (kind, text) => {
    expect(errorCopy(err(kind))).toBe(text);
  });

  it("conflict counts files", () => {
    expect(errorCopy(err("conflict", { conflicts: 2 }))).toBe(
      "Pull stopped: 2 files conflict. Finish it in a terminal (git rebase --continue or --abort).",
    );
    expect(errorCopy(err("conflict", { conflicts: 1 }))).toBe(
      "Pull stopped: 1 file conflicts. Finish it in a terminal (git rebase --continue or --abort).",
    );
  });

  it("refused shows its detail", () => {
    expect(errorCopy(err("refused", { detail: "Not allowed here" }))).toBe(
      "Not allowed here",
    );
  });

  it("prefixes when committed", () => {
    expect(errorCopy(err("rejected", { committed: true }))).toBe(
      "Committed. Push failed: The remote has newer changes. Pull first, then push.",
    );
  });
});

describe("asGitError", () => {
  it("passes a git error through", () => {
    const e = err("network", { detail: "x" });
    expect(asGitError(e)).toEqual(e);
  });
  it("wraps anything else as failed", () => {
    expect(asGitError("boom")).toEqual(err("failed", { detail: "boom" }));
  });
});

describe("repoName", () => {
  it("matches the Rust repo_name", () => {
    expect(repoName("git@github.com:me/notes.git")).toBe("notes");
    expect(repoName("https://h/a/b/")).toBe("b");
    expect(repoName("host:repo")).toBe("repo");
    expect(repoName("C:\\repos\\x.git")).toBe("x");
  });
  it("strips .git in any case, once", () => {
    expect(repoName("https://h/me/Notes.GIT")).toBe("Notes");
    expect(repoName("  https://h/me/a.git.git  ")).toBe("a.git");
    expect(repoName("")).toBe("");
  });
});
