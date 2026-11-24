//! The files a folder's working tree has changed, from git's own status.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use super::ops::repo_status;
use super::{Git, GitError};

const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub old_path: Option<String>,
    pub status: ChangeStatus,
}

fn simple(xy: &str) -> ChangeStatus {
    if xy.contains('D') {
        ChangeStatus::Deleted
    } else if xy.contains('A') {
        ChangeStatus::Added
    } else {
        ChangeStatus::Modified
    }
}

/// Parses `git status --porcelain=v2 -z` output.
fn parse(out: &str) -> Vec<Change> {
    let mut fields = out.split('\0');
    let mut list = Vec::new();
    while let Some(rec) = fields.next() {
        let change = match rec.as_bytes().first() {
            Some(b'1') => {
                let mut p = rec.splitn(9, ' ');
                let xy = p.nth(1).unwrap_or("");
                p.nth(6).map(|path| Change {
                    path: path.to_string(),
                    old_path: None,
                    status: simple(xy),
                })
            }
            Some(b'2') => {
                let path = rec.splitn(10, ' ').nth(9);
                let old = fields.next();
                path.map(|path| Change {
                    path: path.to_string(),
                    old_path: old.map(str::to_string),
                    status: ChangeStatus::Renamed,
                })
            }
            Some(b'u') => rec.splitn(11, ' ').nth(10).map(|path| Change {
                path: path.to_string(),
                old_path: None,
                status: ChangeStatus::Conflicted,
            }),
            Some(b'?') => rec.strip_prefix("? ").map(|path| Change {
                path: path.to_string(),
                old_path: None,
                status: ChangeStatus::Added,
            }),
            _ => None,
        };
        list.extend(change);
    }
    list.sort_by(|a, b| a.path.cmp(&b.path));
    list
}

/// Every changed file under `dir`, relative to it, `/`-separated, by path.
/// Untracked folders are listed file by file; ignored files are skipped.
pub fn changes(git: &Git, dir: &Path) -> Result<Vec<Change>, GitError> {
    repo_status(git, dir)?;
    let st = git.run(
        dir,
        &[
            "--no-optional-locks",
            "-c",
            "core.quotepath=false",
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=all",
        ],
        TIMEOUT,
    )?;
    Ok(parse(&st.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{find_git, testutil};
    use std::fs;

    fn got(dir: &Path) -> Vec<(String, ChangeStatus)> {
        changes(&find_git().unwrap(), dir)
            .unwrap()
            .into_iter()
            .map(|c| (c.path, c.status))
            .collect()
    }

    #[test]
    fn changes_reports_each_status() {
        let (_t, dir) = testutil::repo();
        fs::write(dir.join("a.md"), "a\n").unwrap();
        fs::write(dir.join("c.md"), "c\n").unwrap();
        testutil::git(&dir, &["add", "."]);
        testutil::git(&dir, &["commit", "-m", "one"]);
        fs::write(dir.join("a.md"), "changed\n").unwrap();
        fs::write(dir.join("b.md"), "b\n").unwrap();
        fs::remove_file(dir.join("c.md")).unwrap();
        assert_eq!(
            got(&dir),
            vec![
                ("a.md".into(), ChangeStatus::Modified),
                ("b.md".into(), ChangeStatus::Added),
                ("c.md".into(), ChangeStatus::Deleted),
            ]
        );
    }

    #[test]
    fn changes_lists_files_in_untracked_dirs() {
        let (_t, dir) = testutil::repo();
        fs::create_dir_all(dir.join("ideas/rust")).unwrap();
        fs::write(dir.join("ideas/rust/a.md"), "a\n").unwrap();
        fs::write(dir.join("ideas/rust/b.md"), "b\n").unwrap();
        assert_eq!(
            got(&dir),
            vec![
                ("ideas/rust/a.md".into(), ChangeStatus::Added),
                ("ideas/rust/b.md".into(), ChangeStatus::Added),
            ]
        );
    }

    #[test]
    fn changes_lists_odd_names_verbatim() {
        let (_t, dir) = testutil::repo();
        fs::create_dir_all(dir.join("notes")).unwrap();
        // A double quote is not a legal file name on Windows.
        let name = if cfg!(windows) {
            "notes/日本 plan 'v2'.md"
        } else {
            "notes/日本 plan \"v2\".md"
        };
        fs::write(dir.join(name), "x\n").unwrap();
        assert_eq!(got(&dir), vec![(name.to_string(), ChangeStatus::Added)]);
    }

    #[test]
    fn changes_reports_staged_rename() {
        let (_t, dir) = testutil::repo();
        fs::write(dir.join("old.md"), "some content here\n").unwrap();
        testutil::git(&dir, &["add", "."]);
        testutil::git(&dir, &["commit", "-m", "one"]);
        testutil::git(&dir, &["mv", "old.md", "new.md"]);
        let list = changes(&find_git().unwrap(), &dir).unwrap();
        assert_eq!(
            list,
            vec![Change {
                path: "new.md".into(),
                old_path: Some("old.md".into()),
                status: ChangeStatus::Renamed,
            }]
        );
    }

    #[test]
    fn changes_reports_conflicts() {
        let (_t, dir) = testutil::repo();
        fs::write(dir.join("x.md"), "base\n").unwrap();
        testutil::git(&dir, &["add", "."]);
        testutil::git(&dir, &["commit", "-m", "base"]);
        testutil::git(&dir, &["checkout", "-b", "side"]);
        fs::write(dir.join("x.md"), "side\n").unwrap();
        testutil::git(&dir, &["commit", "-am", "side"]);
        testutil::git(&dir, &["checkout", "main"]);
        fs::write(dir.join("x.md"), "main\n").unwrap();
        testutil::git(&dir, &["commit", "-am", "main"]);
        testutil::git(&dir, &["checkout", "side"]);
        // The rebase stops on the conflict, which is what we want to see.
        let g = find_git().unwrap();
        let _ = g.run(&dir, &["rebase", "main"], Duration::from_secs(30));
        assert_eq!(got(&dir), vec![("x.md".into(), ChangeStatus::Conflicted)]);
    }

    #[test]
    fn changes_refuses_non_repo_and_inside_repo() {
        let (_t, dir) = testutil::repo();
        let inner = dir.join("sub");
        fs::create_dir_all(&inner).unwrap();
        fs::write(inner.join("a.md"), "a\n").unwrap();
        let g = find_git().unwrap();
        let e = changes(&g, &inner).unwrap_err();
        assert_eq!(e.kind, crate::git::GitKind::Refused);
        let plain = tempfile::tempdir().unwrap();
        let e = changes(&g, plain.path()).unwrap_err();
        assert_eq!(e.kind, crate::git::GitKind::Refused);
    }

    #[test]
    fn changes_skips_ignored() {
        let (_t, dir) = testutil::repo();
        fs::write(dir.join(".gitignore"), "*.log\n").unwrap();
        testutil::git(&dir, &["add", "."]);
        testutil::git(&dir, &["commit", "-m", "ignore"]);
        fs::write(dir.join("a.log"), "x\n").unwrap();
        assert_eq!(got(&dir), vec![]);
    }
}
