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
/// The UI suggests the folder name itself (`repoName` in TypeScript); this
/// is the reference it is tested against here.
#[cfg_attr(not(test), allow(dead_code))]
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

/// Prefix of the private directory a clone is made in.
const STAGING_PREFIX: &str = ".zukai-clone-";
/// How long to keep trying to remove a partial clone.
const CLEANUP_BUDGET: Duration = Duration::from_secs(3);

/// Clones `url` into `dest`, which must not exist or be an empty directory.
///
/// The clone is made in a private staging directory next to `dest` and moved
/// into place on success, so a failure or cancel only ever removes staging,
/// never anything at `dest`.
pub fn clone_into(git: &Git, url: &str, dest: &Path, cancel: &CancelFlag) -> Result<(), GitError> {
    check_url(url)?;
    // Fail before a long clone if the answer is already known.
    match std::fs::read_dir(dest) {
        Ok(mut entries) => {
            if entries.next().is_some() {
                return Err(exists());
            }
        }
        // Not there; a file in the way is also "exists".
        Err(_) if dest.symlink_metadata().is_ok() => return Err(exists()),
        Err(_) => {}
    }
    if dest.file_name().is_none() {
        return Err(GitError::new(
            GitKind::Refused,
            "the destination has no name",
        ));
    }
    let parent = match dest.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    let (staging, staging_name) = make_staging(parent)?;
    let mut args = NO_EXEC_TRANSPORTS.to_vec();
    args.extend_from_slice(&["clone", "--", url.trim(), &staging_name]);
    let result = git
        .run_cancellable(parent, &args, CLONE, cancel)
        .map(|_| ())
        .and_then(|()| install(&staging, dest));
    if let Err(mut e) = result {
        if !remove_staging(&staging) {
            e.detail = format!(
                "{} Couldn't remove the partial clone at {}.",
                e.detail,
                staging.display()
            );
        }
        return Err(e);
    }
    Ok(())
}

fn exists() -> GitError {
    GitError::new(GitKind::DestExists, "the destination already exists")
}

/// Atomically creates a fresh `.zukai-clone-<hex>` directory in `parent`.
fn make_staging(parent: &Path) -> Result<(std::path::PathBuf, String), GitError> {
    use std::hash::{BuildHasher, Hasher};
    for _ in 0..5 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u32(std::process::id());
        h.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos()),
        );
        let name = format!("{STAGING_PREFIX}{:016x}", h.finish());
        let path = parent.join(&name);
        match std::fs::create_dir(&path) {
            Ok(()) => return Ok((path, name)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(GitError::new(GitKind::Failed, e.to_string())),
        }
    }
    Err(GitError::new(
        GitKind::Failed,
        "couldn't create a working folder for the clone",
    ))
}

/// Moves the finished clone to `dest`. An empty directory already at `dest` is
/// replaced; anything else there (including something that appeared during
/// the clone) is left alone and reported as `DestExists`.
fn install(staging: &Path, dest: &Path) -> Result<(), GitError> {
    if dest.symlink_metadata().is_ok() {
        // `remove_dir` only removes an empty directory.
        std::fs::remove_dir(dest).map_err(|_| exists())?;
    }
    std::fs::rename(staging, dest).map_err(|e| {
        if dest.symlink_metadata().is_ok() {
            exists()
        } else {
            GitError::new(GitKind::Failed, e.to_string())
        }
    })
}

/// Removes the staging directory, retrying for a while since a killed git can
/// leave files locked on Windows. True when it is gone.
fn remove_staging(staging: &Path) -> bool {
    let deadline = std::time::Instant::now() + CLEANUP_BUDGET;
    loop {
        if !staging.exists() || std::fs::remove_dir_all(staging).is_ok() {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
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

    fn no_staging(dir: &Path) -> bool {
        !std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().starts_with(STAGING_PREFIX))
    }

    #[test]
    fn dest_created_during_clone_is_not_deleted() {
        let tmp = tempfile::tempdir().unwrap();
        let staging = tmp.path().join(".zukai-clone-x");
        std::fs::create_dir(&staging).unwrap();
        std::fs::write(staging.join("cloned.md"), "c").unwrap();
        let dest = tmp.path().join("dest");
        std::fs::create_dir(&dest).unwrap();
        std::fs::write(dest.join("theirs.md"), "keep").unwrap();
        let e = install(&staging, &dest).unwrap_err();
        assert_eq!(e.kind, GitKind::DestExists);
        assert_eq!(
            std::fs::read_to_string(dest.join("theirs.md")).unwrap(),
            "keep"
        );
        assert!(remove_staging(&staging));
        assert!(!staging.exists());
    }

    #[test]
    fn cancel_mid_clone_leaves_nothing() {
        let (tmp, _work, bare) = testutil::repo_with_remote();
        let dest = tmp.path().join("new");
        let cancel = flag();
        let (setter, root) = (cancel.clone(), tmp.path().to_path_buf());
        // Cancel as soon as the staging directory exists: before or during git.
        let watcher = std::thread::spawn(move || {
            while no_staging(&root) {
                std::thread::sleep(Duration::from_millis(1));
            }
            setter.store(true, Ordering::SeqCst);
        });
        let e = clone_into(&git(), bare.to_str().unwrap(), &dest, &cancel).unwrap_err();
        watcher.join().unwrap();
        assert_eq!(e.kind, GitKind::Cancelled);
        assert!(!dest.exists());
        assert!(no_staging(tmp.path()));
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
    fn clone_into_existing_empty_dir_keeps_it_as_the_clone() {
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
    fn failed_clone_leaves_dest_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let bad = tmp.path().join("nope.git");
        let new = tmp.path().join("new");
        let e = clone_into(&git(), bad.to_str().unwrap(), &new, &flag()).unwrap_err();
        assert_ne!(e.kind, GitKind::Cancelled);
        assert!(!new.exists());
        assert!(no_staging(tmp.path()));

        let pre = tmp.path().join("pre");
        std::fs::create_dir(&pre).unwrap();
        clone_into(&git(), bad.to_str().unwrap(), &pre, &flag()).unwrap_err();
        assert!(pre.is_dir());
        assert_eq!(std::fs::read_dir(&pre).unwrap().count(), 0);
        assert!(no_staging(tmp.path()));
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
