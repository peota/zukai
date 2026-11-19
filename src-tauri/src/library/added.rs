//! Which folders may be added beside the Library (design §4 "Adding").
//! Pure path logic over canonical paths, so it is tested against plain
//! paths and run by both `Grants::add_root` and the load-time cleanup.

use crate::files::grants::key;
use std::path::{Path, PathBuf};

/// Why a folder can't join the sidebar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    InLibrary,
    ContainsLibrary,
    AlreadyAdded,
    ContainsAdded,
    TooBroad,
}

impl Refusal {
    /// The text the user sees.
    pub fn message(&self) -> &'static str {
        match self {
            Refusal::InLibrary => "That folder is already in your Library.",
            Refusal::ContainsLibrary => "That folder contains your Library.",
            Refusal::AlreadyAdded => "That folder is already in the sidebar.",
            Refusal::ContainsAdded => "That folder contains a folder already in the sidebar.",
            Refusal::TooBroad => "That folder is too big to add. Pick a folder inside it.",
        }
    }
}

/// The comparison keys of `p`'s components, so `/a/b2` isn't inside `/a/b`
/// and case-insensitive systems agree with `grants::key`.
fn parts(p: &Path) -> Vec<String> {
    p.components()
        .map(|c| key(Path::new(c.as_os_str())))
        .collect()
}

/// True if `inner` is `outer` or below it.
fn within(inner: &[String], outer: &[String]) -> bool {
    inner.len() >= outer.len() && inner[..outer.len()] == *outer
}

/// True if `p` is a mount point (a volume root such as `/Volumes/X`): on
/// another device than its parent. Never on Windows, where a volume root
/// is a drive root (no parent) and `refusal` already refuses it.
pub fn is_mount_point(p: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let Some(parent) = p.parent() else {
            return false;
        };
        match (std::fs::metadata(p), std::fs::metadata(parent)) {
            (Ok(m), Ok(up)) => m.dev() != up.dev(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        let _ = p;
        false
    }
}

/// Why `candidate` may not be added, or `None` if it may. All paths are
/// canonical; `home` is the user's home folder if known; `mount_point`
/// whether `candidate` is a volume root (`is_mount_point`).
pub fn refusal(
    candidate: &Path,
    library: Option<&Path>,
    added: &[PathBuf],
    home: Option<&Path>,
    mount_point: bool,
) -> Option<Refusal> {
    if mount_point || candidate.parent().is_none() || home.is_some_and(|h| key(h) == key(candidate))
    {
        return Some(Refusal::TooBroad);
    }
    let cand = parts(candidate);
    if let Some(lib) = library.map(parts) {
        if within(&cand, &lib) {
            return Some(Refusal::InLibrary);
        }
        if within(&lib, &cand) {
            return Some(Refusal::ContainsLibrary);
        }
    }
    let others: Vec<Vec<String>> = added.iter().map(|a| parts(a)).collect();
    if others.iter().any(|a| within(&cand, a)) {
        return Some(Refusal::AlreadyAdded);
    }
    if others.iter().any(|a| within(a, &cand)) {
        return Some(Refusal::ContainsAdded);
    }
    None
}

/// The entries of a stored list that still fit: the Library wins over any
/// added folder, and earlier entries win over later ones. Each dropped
/// entry is logged. The home folder isn't checked here.
pub fn clean_added(library: Option<&Path>, added: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut kept: Vec<PathBuf> = Vec::new();
    for p in added {
        match refusal(&p, library, &kept, None, false) {
            None => kept.push(p),
            Some(r) => eprintln!("dropping added folder {}: {}", p.display(), r.message()),
        }
    }
    kept
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"C:\data")
        } else {
            PathBuf::from("/data")
        }
    }

    #[test]
    fn refuses_library_inside_and_containing() {
        let b = base();
        let lib = b.join("lib");
        assert_eq!(
            refusal(&lib, Some(&lib), &[], None, false),
            Some(Refusal::InLibrary)
        );
        assert_eq!(
            refusal(&lib.join("inner"), Some(&lib), &[], None, false),
            Some(Refusal::InLibrary)
        );
        assert_eq!(
            refusal(&b, Some(&lib), &[], None, false),
            Some(Refusal::ContainsLibrary)
        );
        assert_eq!(
            refusal(&b.join("other"), Some(&lib), &[], None, false),
            None
        );
        assert_eq!(refusal(&lib, None, &[], None, false), None);
    }

    #[test]
    fn refuses_added_inside_equal_and_containing() {
        let b = base();
        let added = vec![b.join("x").join("y")];
        assert_eq!(
            refusal(&b.join("x").join("y"), None, &added, None, false),
            Some(Refusal::AlreadyAdded)
        );
        assert_eq!(
            refusal(&b.join("x").join("y").join("z"), None, &added, None, false),
            Some(Refusal::AlreadyAdded)
        );
        assert_eq!(
            refusal(&b.join("x"), None, &added, None, false),
            Some(Refusal::ContainsAdded)
        );
        assert_eq!(refusal(&b.join("w"), None, &added, None, false), None);
    }

    #[cfg(windows)]
    #[test]
    fn same_folder_other_case_is_already_added() {
        let added = vec![PathBuf::from(r"C:\X\Work")];
        assert_eq!(
            refusal(Path::new(r"c:\x\work"), None, &added, None, false),
            Some(Refusal::AlreadyAdded)
        );
    }

    #[test]
    fn sibling_prefix_is_not_inside() {
        let b = base();
        assert_eq!(
            refusal(&b.join("b2"), None, &[b.join("b")], None, false),
            None
        );
        assert_eq!(
            refusal(&b.join("b"), None, &[b.join("b2")], None, false),
            None
        );
        assert_eq!(
            refusal(&b.join("b2"), Some(&b.join("b")), &[], None, false),
            None
        );
    }

    #[test]
    fn drive_root_and_home_are_too_broad() {
        let b = base();
        let root = b.ancestors().last().unwrap().to_path_buf();
        assert_eq!(
            refusal(&root, None, &[], Some(&b), false),
            Some(Refusal::TooBroad)
        );
        let home = b.join("home");
        assert_eq!(
            refusal(&home, None, &[], Some(&home), false),
            Some(Refusal::TooBroad)
        );
        assert_eq!(
            refusal(&home.join("Docs"), None, &[], Some(&home), false),
            None
        );
    }

    #[test]
    fn a_volume_root_is_too_broad() {
        let vol = base().join("Volumes").join("X");
        assert_eq!(
            refusal(&vol, None, &[], None, true),
            Some(Refusal::TooBroad)
        );
        assert_eq!(refusal(&vol.join("work"), None, &[], None, false), None);
    }

    #[test]
    fn a_plain_folder_is_not_a_mount_point() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("sub")).unwrap();
        assert!(!is_mount_point(&tmp.path().join("sub")));
        assert!(!is_mount_point(&tmp.path().join("missing")));
    }

    /// `/dev` is its own file system on Linux and macOS.
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn dev_is_a_mount_point() {
        assert!(is_mount_point(Path::new("/dev")));
    }

    #[test]
    fn clean_added_drops_overlaps_keeping_first() {
        let b = base();
        let lib = b.join("lib");
        let x = b.join("x");
        let got = clean_added(
            Some(&lib),
            vec![lib.join("inner"), x.clone(), x.join("y"), x.clone()],
        );
        assert_eq!(got, vec![x]);
    }
}
