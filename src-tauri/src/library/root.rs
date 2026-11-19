//! Where the Library root is stored: `library.json` in the app data folder
//! (spec §5.8 item 4). Only Rust writes it, from the default location or a
//! folder-dialog pick; it is never part of the Session the webview writes.

use crate::storage::atomic::atomic_write;
use std::io;
use std::path::{Path, PathBuf};

pub const LIBRARY_FILE: &str = "library.json";

/// The stored root, or `None` if there is no `library.json` yet or it
/// doesn't hold an absolute path. Whether the folder still exists is the
/// caller's question. An error reading the file (other than its absence)
/// is an error, never "no root".
pub fn load_root(data: &Path) -> io::Result<Option<PathBuf>> {
    let obj = read_object(data)?;
    let root = obj.get("root").and_then(|r| r.as_str()).map(PathBuf::from);
    Ok(root.filter(|r| r.is_absolute()))
}

/// `library.json` as a JSON object: an empty one if it is missing or junk.
/// Any other error reading it (a permission, a file held open by another
/// program) is returned, so it is never mistaken for an empty file.
fn read_object(data: &Path) -> io::Result<serde_json::Map<String, serde_json::Value>> {
    let bytes = match std::fs::read(data.join(LIBRARY_FILE)) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(serde_json::Map::new()),
        Err(e) => return Err(e),
    };
    Ok(match serde_json::from_slice(&bytes) {
        Ok(serde_json::Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    })
}

fn write_object(data: &Path, obj: serde_json::Map<String, serde_json::Value>) -> io::Result<()> {
    let json = serde_json::Value::Object(obj).to_string();
    atomic_write(&data.join(LIBRARY_FILE), json.as_bytes())
}

/// The stored added folders: absolute paths only, junk entries dropped one
/// by one. Overlaps are `added::clean_added`'s business. A read error is
/// returned as in `load_root`.
pub fn load_added(data: &Path) -> io::Result<Vec<PathBuf>> {
    Ok(read_object(data)?
        .get("added")
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|e| e.as_str())
                .map(PathBuf::from)
                .filter(|p| p.is_absolute())
                .collect()
        })
        .unwrap_or_default())
}

/// Stores `root` atomically, replacing any earlier choice and keeping the
/// stored `added` list. Refused (nothing written) if the file can't be read.
pub fn save_root(data: &Path, root: &Path) -> io::Result<()> {
    let root = root
        .to_str()
        .ok_or_else(|| io::Error::other("path is not valid UTF-8"))?;
    let mut obj = read_object(data)?;
    obj.insert("root".into(), root.into());
    write_object(data, obj)
}

/// Stores the added folders atomically, keeping the stored `root`.
/// Refused (nothing written) if the file can't be read.
pub fn save_added(data: &Path, added: &[PathBuf]) -> io::Result<()> {
    let list = added
        .iter()
        .map(|p| {
            p.to_str()
                .map(serde_json::Value::from)
                .ok_or_else(|| io::Error::other("path is not valid UTF-8"))
        })
        .collect::<io::Result<Vec<_>>>()?;
    let mut obj = read_object(data)?;
    obj.insert("added".into(), serde_json::Value::Array(list));
    write_object(data, obj)
}

/// `<Documents>/Zukai`, or `None` if the OS has no Documents folder.
pub fn default_root() -> Option<PathBuf> {
    Some(dirs::document_dir()?.join("Zukai"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_round_trips_in_library_json() {
        let data = tempfile::tempdir().unwrap();
        assert_eq!(load_root(data.path()).unwrap(), None);

        let root = data.path().join("My Library");
        save_root(data.path(), &root).unwrap();
        assert_eq!(load_root(data.path()).unwrap(), Some(root.clone()));

        // A second choice replaces the first.
        let other = data.path().join("Other");
        save_root(data.path(), &other).unwrap();
        assert_eq!(load_root(data.path()).unwrap(), Some(other));

        // Junk, or a relative path, is no root at all.
        let file = data.path().join(LIBRARY_FILE);
        std::fs::write(&file, "not json").unwrap();
        assert_eq!(load_root(data.path()).unwrap(), None);
        std::fs::write(&file, r#"{"root":"relative/dir"}"#).unwrap();
        assert_eq!(load_root(data.path()).unwrap(), None);
        std::fs::write(&file, r#"{"root":42}"#).unwrap();
        assert_eq!(load_root(data.path()).unwrap(), None);
    }

    #[test]
    fn added_round_trips_and_keeps_root() {
        let data = tempfile::tempdir().unwrap();
        let root = data.path().join("Lib");
        let added = vec![data.path().join("a"), data.path().join("b")];
        save_root(data.path(), &root).unwrap();
        save_added(data.path(), &added).unwrap();
        assert_eq!(load_root(data.path()).unwrap(), Some(root.clone()));
        assert_eq!(load_added(data.path()).unwrap(), added);

        let other = data.path().join("Other");
        save_root(data.path(), &other).unwrap();
        assert_eq!(load_root(data.path()).unwrap(), Some(other));
        assert_eq!(load_added(data.path()).unwrap(), added);
    }

    #[test]
    fn junk_added_entries_dropped_one_by_one() {
        let data = tempfile::tempdir().unwrap();
        let root = data.path().join("Lib");
        let abs = data.path().join("a");
        let json = serde_json::json!({
            "root": root.to_str().unwrap(),
            "added": [abs.to_str().unwrap(), 3, "relative", null],
        });
        std::fs::write(data.path().join(LIBRARY_FILE), json.to_string()).unwrap();
        assert_eq!(load_added(data.path()).unwrap(), vec![abs]);
        assert_eq!(load_root(data.path()).unwrap(), Some(root));
    }

    /// `library.json` there but unreadable (here: a folder in its place).
    fn unreadable(data: &Path) {
        std::fs::create_dir(data.join(LIBRARY_FILE)).unwrap();
    }

    #[test]
    fn a_read_error_is_not_an_empty_file() {
        let data = tempfile::tempdir().unwrap();
        unreadable(data.path());
        assert!(load_root(data.path()).is_err());
        assert!(load_added(data.path()).is_err());
        assert!(save_root(data.path(), &data.path().join("Lib")).is_err());
        assert!(save_added(data.path(), &[data.path().join("a")]).is_err());
        assert!(data.path().join(LIBRARY_FILE).is_dir());
    }

    /// A file that can't be read for a moment (another program holds it
    /// open without sharing reads) is never rewritten without its other key.
    #[cfg(windows)]
    #[test]
    fn saving_refuses_to_write_when_the_file_cannot_be_read() {
        use std::os::windows::fs::OpenOptionsExt;
        let data = tempfile::tempdir().unwrap();
        let (root, a) = (data.path().join("Lib"), data.path().join("a"));
        save_root(data.path(), &root).unwrap();
        save_added(data.path(), std::slice::from_ref(&a)).unwrap();
        let file = data.path().join(LIBRARY_FILE);
        // FILE_SHARE_DELETE only: reads fail, a rename over it doesn't.
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0x4)
            .open(&file)
            .unwrap();
        let saved_root = save_root(data.path(), &data.path().join("Other"));
        let saved_added = save_added(data.path(), &[]);
        drop(held);
        assert!(saved_root.is_err());
        assert!(saved_added.is_err());
        assert_eq!(load_root(data.path()).unwrap(), Some(root));
        assert_eq!(load_added(data.path()).unwrap(), [a]);
    }

    #[cfg(unix)]
    #[test]
    fn saving_refuses_to_write_when_the_file_cannot_be_read() {
        use std::os::unix::fs::PermissionsExt;
        let data = tempfile::tempdir().unwrap();
        let (root, a) = (data.path().join("Lib"), data.path().join("a"));
        save_root(data.path(), &root).unwrap();
        save_added(data.path(), std::slice::from_ref(&a)).unwrap();
        let file = data.path().join(LIBRARY_FILE);
        let mode = |m| std::fs::set_permissions(&file, std::fs::Permissions::from_mode(m));
        mode(0o000).unwrap();
        if std::fs::read(&file).is_ok() {
            // Running as root: permissions don't stop reads.
            return;
        }
        let saved_root = save_root(data.path(), &data.path().join("Other"));
        let saved_added = save_added(data.path(), &[]);
        mode(0o600).unwrap();
        assert!(saved_root.is_err());
        assert!(saved_added.is_err());
        assert_eq!(load_root(data.path()).unwrap(), Some(root));
        assert_eq!(load_added(data.path()).unwrap(), [a]);
    }

    #[test]
    fn default_root_is_zukai_in_documents() {
        if let Some(root) = default_root() {
            assert_eq!(root.file_name().unwrap(), "Zukai");
            assert!(root.is_absolute());
        }
    }
}
