//! The allowlist of File paths the webview may touch (spec §8).
//!
//! Paths enter it only from Rust-side sources: the dialogs, the Session that
//! Rust reads at startup, and a rename or Save As of an already granted File.

use super::FileError;
use serde_json::Value;
use std::collections::HashMap;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

#[derive(Default)]
pub struct Grants(Mutex<HashMap<String, PathBuf>>);

/// The real path of `p`, without `\?\` verbatim prefixes on Windows. A path
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
        self.0.lock().unwrap_or_else(|e| e.into_inner())
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

    /// The granted path `p` refers to, or `NotGranted`.
    pub fn check(&self, p: &str) -> Result<PathBuf, FileError> {
        let path = Path::new(p);
        if !path.is_absolute() {
            return Err(FileError::NotGranted);
        }
        let map = self.map();
        if let Some(granted) = map.get(&key(path)) {
            return Ok(granted.clone());
        }
        canonical(path)
            .ok()
            .and_then(|c| map.get(&key(&c)).cloned())
            .ok_or(FileError::NotGranted)
    }
}

/// The File paths in a Session JSON: `tabs[].file.path` and
/// `closed[].tab.file.path`. Anything else (Scratchpads, a v1 Session,
/// unknown shapes, invalid JSON) contributes none.
pub fn extract_file_paths(json: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<Value>(json) else {
        return Vec::new();
    };
    let entries = |field: &str| -> Vec<Value> {
        v.get(field)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let path_of = |tab: Option<&Value>| -> Option<String> {
        tab?.get("file")?.get("path")?.as_str().map(str::to_owned)
    };
    let open = entries("tabs").into_iter().map(|t| path_of(Some(&t)));
    let closed = entries("closed").into_iter().map(|c| path_of(c.get("tab")));
    open.chain(closed).flatten().collect()
}

/// Refuses a Session that names a File the user never opened: otherwise the
/// webview could grant itself paths through the next launch.
pub fn check_session(grants: &Grants, json: &str) -> Result<(), FileError> {
    for path in extract_file_paths(json) {
        grants.check(&path)?;
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
    fn session_write_refuses_ungranted() {
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        let a = abs(dir.path(), "a.txt");
        let b = abs(dir.path(), "b.txt");
        g.grant(&a).unwrap();

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
    }
}
