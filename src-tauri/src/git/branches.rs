//! A folder's local branches and the ones only the remote has.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use super::ops::{refuse_in_progress, repo_status};
use super::{Git, GitError, GitKind};

const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Branch {
    pub name: String,
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branches {
    pub current: Option<String>,
    pub local: Vec<Branch>,
    pub remote_only: Vec<String>,
}

/// Local branches (the current one first, then by name) and `origin`
/// branches without a local namesake.
pub fn branches(git: &Git, dir: &Path) -> Result<Branches, GitError> {
    let current = repo_status(git, dir)?.branch;
    let refs = git.run(
        dir,
        &[
            "--no-optional-locks",
            "for-each-ref",
            "--format=%(refname)%00%(upstream:short)",
            "refs/heads",
            "refs/remotes/origin",
        ],
        TIMEOUT,
    )?;
    let mut local = Vec::new();
    let mut remote = Vec::new();
    for line in refs.stdout.lines() {
        let (name, upstream) = line.split_once('\0').unwrap_or((line, ""));
        if let Some(n) = name.strip_prefix("refs/heads/") {
            local.push(Branch {
                name: n.to_string(),
                upstream: (!upstream.is_empty()).then(|| upstream.to_string()),
            });
        } else if let Some(n) = name.strip_prefix("refs/remotes/origin/")
            && n != "HEAD"
        {
            remote.push(n.to_string());
        }
    }
    local.sort_by(|a, b| {
        let not_current = |x: &Branch| current.as_deref() != Some(x.name.as_str());
        not_current(a)
            .cmp(&not_current(b))
            .then_with(|| a.name.cmp(&b.name))
    });
    let mut remote_only: Vec<String> = remote
        .into_iter()
        .filter(|n| !local.iter().any(|b| &b.name == n))
        .collect();
    remote_only.sort();
    Ok(Branches {
        current,
        local,
        remote_only,
    })
}

fn refused(detail: &str) -> GitError {
    GitError::new(GitKind::Refused, detail)
}

/// Switches to `branch`, or with `from_remote` to a new local branch that
/// tracks `origin/<branch>`. Refused with uncommitted changes or while a
/// rebase or merge is in progress.
pub fn switch(git: &Git, dir: &Path, branch: &str, from_remote: bool) -> Result<(), GitError> {
    let s = repo_status(git, dir)?;
    refuse_in_progress(&s)?;
    if s.dirty {
        return Err(refused(
            "You have uncommitted changes. Commit first, then switch.",
        ));
    }
    let known = branches(git, dir)?;
    let exists = if from_remote {
        known.remote_only.iter().any(|b| b == branch)
    } else {
        known.local.iter().any(|b| b.name == branch)
    };
    if !exists {
        return Err(refused("That branch doesn't exist."));
    }
    if from_remote {
        let remote = format!("origin/{branch}");
        git.run(dir, &["switch", "--track", &remote], TIMEOUT)?;
    } else {
        git.run(dir, &["switch", branch], TIMEOUT)?;
    }
    Ok(())
}

/// Creates `name` at the current commit and switches to it, keeping any
/// uncommitted changes.
pub fn create_branch(git: &Git, dir: &Path, name: &str) -> Result<(), GitError> {
    let s = repo_status(git, dir)?;
    refuse_in_progress(&s)?;
    let invalid = || refused("Not a valid branch name");
    if name.is_empty() || name.starts_with('-') {
        return Err(invalid());
    }
    if git
        .run(dir, &["check-ref-format", "--branch", name], TIMEOUT)
        .is_err()
    {
        return Err(invalid());
    }
    if branches(git, dir)?.local.iter().any(|b| b.name == name) {
        return Err(refused("That branch already exists"));
    }
    git.run(dir, &["switch", "-c", name], TIMEOUT)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{find_git, testutil};

    #[test]
    fn branches_lists_local_and_remote_only() {
        let (_t, work, bare) = testutil::repo_with_remote();
        testutil::git(&work, &["branch", "draft"]);
        testutil::git(&work, &["branch", "alpha"]);
        let other = testutil::clone_of(&bare);
        testutil::git(&other, &["checkout", "-b", "laptop"]);
        testutil::git(&other, &["push", "origin", "laptop"]);
        testutil::git(&work, &["fetch", "origin"]);
        let b = branches(&find_git().unwrap(), &work).unwrap();
        assert_eq!(b.current.as_deref(), Some("main"));
        let names: Vec<&str> = b.local.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(names, ["main", "alpha", "draft"]);
        assert_eq!(b.local[0].upstream.as_deref(), Some("origin/main"));
        assert_eq!(b.local[2].upstream, None);
        assert_eq!(b.remote_only, ["laptop"]);
    }

    #[test]
    fn branches_refuses_non_repo_and_inside_repo() {
        let (_t, dir) = testutil::repo();
        let inner = dir.join("sub");
        std::fs::create_dir_all(&inner).unwrap();
        let g = find_git().unwrap();
        let e = branches(&g, &inner).unwrap_err();
        assert_eq!(e.kind, crate::git::GitKind::Refused);
        let plain = tempfile::tempdir().unwrap();
        let e = branches(&g, plain.path()).unwrap_err();
        assert_eq!(e.kind, crate::git::GitKind::Refused);
    }

    #[test]
    fn branches_detached_has_no_current() {
        let (_t, work, _bare) = testutil::repo_with_remote();
        testutil::git(&work, &["checkout", "--detach"]);
        let b = branches(&find_git().unwrap(), &work).unwrap();
        assert_eq!(b.current, None);
        assert_eq!(b.local.len(), 1);
    }

    fn g() -> Git {
        find_git().unwrap()
    }

    fn current(dir: &Path) -> Option<String> {
        branches(&g(), dir).unwrap().current
    }

    #[test]
    fn switch_changes_branch() {
        let (_t, work, _b) = testutil::repo_with_remote();
        testutil::git(&work, &["branch", "draft"]);
        switch(&g(), &work, "draft", false).unwrap();
        assert_eq!(current(&work).as_deref(), Some("draft"));
    }

    #[test]
    fn switch_refuses_when_dirty() {
        let (_t, work, _b) = testutil::repo_with_remote();
        testutil::git(&work, &["branch", "draft"]);
        std::fs::write(work.join("a.md"), "changed\n").unwrap();
        let e = switch(&g(), &work, "draft", false).unwrap_err();
        assert_eq!(e.kind, GitKind::Refused);
        assert_eq!(
            e.detail,
            "You have uncommitted changes. Commit first, then switch."
        );
        assert_eq!(current(&work).as_deref(), Some("main"));
    }

    #[test]
    fn switch_refuses_in_progress() {
        let (_t, work, bare) = testutil::repo_with_remote();
        testutil::git(&work, &["branch", "draft"]);
        let other = testutil::clone_of(&bare);
        std::fs::write(other.join("a.md"), "theirs\n").unwrap();
        testutil::git(&other, &["commit", "-am", "theirs"]);
        testutil::git(&other, &["push"]);
        std::fs::write(work.join("a.md"), "mine\n").unwrap();
        testutil::git(&work, &["commit", "-am", "mine"]);
        // The pull stops on a conflict, leaving the rebase in progress.
        let _ = g().run(&work, &["pull", "--rebase"], Duration::from_secs(30));
        let e = switch(&g(), &work, "draft", false).unwrap_err();
        assert_eq!(e.kind, GitKind::InProgress);
        let e = create_branch(&g(), &work, "x").unwrap_err();
        assert_eq!(e.kind, GitKind::InProgress);
    }

    #[test]
    fn switch_tracks_remote_only_branch() {
        let (_t, work, bare) = testutil::repo_with_remote();
        let other = testutil::clone_of(&bare);
        testutil::git(&other, &["checkout", "-b", "laptop"]);
        testutil::git(&other, &["push", "origin", "laptop"]);
        testutil::git(&work, &["fetch", "origin"]);
        switch(&g(), &work, "laptop", true).unwrap();
        let b = branches(&g(), &work).unwrap();
        assert_eq!(b.current.as_deref(), Some("laptop"));
        let laptop = b.local.iter().find(|x| x.name == "laptop").unwrap();
        assert_eq!(laptop.upstream.as_deref(), Some("origin/laptop"));
    }

    #[test]
    fn switch_refuses_unknown_branch() {
        let (_t, work, _b) = testutil::repo_with_remote();
        for from_remote in [false, true] {
            let e = switch(&g(), &work, "nope", from_remote).unwrap_err();
            assert_eq!(e.kind, GitKind::Refused);
            assert_eq!(e.detail, "That branch doesn't exist.");
        }
        assert_eq!(current(&work).as_deref(), Some("main"));
    }

    #[test]
    fn switch_removes_files_absent_on_target() {
        let (_t, work, _b) = testutil::repo_with_remote();
        testutil::git(&work, &["branch", "draft"]);
        std::fs::write(work.join("only-main.md"), "x\n").unwrap();
        testutil::git(&work, &["add", "."]);
        testutil::git(&work, &["commit", "-m", "only main"]);
        switch(&g(), &work, "draft", false).unwrap();
        assert!(!work.join("only-main.md").exists());
    }

    #[test]
    fn create_branch_switches_and_keeps_changes() {
        let (_t, work, _b) = testutil::repo_with_remote();
        std::fs::write(work.join("a.md"), "changed\n").unwrap();
        create_branch(&g(), &work, "reorg").unwrap();
        assert_eq!(current(&work).as_deref(), Some("reorg"));
        assert_eq!(
            std::fs::read_to_string(work.join("a.md")).unwrap(),
            "changed\n"
        );
        assert!(testutil::git(&work, &["status", "--porcelain"]).contains("a.md"));
    }

    #[test]
    fn create_branch_refuses_bad_names() {
        let (_t, work, _b) = testutil::repo_with_remote();
        for name in ["-f", "a..b", "main.lock", "x y", ""] {
            let e = create_branch(&g(), &work, name).unwrap_err();
            assert_eq!(e.kind, GitKind::Refused, "{name:?}");
            assert_eq!(e.detail, "Not a valid branch name", "{name:?}");
        }
        assert_eq!(branches(&g(), &work).unwrap().local.len(), 1);
    }

    #[test]
    fn create_branch_refuses_existing() {
        let (_t, work, _b) = testutil::repo_with_remote();
        let e = create_branch(&g(), &work, "main").unwrap_err();
        assert_eq!(e.kind, GitKind::Refused);
        assert_eq!(e.detail, "That branch already exists");
    }
}
