//! A file as it is in the last commit, for the diff's "before" side.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use super::ops::repo_status;
use super::{Git, GitError, GitKind};

const TIMEOUT: Duration = Duration::from_secs(10);
/// Larger committed files are not shown.
const MAX_BYTES: u64 = 1_048_576;
/// How much of a blob is searched for a NUL byte.
const SNIFF: usize = 8_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HeadFile {
    Text { text: String },
    Binary,
    TooLarge,
    Missing,
}

fn refused(detail: &str) -> GitError {
    GitError::new(GitKind::Refused, detail)
}

/// True for a path git should read relative to the repo: not absolute, not
/// drive-prefixed, not empty, and with no `..` segment.
fn safe_path(path: &str) -> bool {
    let drive_prefixed = path.as_bytes().get(1) == Some(&b':');
    let bad = path.is_empty()
        || path.starts_with(['/', '\\'])
        || drive_prefixed
        || path.contains('\0')
        || path.split(['/', '\\']).any(|seg| seg == "..");
    !bad
}

/// `path` (relative to the repo root) as committed at `HEAD`.
pub fn head_file(git: &Git, dir: &Path, path: &str) -> Result<HeadFile, GitError> {
    if !safe_path(path) {
        return Err(refused("That path isn't inside the folder."));
    }
    repo_status(git, dir)?;
    let spec = format!("HEAD:{path}");
    // Absent in HEAD, or no commit yet.
    match git.run(dir, &["cat-file", "-e", &spec], TIMEOUT) {
        Ok(_) => {}
        Err(e) if e.kind == GitKind::Failed => return Ok(HeadFile::Missing),
        Err(e) => return Err(e),
    }
    let size = git.run(dir, &["cat-file", "-s", &spec], TIMEOUT)?;
    if size.stdout.trim().parse::<u64>().unwrap_or(u64::MAX) > MAX_BYTES {
        return Ok(HeadFile::TooLarge);
    }
    let bytes = git.run_bytes(dir, &["cat-file", "blob", &spec], TIMEOUT)?;
    if bytes.iter().take(SNIFF).any(|&b| b == 0) {
        return Ok(HeadFile::Binary);
    }
    Ok(match String::from_utf8(bytes) {
        Ok(text) => HeadFile::Text { text },
        Err(_) => HeadFile::Binary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{find_git, testutil};

    fn committed(name: &str, bytes: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
        let (t, dir) = testutil::repo();
        std::fs::write(dir.join(name), bytes).unwrap();
        testutil::git(&dir, &["add", "."]);
        testutil::git(&dir, &["commit", "-m", "c"]);
        (t, dir)
    }

    #[test]
    fn head_file_returns_committed_text() {
        let (_t, dir) = committed("a.md", b"one\n");
        std::fs::write(dir.join("a.md"), "two\n").unwrap();
        assert_eq!(
            head_file(&find_git().unwrap(), &dir, "a.md").unwrap(),
            HeadFile::Text {
                text: "one\n".into()
            }
        );
    }

    #[test]
    fn head_file_missing_for_new_file() {
        let (_t, dir) = committed("a.md", b"one\n");
        std::fs::write(dir.join("new.md"), "x").unwrap();
        let g = find_git().unwrap();
        assert_eq!(head_file(&g, &dir, "new.md").unwrap(), HeadFile::Missing);
        let (_t2, empty) = testutil::repo();
        assert_eq!(head_file(&g, &empty, "a.md").unwrap(), HeadFile::Missing);
    }

    #[test]
    fn head_file_binary() {
        let (_t, dir) = committed("b.bin", b"ab\0cd");
        assert_eq!(
            head_file(&find_git().unwrap(), &dir, "b.bin").unwrap(),
            HeadFile::Binary
        );
        let (_t, dir) = committed("c.bin", &[0xff, 0xfe, 0x41]);
        assert_eq!(
            head_file(&find_git().unwrap(), &dir, "c.bin").unwrap(),
            HeadFile::Binary
        );
    }

    #[test]
    fn head_file_too_large() {
        let (_t, dir) = committed("big.md", &vec![b'a'; 1_048_577]);
        assert_eq!(
            head_file(&find_git().unwrap(), &dir, "big.md").unwrap(),
            HeadFile::TooLarge
        );
        let (_t, dir) = committed("ok.md", &vec![b'a'; 1_048_576]);
        assert!(matches!(
            head_file(&find_git().unwrap(), &dir, "ok.md").unwrap(),
            HeadFile::Text { .. }
        ));
    }

    #[test]
    fn head_file_refuses_bad_paths() {
        let (_t, dir) = committed("a.md", b"one\n");
        let g = find_git().unwrap();
        for p in ["../x", "/etc/passwd", "C:/x", "a/../../b", "", "..\\x"] {
            let e = head_file(&g, &dir, p).unwrap_err();
            assert_eq!(e.kind, GitKind::Refused, "{p}");
        }
    }
}
