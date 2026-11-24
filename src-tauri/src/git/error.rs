//! What went wrong with a git call, in terms the UI can act on.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GitKind {
    Disabled,
    NoGit,
    NotAllowed,
    Busy,
    InProgress,
    Dirty,
    Rejected,
    Conflict,
    RepoUnreachable,
    Network,
    Timeout,
    RemoteNotEmpty,
    BadUrl,
    DestExists,
    Refused,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{kind:?}: {detail}")]
pub struct GitError {
    pub kind: GitKind,
    pub detail: String,
    pub conflicts: Option<u32>,
    pub committed: bool,
}

impl GitError {
    pub fn new(kind: GitKind, detail: impl Into<String>) -> Self {
        GitError {
            kind,
            detail: detail.into(),
            conflicts: None,
            committed: false,
        }
    }
}

/// Sorts git's stderr into a kind by well-known message fragments.
pub fn classify(stderr: &str) -> GitKind {
    let has = |frags: &[&str]| frags.iter().any(|f| stderr.contains(f));
    if has(&["[rejected]", "non-fast-forward", "fetch first"]) {
        GitKind::Rejected
    } else if has(&["CONFLICT", "could not apply"]) {
        GitKind::Conflict
    } else if has(&[
        "Repository not found",
        "Permission denied",
        "Authentication failed",
        "could not read Username",
        "does not appear to be a git repository",
    ]) {
        GitKind::RepoUnreachable
    } else if has(&[
        "Could not resolve host",
        "Connection timed out",
        "Failed to connect",
    ]) {
        GitKind::Network
    } else {
        GitKind::Failed
    }
}

/// The line that best explains a failure: the first `fatal:`, `error:` or
/// ` ! [` line, else the first non-empty line.
pub fn first_line(stderr: &str) -> String {
    stderr
        .lines()
        .find(|l| l.starts_with("fatal:") || l.starts_with("error:") || l.starts_with(" ! ["))
        .or_else(|| stderr.lines().find(|l| !l.trim().is_empty()))
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_maps_fragments() {
        for s in [
            " ! [rejected] main -> main",
            "non-fast-forward",
            "hint: fetch first",
        ] {
            assert_eq!(classify(s), GitKind::Rejected, "{s}");
        }
        for s in [
            "CONFLICT (content): Merge conflict",
            "error: could not apply abc",
        ] {
            assert_eq!(classify(s), GitKind::Conflict, "{s}");
        }
        for s in [
            "remote: Repository not found.",
            "Permission denied (publickey)",
            "Authentication failed for x",
            "could not read Username for x",
            "fatal: 'x' does not appear to be a git repository",
        ] {
            assert_eq!(classify(s), GitKind::RepoUnreachable, "{s}");
        }
        for s in [
            "Could not resolve host: x",
            "Connection timed out",
            "Failed to connect to x",
        ] {
            assert_eq!(classify(s), GitKind::Network, "{s}");
        }
        assert_eq!(classify("weird"), GitKind::Failed);
    }

    #[test]
    fn first_line_prefers_fatal() {
        assert_eq!(
            first_line("hint: x\nfatal: bad thing\n"),
            "fatal: bad thing"
        );
        assert_eq!(first_line("\n  \nplain\nmore"), "plain");
        assert_eq!(first_line(""), "");
    }

    #[test]
    fn error_serializes_snake_case() {
        let e = GitError::new(GitKind::RemoteNotEmpty, "x");
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["kind"], "remote_not_empty");
        assert_eq!(v["detail"], "x");
        assert_eq!(v["committed"], false);
        assert!(v["conflicts"].is_null());
    }
}
