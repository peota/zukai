//! Pull, commit-and-push, push and first-time setup for a library folder.

use std::path::Path;
use std::time::Duration;

use super::status::read_porcelain;
use super::url::check_url;
use super::{FolderGit, Git, GitError, GitKind, RepoState, RepoStatus, folder_git};

/// Network calls (pull, push).
const NET: Duration = Duration::from_secs(60);
/// Local calls (init, add, commit, remote).
const LOCAL: Duration = Duration::from_secs(60);
/// The first push of a whole library can be large.
const SETUP_PUSH: Duration = Duration::from_secs(300);

/// Runs a network subcommand with git's command-running `ext::` and `fd::`
/// transports disabled. Plain local paths stay allowed.
fn net(git: &Git, dir: &Path, args: &[&str], timeout: Duration) -> Result<(), GitError> {
    let mut full = vec![
        "-c",
        "protocol.ext.allow=never",
        "-c",
        "protocol.fd.allow=never",
    ];
    full.extend_from_slice(args);
    git.run(dir, &full, timeout).map(|_| ())
}

fn local(git: &Git, dir: &Path, args: &[&str]) -> Result<(), GitError> {
    git.run(dir, args, LOCAL).map(|_| ())
}

/// The repo at `dir`, or `Refused` when it isn't a repo root.
fn repo_status(git: &Git, dir: &Path) -> Result<RepoStatus, GitError> {
    match folder_git(git, dir)? {
        FolderGit::Repo(s) => Ok(s),
        _ => Err(GitError::new(GitKind::Refused, "not a git repository")),
    }
}

fn refuse_in_progress(s: &RepoStatus) -> Result<(), GitError> {
    if s.state == RepoState::Clean {
        Ok(())
    } else {
        Err(GitError::new(
            GitKind::InProgress,
            "a rebase or merge is in progress",
        ))
    }
}

/// `push`, adding `-u origin <branch>` when the branch has no upstream.
fn push_branch(git: &Git, dir: &Path, s: &RepoStatus, timeout: Duration) -> Result<(), GitError> {
    if s.upstream {
        return net(git, dir, &["push"], timeout);
    }
    let Some(branch) = s.branch.as_deref() else {
        return Err(GitError::new(GitKind::Failed, "HEAD is detached"));
    };
    net(git, dir, &["push", "-u", "origin", branch], timeout)
}

pub fn pull(git: &Git, dir: &Path) -> Result<(), GitError> {
    let s = repo_status(git, dir)?;
    refuse_in_progress(&s)?;
    if s.dirty {
        return Err(GitError::new(
            GitKind::Dirty,
            "there are uncommitted changes",
        ));
    }
    net(git, dir, &["pull", "--rebase", "--no-autostash"], NET).map_err(|mut e| {
        if e.kind == GitKind::Conflict {
            e.conflicts = read_porcelain(git, dir).ok().map(|p| p.conflicts);
        }
        e
    })
}

/// Stages everything and reports whether anything is staged. `diff --cached`
/// also works before the first commit.
fn stage_all(git: &Git, dir: &Path) -> Result<bool, GitError> {
    local(git, dir, &["add", "-A"])?;
    let out = git.run(dir, &["diff", "--cached", "--name-only"], LOCAL)?;
    Ok(!out.stdout.trim().is_empty())
}

pub fn commit_push(git: &Git, dir: &Path, message: &str) -> Result<(), GitError> {
    let s = repo_status(git, dir)?;
    refuse_in_progress(&s)?;
    let committed = stage_all(git, dir)?;
    if committed {
        local(git, dir, &["commit", "-m", message])?;
    }
    // With no commit at all there is nothing to push.
    if s.origin && (committed || !s.head.is_empty()) {
        push_branch(git, dir, &s, NET).map_err(|mut e| {
            e.committed = committed;
            e
        })?;
    }
    Ok(())
}

pub fn push(git: &Git, dir: &Path) -> Result<(), GitError> {
    let s = repo_status(git, dir)?;
    refuse_in_progress(&s)?;
    if !s.origin {
        return Err(GitError::new(GitKind::Refused, "no remote is set up"));
    }
    push_branch(git, dir, &s, NET)
}

pub fn setup(git: &Git, dir: &Path, url: &str) -> Result<(), GitError> {
    setup_with(git, dir, url, &[])
}

/// `setup`, with `commit_cfg` (`-c` options) added to the commit call; tests
/// use it to make the commit fail.
fn setup_with(git: &Git, dir: &Path, url: &str, commit_cfg: &[&str]) -> Result<(), GitError> {
    check_url(url)?;
    if folder_git(git, dir)? != FolderGit::NotRepo {
        return Err(GitError::new(
            GitKind::Refused,
            "this folder is already in a git repository",
        ));
    }
    if git.git_version() >= (2, 28) {
        local(git, dir, &["init", "-b", "main"])?;
    } else {
        local(git, dir, &["init"])?;
        local(git, dir, &["symbolic-ref", "HEAD", "refs/heads/main"])?;
    }
    // Add the remote first: if the commit then fails (no identity, a hook),
    // the folder is still a repo with an origin and Push can retry.
    local(git, dir, &["remote", "add", "origin", "--", url.trim()])?;
    let committed = stage_all(git, dir)?;
    if committed {
        let mut args = commit_cfg.to_vec();
        args.extend_from_slice(&["commit", "-m", "Set up Zukai sync"]);
        local(git, dir, &args)?;
    }
    if committed {
        net(git, dir, &["push", "-u", "origin", "main"], SETUP_PUSH).map_err(|mut e| {
            if e.kind == GitKind::Rejected {
                e.kind = GitKind::RemoteNotEmpty;
            }
            e
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{FolderGit, RepoState, RepoStatus, find_git, folder_git, testutil};
    use std::path::PathBuf;

    fn g() -> Git {
        testutil::ensure_identity();
        find_git().expect("git")
    }

    fn status(dir: &Path) -> RepoStatus {
        match folder_git(&g(), dir).unwrap() {
            FolderGit::Repo(s) => s,
            other => panic!("{other:?}"),
        }
    }

    fn last_subject(dir: &Path) -> String {
        testutil::git(dir, &["log", "-1", "--format=%s"])
            .trim_end_matches(['\r', '\n'])
            .to_string()
    }

    /// Work repo, its bare remote, and the other machine's clone.
    fn trio() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
        let (t, work, bare) = testutil::repo_with_remote();
        let other = testutil::clone_of(&bare);
        (t, work, bare, other)
    }

    /// Both sides edit a.md; the other pushes; work commits. Pull conflicts.
    fn conflicted() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
        let (t, work, bare, other) = trio();
        std::fs::write(other.join("a.md"), "theirs\n").unwrap();
        testutil::git(&other, &["commit", "-am", "theirs"]);
        testutil::git(&other, &["push"]);
        std::fs::write(work.join("a.md"), "mine\n").unwrap();
        testutil::git(&work, &["commit", "-am", "mine"]);
        let e = pull(&g(), &work).unwrap_err();
        assert_eq!(e.kind, GitKind::Conflict);
        (t, work, bare, other)
    }

    #[test]
    fn commit_push_sends_to_remote() {
        let (_t, work, _bare, other) = trio();
        std::fs::write(work.join("a.md"), "changed\n").unwrap();
        std::fs::write(work.join("new.md"), "n\n").unwrap();
        let msg = "-x \"quoted\" ü";
        commit_push(&g(), &work, msg).unwrap();
        testutil::git(&other, &["pull"]);
        assert_eq!(last_subject(&other), msg);
        assert!(other.join("new.md").exists());
        assert_eq!(status(&work).ahead, 0);
    }

    #[test]
    fn commit_push_clean_pushes_unpushed() {
        let (_t, work, _bare, _other) = trio();
        std::fs::write(work.join("b.md"), "b\n").unwrap();
        testutil::git(&work, &["add", "."]);
        testutil::git(&work, &["commit", "-m", "local"]);
        assert_eq!(status(&work).ahead, 1);
        commit_push(&g(), &work, "unused").unwrap();
        assert_eq!(status(&work).ahead, 0);
        assert_eq!(last_subject(&work), "local");
    }

    #[test]
    fn commit_push_reports_committed_when_push_rejected() {
        let (_t, work, _bare, other) = trio();
        std::fs::write(other.join("o.md"), "o\n").unwrap();
        testutil::git(&other, &["add", "."]);
        testutil::git(&other, &["commit", "-m", "other"]);
        testutil::git(&other, &["push"]);
        std::fs::write(work.join("w.md"), "w\n").unwrap();
        let e = commit_push(&g(), &work, "mine").unwrap_err();
        assert_eq!(e.kind, GitKind::Rejected);
        assert!(e.committed);
        assert_eq!(last_subject(&work), "mine");
    }

    #[test]
    fn pull_refuses_dirty() {
        let (_t, work, _bare, _other) = trio();
        std::fs::write(work.join("u.md"), "u").unwrap();
        let e = pull(&g(), &work).unwrap_err();
        assert_eq!(e.kind, GitKind::Dirty);
        assert!(work.join("u.md").exists());
    }

    #[test]
    fn pull_brings_changes() {
        let (_t, work, _bare, other) = trio();
        std::fs::write(other.join("b.md"), "b\n").unwrap();
        testutil::git(&other, &["add", "."]);
        testutil::git(&other, &["commit", "-m", "b"]);
        testutil::git(&other, &["push"]);
        pull(&g(), &work).unwrap();
        assert!(work.join("b.md").exists());
    }

    #[test]
    fn pull_conflict_reports_count() {
        let (_t, work, _bare, other) = trio();
        std::fs::write(other.join("a.md"), "theirs\n").unwrap();
        testutil::git(&other, &["commit", "-am", "theirs"]);
        testutil::git(&other, &["push"]);
        std::fs::write(work.join("a.md"), "mine\n").unwrap();
        testutil::git(&work, &["commit", "-am", "mine"]);
        let e = pull(&g(), &work).unwrap_err();
        assert_eq!(e.kind, GitKind::Conflict);
        assert_eq!(e.conflicts, Some(1));
        assert_eq!(status(&work).state, RepoState::Rebasing);
    }

    #[test]
    fn ops_refuse_while_rebasing() {
        let (_t, work, _bare, _other) = conflicted();
        let kind = |r: Result<(), GitError>| r.unwrap_err().kind;
        assert_eq!(kind(commit_push(&g(), &work, "m")), GitKind::InProgress);
        assert_eq!(kind(push(&g(), &work)), GitKind::InProgress);
        assert_eq!(kind(pull(&g(), &work)), GitKind::InProgress);
    }

    fn plain_folder(files: &[&str]) -> (tempfile::TempDir, PathBuf) {
        testutil::ensure_identity();
        let tmp = tempfile::tempdir().unwrap();
        let dir = dunce::canonicalize(tmp.path()).unwrap().join("lib ü");
        std::fs::create_dir_all(&dir).unwrap();
        for f in files {
            std::fs::write(dir.join(f), "x\n").unwrap();
        }
        (tmp, dir)
    }

    #[test]
    fn setup_pushes_to_empty_bare() {
        let (_t, dir) = plain_folder(&["a.md"]);
        let (_b, bare) = testutil::bare();
        setup(&g(), &dir, bare.to_str().unwrap()).unwrap();
        let s = status(&dir);
        assert!(s.upstream && !s.dirty);
        assert_eq!(s.branch.as_deref(), Some("main"));
    }

    #[test]
    fn setup_on_non_empty_remote() {
        let (_t, dir) = plain_folder(&["a.md"]);
        let (_t2, _work, bare) = testutil::repo_with_remote();
        let e = setup(&g(), &dir, bare.to_str().unwrap()).unwrap_err();
        assert_eq!(e.kind, GitKind::RemoteNotEmpty);
        assert!(dir.join(".git").exists());
        assert!(status(&dir).origin);
    }

    #[test]
    fn setup_refuses_inside_repo() {
        let (_t, work) = testutil::repo();
        let sub = work.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let (_b, bare) = testutil::bare();
        let e = setup(&g(), &sub, bare.to_str().unwrap()).unwrap_err();
        assert_eq!(e.kind, GitKind::Refused);
        assert!(!sub.join(".git").exists());
    }

    #[test]
    fn setup_empty_folder_skips_push() {
        let (_t, dir) = plain_folder(&[]);
        let (_b, bare) = testutil::bare();
        setup(&g(), &dir, bare.to_str().unwrap()).unwrap();
        let s = status(&dir);
        assert!(s.origin && !s.upstream);
        assert_eq!(s.head, "");
        std::fs::write(dir.join("n.md"), "n\n").unwrap();
        commit_push(&g(), &dir, "first").unwrap();
        assert!(status(&dir).upstream);
    }

    #[test]
    fn failed_setup_commit_leaves_retryable_repo() {
        let (_t, dir) = plain_folder(&["a.md"]);
        let (_b, bare) = testutil::bare();
        // A failing pre-commit hook stands in for "identity unknown".
        let hooks = dir.parent().unwrap().join("hooks");
        std::fs::create_dir_all(&hooks).unwrap();
        std::fs::write(hooks.join("pre-commit"), "#!/bin/sh\nexit 1\n").unwrap();
        let cfg = format!("core.hooksPath={}", hooks.to_str().unwrap());
        let url = bare.to_str().unwrap();
        let e = setup_with(&g(), &dir, url, &["-c", &cfg]).unwrap_err();
        assert_eq!(e.kind, GitKind::Failed);
        assert!(dir.join(".git").exists());
        let s = status(&dir);
        assert!(s.origin && !s.upstream);
        commit_push(&g(), &dir, "retry").unwrap();
        assert!(status(&dir).upstream);
    }

    #[test]
    fn commit_push_on_unborn_empty_folder_pushes_nothing() {
        let (_t, dir) = plain_folder(&[]);
        let (_b, bare) = testutil::bare();
        setup(&g(), &dir, bare.to_str().unwrap()).unwrap();
        commit_push(&g(), &dir, "nothing").unwrap();
        let s = status(&dir);
        assert!(!s.upstream && s.head.is_empty());
    }

    #[test]
    fn push_without_origin_is_refused() {
        let (_t, dir) = testutil::repo();
        assert_eq!(push(&g(), &dir).unwrap_err().kind, GitKind::Refused);
    }

    #[test]
    fn push_sets_upstream_when_missing() {
        let (_t, dir) = plain_folder(&["a.md"]);
        let (_t2, _work, full) = testutil::repo_with_remote();
        let (_b, empty) = testutil::bare();
        assert!(setup(&g(), &dir, full.to_str().unwrap()).is_err());
        testutil::git(
            &dir,
            &["remote", "set-url", "origin", empty.to_str().unwrap()],
        );
        push(&g(), &dir).unwrap();
        assert!(status(&dir).upstream);
    }
}
