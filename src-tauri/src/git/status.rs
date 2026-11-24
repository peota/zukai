//! Reading a library folder's git status.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use super::{Git, GitError, GitKind};
use crate::files::grants::key;

const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FolderGit {
    NotRepo,
    InsideRepo { top: String },
    Repo(RepoStatus),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub branch: Option<String>,
    pub head: String,
    pub dirty: bool,
    pub upstream: bool,
    pub origin: bool,
    pub ahead: u32,
    pub behind: u32,
    pub state: RepoState,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RepoState {
    #[serde(rename = "none")]
    Clean,
    Rebasing,
    Merging,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Parsed {
    pub branch: Option<String>,
    pub head: String,
    pub upstream: bool,
    pub ahead: u32,
    pub behind: u32,
    pub dirty: bool,
    pub conflicts: u32,
}

/// Parses `git status --porcelain=v2 --branch`.
pub fn parse_porcelain(out: &str) -> Parsed {
    let mut p = Parsed::default();
    for line in out.lines() {
        if let Some(oid) = line.strip_prefix("# branch.oid ") {
            p.head = if oid == "(initial)" {
                String::new()
            } else {
                oid.chars().take(7).collect()
            };
        } else if let Some(h) = line.strip_prefix("# branch.head ") {
            p.branch = (h != "(detached)").then(|| h.to_string());
        } else if line.starts_with("# branch.upstream ") {
            p.upstream = true;
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            for part in ab.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    p.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    p.behind = n.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("u ") {
            p.conflicts += 1;
            p.dirty = true;
        } else if line.starts_with("1 ") || line.starts_with("2 ") || line.starts_with("? ") {
            p.dirty = true;
        }
    }
    p
}

/// What git makes of `dir`: not a repo, a folder inside one, or a repo root.
pub fn folder_git(git: &Git, dir: &Path) -> Result<FolderGit, GitError> {
    let top = match git.run(dir, &["rev-parse", "--show-toplevel"], TIMEOUT) {
        Ok(d) => d.stdout.trim().to_string(),
        Err(e) if e.kind == GitKind::Timeout => return Err(e),
        Err(_) => return Ok(FolderGit::NotRepo),
    };
    let here =
        dunce::canonicalize(dir).map_err(|e| GitError::new(GitKind::Failed, e.to_string()))?;
    let top_path = dunce::canonicalize(&top).unwrap_or_else(|_| top.clone().into());
    if key(&top_path) != key(&here) {
        return Ok(FolderGit::InsideRepo {
            top: top_path.to_string_lossy().into_owned(),
        });
    }

    let st = git.run(dir, &["status", "--porcelain=v2", "--branch"], TIMEOUT)?;
    let p = parse_porcelain(&st.stdout);
    let origin = git
        .run(dir, &["remote"], TIMEOUT)?
        .stdout
        .lines()
        .any(|l| l.trim() == "origin");
    let gd = git.run(dir, &["rev-parse", "--git-dir"], TIMEOUT)?;
    let gd = dir.join(gd.stdout.trim());
    let state = if gd.join("rebase-merge").exists() || gd.join("rebase-apply").exists() {
        RepoState::Rebasing
    } else if gd.join("MERGE_HEAD").exists() {
        RepoState::Merging
    } else {
        RepoState::Clean
    };
    Ok(FolderGit::Repo(RepoStatus {
        branch: p.branch,
        head: p.head,
        dirty: p.dirty,
        upstream: p.upstream,
        origin,
        ahead: p.ahead,
        behind: p.behind,
        state,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{find_git, testutil};

    #[test]
    fn parses_unborn_branch() {
        let p = parse_porcelain("# branch.oid (initial)\n# branch.head main\n");
        assert_eq!(p.branch.as_deref(), Some("main"));
        assert_eq!(p.head, "");
        assert_eq!(p.ahead, 0);
        assert!(!p.dirty);
    }

    #[test]
    fn parses_ahead_behind_and_dirty() {
        let p = parse_porcelain(
            "# branch.oid abcdef1234\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b f.md\n",
        );
        assert_eq!((p.ahead, p.behind), (2, 1));
        assert!(p.upstream && p.dirty);
        assert_eq!(p.head, "abcdef1");
    }

    #[test]
    fn parses_detached() {
        let p = parse_porcelain("# branch.oid abcdef1234\n# branch.head (detached)\n");
        assert_eq!(p.branch, None);
    }

    #[test]
    fn counts_conflicts() {
        let p = parse_porcelain(
            "# branch.head main\nu UU N... 1 2 3 4 h1 h2 h3 a.md\nu UU N... 1 2 3 4 h1 h2 h3 b.md\n",
        );
        assert_eq!(p.conflicts, 2);
    }

    #[test]
    fn untracked_counts_as_dirty() {
        assert!(parse_porcelain("# branch.head main\n? new.md\n").dirty);
    }

    #[test]
    fn folder_git_not_repo() {
        let g = find_git().expect("git");
        let tmp = tempfile::tempdir().unwrap();
        // A temp dir could sit inside a repo on a dev machine, so accept any
        // outcome but a repo root.
        let r = folder_git(&g, tmp.path()).unwrap();
        assert!(!matches!(r, FolderGit::Repo(_)));
    }

    #[test]
    fn folder_git_inside_repo() {
        let g = find_git().expect("git");
        let (_t, dir) = testutil::repo();
        let sub = dir.join("sub dir");
        std::fs::create_dir_all(&sub).unwrap();
        match folder_git(&g, &sub).unwrap() {
            FolderGit::InsideRepo { top } => {
                assert_eq!(key(Path::new(&top)), key(&dir));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn folder_git_repo() {
        let g = find_git().expect("git");
        let (_t, dir) = testutil::repo();
        let FolderGit::Repo(s) = folder_git(&g, &dir).unwrap() else {
            panic!("not a repo");
        };
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.head, "");
        assert!(!s.dirty && !s.origin && !s.upstream);
        assert_eq!(s.state, RepoState::Clean);

        let (_t, work, _bare) = testutil::repo_with_remote();
        std::fs::write(work.join("x.md"), "x").unwrap();
        let FolderGit::Repo(s) = folder_git(&g, &work).unwrap() else {
            panic!("not a repo");
        };
        assert!(s.origin && s.upstream && s.dirty);
        assert_eq!(s.head.len(), 7);
        assert_eq!((s.ahead, s.behind), (0, 0));
    }

    #[test]
    fn detects_rebasing() {
        let g = find_git().expect("git");
        let (_t, dir) = testutil::repo();
        std::fs::create_dir_all(dir.join(".git").join("rebase-merge")).unwrap();
        let FolderGit::Repo(s) = folder_git(&g, &dir).unwrap() else {
            panic!("not a repo");
        };
        assert_eq!(s.state, RepoState::Rebasing);
    }

    #[test]
    fn detects_merging() {
        let g = find_git().expect("git");
        let (_t, dir) = testutil::repo();
        std::fs::write(dir.join(".git").join("MERGE_HEAD"), "x\n").unwrap();
        let FolderGit::Repo(s) = folder_git(&g, &dir).unwrap() else {
            panic!("not a repo");
        };
        assert_eq!(s.state, RepoState::Merging);
    }

    #[test]
    fn serializes_wire_shapes() {
        let v = serde_json::to_value(FolderGit::Repo(RepoStatus {
            branch: Some("main".into()),
            head: "abc1234".into(),
            dirty: false,
            upstream: true,
            origin: true,
            ahead: 1,
            behind: 0,
            state: RepoState::Clean,
        }))
        .unwrap();
        assert_eq!(
            v,
            serde_json::json!({"kind":"repo","branch":"main","head":"abc1234","dirty":false,
                "upstream":true,"origin":true,"ahead":1,"behind":0,"state":"none"})
        );
        let v = serde_json::to_value(FolderGit::InsideRepo { top: "/t".into() }).unwrap();
        assert_eq!(v, serde_json::json!({"kind":"insideRepo","top":"/t"}));
        assert_eq!(
            serde_json::to_value(FolderGit::NotRepo).unwrap()["kind"],
            "notRepo"
        );
        assert_eq!(serde_json::to_value(RepoState::Merging).unwrap(), "merging");
    }
}
