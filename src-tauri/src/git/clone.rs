//! Cloning a remote into a new library folder.

use std::path::Path;
use std::time::Duration;

use super::ops::NO_EXEC_TRANSPORTS;
use super::run::CancelFlag;
use super::url::check_url;
use super::{Git, GitError, GitKind};

/// A clone can be large.
const CLONE: Duration = Duration::from_secs(300);

/// The last path segment of `url`, minus `.git`; `:` separates like `/`.
pub fn repo_name(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches(['/', '\\']);
    let last = trimmed.rsplit(['/', '\\', ':']).next().unwrap_or("");
    last.strip_suffix(".git").unwrap_or(last).to_string()
}

/// Refuses names that can't be one folder name on any supported platform.
pub fn check_name(name: &str) -> Result<(), GitError> {
    let refuse = |why: &str| Err(GitError::new(GitKind::Refused, why));
    if name.is_empty() || name == "." || name == ".." {
        return refuse("the folder name is empty or relative");
    }
    if name
        .chars()
        .any(|c| c.is_control() || "/\\<>:\"|?*".contains(c))
    {
        return refuse("the folder name has a character that is not allowed");
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return refuse("the folder name can't end in a space or dot");
    }
    // Windows reserves device names, with or without an extension.
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let numbered = |prefix: &str| {
        stem.strip_prefix(prefix)
            .is_some_and(|n| n.len() == 1 && n != "0" && n.bytes().all(|b| b.is_ascii_digit()))
    };
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") || numbered("COM") || numbered("LPT")
    {
        return refuse("the folder name is reserved by Windows");
    }
    Ok(())
}

/// Clones `url` into `dest`, which must not exist or be an empty directory.
/// On failure or cancel, what this call put there is removed: `dest` itself if
/// this call created it, otherwise only its contents.
pub fn clone_into(git: &Git, url: &str, dest: &Path, cancel: &CancelFlag) -> Result<(), GitError> {
    check_url(url)?;
    let pre_existing = match std::fs::read_dir(dest) {
        Ok(mut entries) => {
            if entries.next().is_some() {
                return Err(exists());
            }
            true
        }
        // Not there; a file in the way is also "exists".
        Err(_) if dest.symlink_metadata().is_ok() => return Err(exists()),
        Err(_) => false,
    };
    let Some(name) = dest.file_name().and_then(|n| n.to_str()) else {
        return Err(GitError::new(
            GitKind::Refused,
            "the destination has no name",
        ));
    };
    let parent = match dest.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    let mut args = NO_EXEC_TRANSPORTS.to_vec();
    args.extend_from_slice(&["clone", "--", url.trim(), name]);
    let result = git.run_cancellable(parent, &args, CLONE, cancel);
    if result.is_err() {
        cleanup(dest, pre_existing);
    }
    result.map(|_| ())
}

fn exists() -> GitError {
    GitError::new(GitKind::DestExists, "the destination already exists")
}

/// Removes what a failed clone left. A killed git can leave files briefly
/// locked on Windows, so retry a few times.
fn cleanup(dest: &Path, pre_existing: bool) {
    for _ in 0..10 {
        let done = if pre_existing {
            std::fs::read_dir(dest).is_ok_and(|entries| {
                entries.flatten().all(|e| {
                    let p = e.path();
                    if e.file_type().is_ok_and(|t| t.is_dir()) {
                        std::fs::remove_dir_all(p).is_ok()
                    } else {
                        std::fs::remove_file(p).is_ok()
                    }
                })
            })
        } else {
            !dest.exists() || std::fs::remove_dir_all(dest).is_ok()
        };
        if done {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::{FolderGit, GitKind, folder_git, testutil};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    fn flag() -> CancelFlag {
        Arc::new(AtomicBool::new(false))
    }

    fn git() -> Git {
        crate::git::find_git().expect("git")
    }

    #[test]
    fn repo_name_cases() {
        assert_eq!(repo_name("git@github.com:me/notes.git"), "notes");
        assert_eq!(repo_name("https://h/a/b/"), "b");
        assert_eq!(repo_name("host:repo"), "repo");
        assert_eq!(repo_name("C:\\repos\\x.git"), "x");
    }

    #[test]
    fn check_name_refuses() {
        for n in [
            "", ".", "..", "a/b", "a\\b", "a:b", "a<b", "a>b", "a\"b", "a|b", "a?b", "a*b", "CON",
            "con", "nul.txt", "Com1", "LPT9.md", "a ", "a.", "a\tb",
        ] {
            assert_eq!(check_name(n).unwrap_err().kind, GitKind::Refused, "{n:?}");
        }
        for n in [
            "notes",
            "notes ü space",
            "com10",
            "console",
            ".hidden",
            "a.b",
        ] {
            assert!(check_name(n).is_ok(), "{n:?}");
        }
    }

    #[test]
    fn clones_bare_remote() {
        let (tmp, _work, bare) = testutil::repo_with_remote();
        let dest = tmp.path().join("new");
        clone_into(&git(), bare.to_str().unwrap(), &dest, &flag()).unwrap();
        assert!(dest.join("a.md").exists());
        let FolderGit::Repo(s) = folder_git(&git(), &dest).unwrap() else {
            panic!("not a repo");
        };
        assert!(s.upstream);
    }

    #[test]
    fn clones_into_existing_empty_dir() {
        let (tmp, _work, bare) = testutil::repo_with_remote();
        let dest = tmp.path().join("pre ü");
        std::fs::create_dir(&dest).unwrap();
        clone_into(&git(), bare.to_str().unwrap(), &dest, &flag()).unwrap();
        assert!(dest.join("a.md").exists());
    }

    #[test]
    fn clones_empty_repo() {
        let (tmp, bare) = testutil::bare();
        let dest = tmp.path().join("new");
        clone_into(&git(), bare.to_str().unwrap(), &dest, &flag()).unwrap();
        assert!(dest.join(".git").exists());
    }

    #[test]
    fn refuses_non_empty_dest() {
        let (tmp, _work, bare) = testutil::repo_with_remote();
        let dest = tmp.path().join("full");
        std::fs::create_dir(&dest).unwrap();
        std::fs::write(dest.join("mine.md"), "keep").unwrap();
        let e = clone_into(&git(), bare.to_str().unwrap(), &dest, &flag()).unwrap_err();
        assert_eq!(e.kind, GitKind::DestExists);
        assert_eq!(
            std::fs::read_to_string(dest.join("mine.md")).unwrap(),
            "keep"
        );
        // A file at dest is refused too.
        let file = tmp.path().join("afile");
        std::fs::write(&file, "x").unwrap();
        let e = clone_into(&git(), bare.to_str().unwrap(), &file, &flag()).unwrap_err();
        assert_eq!(e.kind, GitKind::DestExists);
    }

    #[test]
    fn refuses_bad_url() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("new");
        let e = clone_into(&git(), "ext::sh -c id", &dest, &flag()).unwrap_err();
        assert_eq!(e.kind, GitKind::BadUrl);
        assert!(!dest.exists());
    }

    #[test]
    fn failed_clone_removes_only_created_dest() {
        let tmp = tempfile::tempdir().unwrap();
        let bad = tmp.path().join("nope.git");
        let new = tmp.path().join("new");
        let e = clone_into(&git(), bad.to_str().unwrap(), &new, &flag()).unwrap_err();
        assert_ne!(e.kind, GitKind::Cancelled);
        assert!(!new.exists());

        let pre = tmp.path().join("pre");
        std::fs::create_dir(&pre).unwrap();
        clone_into(&git(), bad.to_str().unwrap(), &pre, &flag()).unwrap_err();
        assert!(pre.is_dir());
        assert_eq!(std::fs::read_dir(&pre).unwrap().count(), 0);
    }

    #[test]
    fn cancel_removes_dest() {
        let (tmp, _work, bare) = testutil::repo_with_remote();
        let dest = tmp.path().join("new");
        let cancel = flag();
        cancel.store(true, Ordering::SeqCst);
        let e = clone_into(&git(), bare.to_str().unwrap(), &dest, &cancel).unwrap_err();
        assert_eq!(e.kind, GitKind::Cancelled);
        assert!(!dest.exists());
    }

    #[test]
    fn cancel_empties_but_keeps_pre_existing_dir() {
        let (tmp, _work, bare) = testutil::repo_with_remote();
        let dest = tmp.path().join("pre");
        std::fs::create_dir(&dest).unwrap();
        let cancel = flag();
        cancel.store(true, Ordering::SeqCst);
        let e = clone_into(&git(), bare.to_str().unwrap(), &dest, &cancel).unwrap_err();
        assert_eq!(e.kind, GitKind::Cancelled);
        assert!(dest.is_dir());
        assert_eq!(std::fs::read_dir(&dest).unwrap().count(), 0);
    }
}
