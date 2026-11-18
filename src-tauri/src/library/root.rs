//! Where the Library root is stored: `library.json` in the app data folder
//! (spec §5.8 item 4). Only Rust writes it, from the default location or a
//! folder-dialog pick; it is never part of the Session the webview writes.

use crate::storage::atomic::atomic_write;
use std::io;
use std::path::{Path, PathBuf};

pub const LIBRARY_FILE: &str = "library.json";

/// The stored root, or `None` if there is no `library.json` yet or it
/// doesn't hold an absolute path. Whether the folder still exists is the
/// caller's question.
pub fn load_root(data: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(data.join(LIBRARY_FILE)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let root = PathBuf::from(v.get("root")?.as_str()?);
    root.is_absolute().then_some(root)
}

/// Stores `root` atomically, replacing any earlier choice.
pub fn save_root(data: &Path, root: &Path) -> io::Result<()> {
    let root = root
        .to_str()
        .ok_or_else(|| io::Error::other("path is not valid UTF-8"))?;
    let json = serde_json::json!({ "root": root }).to_string();
    atomic_write(&data.join(LIBRARY_FILE), json.as_bytes())
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
        assert_eq!(load_root(data.path()), None);

        let root = data.path().join("My Library");
        save_root(data.path(), &root).unwrap();
        assert_eq!(load_root(data.path()), Some(root.clone()));

        // A second choice replaces the first.
        let other = data.path().join("Other");
        save_root(data.path(), &other).unwrap();
        assert_eq!(load_root(data.path()), Some(other));

        // Junk, or a relative path, is no root at all.
        let file = data.path().join(LIBRARY_FILE);
        std::fs::write(&file, "not json").unwrap();
        assert_eq!(load_root(data.path()), None);
        std::fs::write(&file, r#"{"root":"relative/dir"}"#).unwrap();
        assert_eq!(load_root(data.path()), None);
        std::fs::write(&file, r#"{"root":42}"#).unwrap();
        assert_eq!(load_root(data.path()), None);
    }

    #[test]
    fn default_root_is_zukai_in_documents() {
        if let Some(root) = default_root() {
            assert_eq!(root.file_name().unwrap(), "Zukai");
            assert!(root.is_absolute());
        }
    }
}
