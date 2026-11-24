//! A folder's local branches and the ones only the remote has.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use super::status::read_porcelain;
use super::{Git, GitError};

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
    let current = read_porcelain(git, dir)?.branch;
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
    fn branches_detached_has_no_current() {
        let (_t, work, _bare) = testutil::repo_with_remote();
        testutil::git(&work, &["checkout", "--detach"]);
        let b = branches(&find_git().unwrap(), &work).unwrap();
        assert_eq!(b.current, None);
        assert_eq!(b.local.len(), 1);
    }
}
