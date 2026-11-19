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

/// `library.json` as a JSON object, or an empty one if it is missing or junk.
fn read_object(data: &Path) -> serde_json::Map<String, serde_json::Value> {
    std::fs::read_to_string(data.join(LIBRARY_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .and_then(|v| match v {
            serde_json::Value::Object(m) => Some(m),
            _ => None,
        })
        .unwrap_or_default()
}

fn write_object(data: &Path, obj: serde_json::Map<String, serde_json::Value>) -> io::Result<()> {
    let json = serde_json::Value::Object(obj).to_string();
    atomic_write(&data.join(LIBRARY_FILE), json.as_bytes())
}

/// The stored added folders: absolute paths only, junk entries dropped one
/// by one. Overlaps are `added::clean_added`'s business.
pub fn load_added(data: &Path) -> Vec<PathBuf> {
    read_object(data)
        .get("added")
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|e| e.as_str())
                .map(PathBuf::from)
                .filter(|p| p.is_absolute())
                .collect()
        })
        .unwrap_or_default()
}

/// Stores `root` atomically, replacing any earlier choice and keeping the
/// stored `added` list.
pub fn save_root(data: &Path, root: &Path) -> io::Result<()> {
    let root = root
        .to_str()
        .ok_or_else(|| io::Error::other("path is not valid UTF-8"))?;
    let mut obj = read_object(data);
    obj.insert("root".into(), root.into());
    write_object(data, obj)
}

/// Stores the added folders atomically, keeping the stored `root`.
pub fn save_added(data: &Path, added: &[PathBuf]) -> io::Result<()> {
    let list = added
        .iter()
        .map(|p| {
            p.to_str()
                .map(serde_json::Value::from)
                .ok_or_else(|| io::Error::other("path is not valid UTF-8"))
        })
        .collect::<io::Result<Vec<_>>>()?;
    let mut obj = read_object(data);
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
    fn added_round_trips_and_keeps_root() {
        let data = tempfile::tempdir().unwrap();
        let root = data.path().join("Lib");
        let added = vec![data.path().join("a"), data.path().join("b")];
        save_root(data.path(), &root).unwrap();
        save_added(data.path(), &added).unwrap();
        assert_eq!(load_root(data.path()), Some(root.clone()));
        assert_eq!(load_added(data.path()), added);

        let other = data.path().join("Other");
        save_root(data.path(), &other).unwrap();
        assert_eq!(load_root(data.path()), Some(other));
        assert_eq!(load_added(data.path()), added);
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
        assert_eq!(load_added(data.path()), vec![abs]);
        assert_eq!(load_root(data.path()), Some(root));
    }

    #[test]
    fn default_root_is_zukai_in_documents() {
        if let Some(root) = default_root() {
            assert_eq!(root.file_name().unwrap(), "Zukai");
            assert!(root.is_absolute());
        }
    }
}
