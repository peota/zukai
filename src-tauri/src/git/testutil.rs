//! Throwaway repositories for tests. They never read the developer's global
//! git config for anything that matters (identity, default branch, signing).

use std::path::{Path, PathBuf};
use std::time::Duration;

use tempfile::TempDir;

use super::find_git;

const T: Duration = Duration::from_secs(30);

/// Runs git in `cwd` with signing off, panicking on failure.
pub fn git(cwd: &Path, args: &[&str]) -> String {
    let g = find_git().expect("git is installed");
    let mut full = vec![
        "-c",
        "commit.gpgsign=false",
        "-c",
        "init.defaultBranch=main",
    ];
    full.extend_from_slice(args);
    g.run(cwd, &full, T)
        .unwrap_or_else(|e| panic!("git {args:?} failed: {e}"))
        .stdout
}

fn init_in(dir: &Path) {
    std::fs::create_dir_all(dir).unwrap();
    git(dir, &["init", "-b", "main"]);
    git(dir, &["config", "user.name", "Test"]);
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
}

/// An initialised repo on `main` with no commits.
pub fn repo() -> (TempDir, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let dir = dunce::canonicalize(tmp.path())
        .unwrap()
        .join("notes ü space");
    init_in(&dir);
    (tmp, dir)
}

/// A work repo with a bare `origin`, one commit pushed with `-u`.
pub fn repo_with_remote() -> (TempDir, PathBuf, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let root = dunce::canonicalize(tmp.path()).unwrap();
    let bare = root.join("remote.git");
    std::fs::create_dir_all(&bare).unwrap();
    git(&bare, &["init", "--bare", "-b", "main"]);
    let work = root.join("notes ü space");
    init_in(&work);
    git(&work, &["remote", "add", "origin", bare.to_str().unwrap()]);
    std::fs::write(work.join("a.md"), "a\n").unwrap();
    git(&work, &["add", "."]);
    git(&work, &["commit", "-m", "first"]);
    git(&work, &["push", "-u", "origin", "main"]);
    (tmp, work, bare)
}
