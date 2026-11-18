//! The allowlist of File paths the webview may touch (spec §8).
//!
//! Paths enter it only from Rust-side sources: the dialogs, the Session that
//! Rust reads at startup, and a rename or Save As of an already granted File.

use super::FileError;
use serde_json::Value;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

#[derive(Default)]
pub struct Grants {
    files: Mutex<HashMap<String, PathBuf>>,
    /// The canonical Library root, set only by Rust (`library.json` or the
    /// folder dialog).
    root: Mutex<Option<PathBuf>>,
}

/// The real path of `p`, without `\\?\` verbatim prefixes on Windows. A path
/// that doesn't exist yet (a Save As target) is its canonical parent joined
/// with its file name.
pub fn canonical(p: &Path) -> io::Result<PathBuf> {
    match dunce::canonicalize(p) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            let (Some(parent), Some(name)) = (p.parent(), p.file_name()) else {
                return Err(e);
            };
            if parent.as_os_str().is_empty() {
                return Err(e);
            }
            Ok(dunce::canonicalize(parent)?.join(name))
        }
        other => other,
    }
}

/// The allowlist key of an already canonical path: case-folded where the
/// usual file systems are case-insensitive, so one File has one key.
pub fn key(p: &Path) -> String {
    let s = p.to_string_lossy();
    if cfg!(any(windows, target_os = "macos")) {
        s.to_lowercase()
    } else {
        s.into_owned()
    }
}

/// True if a part of `p` ends in a dot or a space. Win32 drops those, so
/// `<root>\...` is the root itself and `<root>\sub.` is `sub`: such a path
/// is never a name the webview may use for an item in the Library. Elsewhere
/// they are ordinary names.
pub fn win32_alias(p: &Path) -> bool {
    cfg!(windows)
        && p.components().any(|c| match c {
            Component::Normal(name) => {
                let name = name.to_string_lossy();
                name.ends_with('.') || name.ends_with(' ')
            }
            _ => false,
        })
}

/// True if `p` is absolute and has no `.` or `..` parts, so it can be
/// trusted as is when it can't be canonicalized.
fn plain_absolute(p: &Path) -> bool {
    p.is_absolute()
        && p.components()
            .all(|c| !matches!(c, Component::CurDir | Component::ParentDir))
}

impl Grants {
    fn map(&self) -> MutexGuard<'_, HashMap<String, PathBuf>> {
        // The map is always consistent; a panic elsewhere doesn't poison it.
        self.files.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The canonical Library root, if one is granted.
    pub fn root(&self) -> Option<PathBuf> {
        self.root.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Makes `root` the one granted folder, replacing any earlier one, and
    /// returns its canonical form. It must be an existing absolute folder.
    pub fn set_root(&self, root: &Path) -> Result<PathBuf, FileError> {
        if !root.is_absolute() {
            return Err(FileError::NotGranted);
        }
        let canon = dunce::canonicalize(root)?;
        if !canon.is_dir() {
            return Err(FileError::Io(io::Error::other("not a folder")));
        }
        *self.root.lock().unwrap_or_else(|e| e.into_inner()) = Some(canon.clone());
        Ok(canon)
    }

    /// The canonical form of `p` if it is the Library root or inside it,
    /// else `NotGranted`. A path that doesn't exist yet is checked through
    /// its parent; a link that resolves outside the root (or dangles) is
    /// refused.
    pub fn in_root(&self, p: &Path) -> Result<PathBuf, FileError> {
        if !p.is_absolute() || win32_alias(p) {
            return Err(FileError::NotGranted);
        }
        let canon = canonical(p).map_err(|_| FileError::NotGranted)?;
        self.within_root(canon)
    }

    /// `canon` (already canonical) if it is the root or inside it. Compared
    /// by components, so `/lib2` is not inside `/lib`.
    fn within_root(&self, canon: PathBuf) -> Result<PathBuf, FileError> {
        let root = self.root().ok_or(FileError::NotGranted)?;
        if !canon.starts_with(&root) {
            return Err(FileError::NotGranted);
        }
        // `canonical` resolves every existing link, so a link left in the
        // last place is dangling: a write there would follow it anywhere.
        if std::fs::symlink_metadata(&canon).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(FileError::NotGranted);
        }
        Ok(canon)
    }

    /// Allows the webview to use `p` from now on, returning its canonical
    /// form. `p` must be absolute and not a folder. A File whose folder is
    /// gone (a Session entry) is granted as given if it is a plain absolute
    /// path, so the Session can still be saved with it.
    pub fn grant(&self, p: &Path) -> Result<PathBuf, FileError> {
        if !p.is_absolute() {
            return Err(FileError::NotGranted);
        }
        let path = match canonical(p) {
            Ok(path) => path,
            Err(e) if e.kind() == io::ErrorKind::NotFound && plain_absolute(p) => p.to_path_buf(),
            Err(e) => return Err(e.into()),
        };
        if path.is_dir() {
            return Err(FileError::NotAFile);
        }
        self.map().insert(key(&path), path.clone());
        Ok(path)
    }

    /// The granted path `p` refers to, or `NotGranted`. `p` is either the
    /// granted path byte for byte, or canonicalizes to exactly it or to a
    /// path inside the Library root: a key
    /// match alone could be another file (`a.txt` next to `A.txt` in a
    /// case-sensitive folder). The lock is never held across file system
    /// calls.
    pub fn check(&self, p: &str) -> Result<PathBuf, FileError> {
        let path = Path::new(p);
        if !path.is_absolute() {
            return Err(FileError::NotGranted);
        }
        if let Some(granted) = self.map().get(&key(path))
            && granted.as_os_str() == path.as_os_str()
        {
            return Ok(granted.clone());
        }
        let canon = canonical(path).map_err(|_| FileError::NotGranted)?;
        match self.map().get(&key(&canon)) {
            Some(granted) if granted.as_os_str() == canon.as_os_str() => {
                return Ok(granted.clone());
            }
            _ => {}
        }
        // Anything inside the Library root is granted as a folder.
        if win32_alias(path) {
            return Err(FileError::NotGranted);
        }
        self.within_root(canon)
    }

    /// Like `check`, but `p` must be spelled exactly as the granted path (for
    /// a path in the Library, exactly its canonical form).
    /// A key match alone could be a different file (another case on a
    /// case-sensitive folder, a Unicode case fold NTFS doesn't do).
    pub fn check_exact(&self, p: &str) -> Result<PathBuf, FileError> {
        let granted = self.check(p)?;
        if granted.as_os_str() == OsStr::new(p) {
            Ok(granted)
        } else {
            Err(FileError::NotGranted)
        }
    }
}

/// The paths in `paths` that are granted under exactly that spelling, in
/// order: the File paths of a Session the webview may keep and save back.
pub fn filter_exact(grants: &Grants, paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| grants.check_exact(p).is_ok())
        .collect()
}

/// The File path fields of a Session: `tabs[].file.path` and
/// `closed[].tab.file.path`, when they hold strings. Anything else
/// (Scratchpads, a v1 Session, unknown shapes) contributes none.
fn path_slots(v: &mut Value) -> Vec<&mut Value> {
    fn slot(tab: Option<&mut Value>) -> Option<&mut Value> {
        let path = tab?.get_mut("file")?.get_mut("path")?;
        path.is_string().then_some(path)
    }
    let (mut open, mut closed) = (Vec::new(), Vec::new());
    let Some(obj) = v.as_object_mut() else {
        return open;
    };
    // Fields are visited in map order; keep open Tabs before closed ones.
    for (field, value) in obj.iter_mut() {
        let Some(entries) = value.as_array_mut() else {
            continue;
        };
        match field.as_str() {
            "tabs" => open.extend(entries.iter_mut().filter_map(|t| slot(Some(t)))),
            "closed" => closed.extend(entries.iter_mut().filter_map(|c| slot(c.get_mut("tab")))),
            _ => {}
        }
    }
    open.append(&mut closed);
    open
}

/// The File paths in a Session JSON (see `path_slots`); none if it isn't JSON.
pub fn extract_file_paths(json: &str) -> Vec<String> {
    let Ok(mut v) = serde_json::from_str::<Value>(json) else {
        return Vec::new();
    };
    path_slots(&mut v)
        .into_iter()
        .filter_map(|p| p.as_str().map(str::to_owned))
        .collect()
}

/// Grants every File path in the Session read from disk and rewrites each to
/// its granted canonical spelling, so the UI holds exactly the strings
/// `check_session` will accept (a File renamed in case, or reached through a
/// changed symlink, would otherwise lock `session_write` out). A path that
/// can't be granted is left as is. Unchanged JSON is returned verbatim.
pub fn grant_session(grants: &Grants, json: String) -> String {
    let Ok(mut v) = serde_json::from_str::<Value>(&json) else {
        return json;
    };
    let mut changed = false;
    for slot in path_slots(&mut v) {
        let Some(path) = slot.as_str() else { continue };
        let Ok(granted) = grants.grant(Path::new(path)) else {
            continue;
        };
        if let Some(canon) = granted.to_str()
            && canon != path
        {
            *slot = Value::String(canon.to_owned());
            changed = true;
        }
    }
    if changed { v.to_string() } else { json }
}

/// Refuses a Session that names a File the user never opened: otherwise the
/// webview could grant itself paths through the next launch. Each path must
/// be byte-equal to its granted canonical path, because the next
/// `session_read` grants exactly that spelling.
pub fn check_session(grants: &Grants, json: &str) -> Result<(), FileError> {
    for path in extract_file_paths(json) {
        grants.check_exact(&path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn abs(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, "x").unwrap();
        p
    }

    #[test]
    fn grant_rejects_relative_and_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        assert!(matches!(
            g.grant(Path::new("relative.txt")),
            Err(FileError::NotGranted)
        ));
        assert!(matches!(g.grant(dir.path()), Err(FileError::NotAFile)));

        let file = abs(dir.path(), "a.txt");
        let granted = g.grant(&file).unwrap();
        assert_eq!(granted, canonical(&file).unwrap());
        assert!(!granted.to_string_lossy().starts_with(r"\\?\"));

        // A Save As target that doesn't exist yet is granted via its parent.
        let new = dir.path().join("new.txt");
        assert_eq!(
            g.grant(&new).unwrap(),
            canonical(dir.path()).unwrap().join("new.txt")
        );
    }

    #[test]
    fn check_refuses_ungranted() {
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        let a = abs(dir.path(), "a.txt");
        let b = abs(dir.path(), "b.txt");
        let granted = g.grant(&a).unwrap();

        let a_str = a.to_str().unwrap();
        assert_eq!(g.check(a_str).unwrap(), granted);
        assert_eq!(g.check(granted.to_str().unwrap()).unwrap(), granted);
        assert!(matches!(
            g.check(b.to_str().unwrap()),
            Err(FileError::NotGranted)
        ));
        assert!(matches!(g.check("a.txt"), Err(FileError::NotGranted)));
        assert!(matches!(g.check(""), Err(FileError::NotGranted)));
        // A sibling reached through `..` is still the ungranted file.
        let sneaky = dir.path().join("sub").join("..").join("b.txt");
        assert!(matches!(
            g.check(sneaky.to_str().unwrap()),
            Err(FileError::NotGranted)
        ));
    }

    #[test]
    fn granted_file_whose_folder_vanished_stays_granted() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("gone").join("f.txt");
        let g = Grants::default();
        let granted = g.grant(&gone).unwrap();
        assert_eq!(g.check(gone.to_str().unwrap()).unwrap(), granted);
        // But a lexical path with `..` is never trusted uncanonicalized.
        let dotted = dir.path().join("gone").join("..").join("x.txt");
        let _ = g.grant(&dotted); // canonicalizes fine (parent exists) or errs
        let dotted_missing = dir
            .path()
            .join("gone")
            .join("..")
            .join("gone2")
            .join("x.txt");
        assert!(g.grant(&dotted_missing).is_err());
    }

    #[test]
    fn canonical_dedupes_case_on_windows_and_macos() {
        let upper = key(Path::new(r"X\A.json"));
        let lower = key(Path::new(r"x\a.json"));
        #[cfg(any(windows, target_os = "macos"))]
        assert_eq!(upper, lower);
        #[cfg(not(any(windows, target_os = "macos")))]
        assert_ne!(upper, lower);
    }

    #[test]
    fn session_paths_extracted() {
        let json = r#"{
            "version": 2,
            "tabs": [
                { "id": "s1", "kind": "scratchpad" },
                { "id": "f1", "file": { "path": "/home/u/open.txt" } },
                { "id": "f2", "file": { "path": 42 } },
                { "id": "f3", "file": null }
            ],
            "closed": [
                { "tab": { "id": "s2" } },
                { "tab": { "id": "f4", "file": { "path": "/home/u/closed.txt" } } },
                "junk"
            ]
        }"#;
        assert_eq!(
            extract_file_paths(json),
            ["/home/u/open.txt", "/home/u/closed.txt"]
        );
        // A v1 Session, or something unparseable, has no File paths.
        assert!(extract_file_paths(r#"{"tabs":[{"id":"a"}],"closed":[]}"#).is_empty());
        assert!(extract_file_paths("not json").is_empty());
        assert!(extract_file_paths(r#"{"tabs":{"file":{"path":"/x"}}}"#).is_empty());
    }

    #[test]
    fn check_finds_other_spellings_of_a_granted_file() {
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        let granted = g.grant(&abs(dir.path(), "a.txt")).unwrap();
        let exact = granted.to_str().unwrap();
        assert_eq!(g.check(exact).unwrap(), granted);
        #[cfg(any(windows, target_os = "macos"))]
        assert_eq!(g.check(&exact.to_uppercase()).unwrap(), granted);
        #[cfg(windows)]
        assert_eq!(g.check(&format!(r"\\?\{exact}")).unwrap(), granted);
    }

    #[test]
    fn check_never_resolves_a_key_match_to_another_file() {
        // Two files whose keys collide (as `a.txt` and `A.txt` do in a
        // case-sensitive folder on Windows or macOS): a request for one must
        // never resolve to the other.
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        let other = g.grant(&abs(dir.path(), "other.txt")).unwrap();
        let mine = canonical(&abs(dir.path(), "mine.txt")).unwrap();
        g.map().insert(key(&mine), other.clone());
        assert!(matches!(
            g.check(mine.to_str().unwrap()),
            Err(FileError::NotGranted)
        ));
        // The granted one is still reachable by its own spelling.
        assert_eq!(g.check(other.to_str().unwrap()).unwrap(), other);
    }

    #[test]
    fn check_session_requires_the_exact_granted_spelling() {
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        let granted = g.grant(&abs(dir.path(), "a.txt")).unwrap();
        let exact = granted.to_str().unwrap().to_owned();
        let session = |path: &str| {
            serde_json::json!({ "tabs": [{ "file": { "path": path } }], "closed": [] }).to_string()
        };
        assert!(check_session(&g, &session(&exact)).is_ok());
        let upper = exact.replace("a.txt", "A.TXT");
        assert!(matches!(
            check_session(&g, &session(&upper)),
            Err(FileError::NotGranted)
        ));
        #[cfg(windows)]
        assert!(matches!(
            check_session(&g, &session(&format!(r"\\?\{exact}"))),
            Err(FileError::NotGranted)
        ));
    }

    #[test]
    fn grant_session_grants_and_canonicalizes_paths() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        let a = abs(dir.path(), "a.txt");
        let b = abs(dir.path(), "b.txt");
        let roundabout = dir.path().join("sub").join("..").join("a.txt");
        let g = Grants::default();
        let canon_b = canonical(&b).unwrap();
        let json = serde_json::json!({
            "tabs": [{ "id": "s" }, { "file": { "path": roundabout } }],
            "closed": [{ "tab": { "file": { "path": canon_b } } }],
        })
        .to_string();

        let out = grant_session(&g, json);
        let canon_a = canonical(&a).unwrap();
        assert_eq!(
            extract_file_paths(&out),
            [canon_a.to_str().unwrap(), canon_b.to_str().unwrap()]
        );
        assert!(check_session(&g, &out).is_ok());

        // Nothing to rewrite: returned byte for byte.
        let v1 = r#"{ "tabs": [ {"id":"a"} ], "closed": [] }"#.to_string();
        assert_eq!(grant_session(&g, v1.clone()), v1);
        assert_eq!(grant_session(&g, "not json".into()), "not json");
    }

    #[test]
    fn filter_exact_keeps_only_exactly_granted_spellings() {
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        let a = g.grant(&abs(dir.path(), "a.txt")).unwrap();
        let b = abs(dir.path(), "b.txt");
        let exact = a.to_str().unwrap().to_owned();
        let upper = exact.replace("a.txt", "A.TXT");
        let out = filter_exact(
            &g,
            vec![
                exact.clone(),
                b.to_str().unwrap().to_owned(),
                upper,
                "relative.txt".into(),
                exact.clone(),
            ],
        );
        assert_eq!(out, [exact.clone(), exact]);
    }

    #[test]
    fn session_write_refuses_ungranted() {
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        let a = abs(dir.path(), "a.txt");
        let b = abs(dir.path(), "b.txt");
        // The UI only ever stores the canonical strings Rust returns; the raw
        // temp path may not be one (8.3 names on Windows, /var -> /private/var
        // on macOS).
        let a = g.grant(&a).unwrap();

        let session = |open: &Path, closed: &Path| {
            serde_json::json!({
                "tabs": [{ "id": "s" }, { "file": { "path": open } }],
                "closed": [{ "tab": { "file": { "path": closed } } }],
            })
            .to_string()
        };
        assert!(check_session(&g, &session(&a, &a)).is_ok());
        assert!(matches!(
            check_session(&g, &session(&a, &b)),
            Err(FileError::NotGranted)
        ));
        assert!(matches!(
            check_session(&g, &session(&b, &a)),
            Err(FileError::NotGranted)
        ));
        assert!(check_session(&g, r#"{"tabs":[{"id":"s"}],"closed":[]}"#).is_ok());

        // Another spelling of the granted file passes `check` but not the
        // Session check: only the exact canonical string may be persisted.
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        let alias = canonical(dir.path())
            .unwrap()
            .join("sub")
            .join("..")
            .join("a.txt");
        assert_eq!(g.check(alias.to_str().unwrap()).unwrap(), a);
        assert!(matches!(
            check_session(&g, &session(&alias, &a)),
            Err(FileError::NotGranted)
        ));
    }
}
