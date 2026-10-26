//! Shadow files: `<data>/Zukai/pending/<id>.txt`, the unsaved text of held File Tabs.

use super::atomic::atomic_write;
use super::{Result, validate_id};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

fn dir(base: &Path) -> PathBuf {
    base.join("pending")
}

fn path_for(base: &Path, id: &str) -> Result<PathBuf> {
    validate_id(id)?;
    Ok(dir(base).join(format!("{id}.txt")))
}

pub fn write(base: &Path, id: &str, text: &str) -> Result<()> {
    let path = path_for(base, id)?;
    fs::create_dir_all(dir(base))?;
    atomic_write(&path, text.as_bytes())?;
    Ok(())
}

pub fn read(base: &Path, id: &str) -> Result<Option<String>> {
    match fs::read_to_string(path_for(base, id)?) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Removing a shadow file that isn't there is not an error.
pub fn delete(base: &Path, id: &str) -> Result<()> {
    match fs::remove_file(path_for(base, id)?) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

/// Ids of all shadow files; temp files and foreign names are skipped.
pub fn list(base: &Path) -> Result<Vec<String>> {
    let entries = match fs::read_dir(dir(base)) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut ids = Vec::new();
    for entry in entries {
        let name = entry?.file_name();
        let Some(id) = name.to_str().and_then(|n| n.strip_suffix(".txt")) else {
            continue;
        };
        if validate_id(id).is_ok() {
            ids.push(id.to_string());
        }
    }
    ids.sort();
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::StorageError;

    #[test]
    fn shadow_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        assert_eq!(list(base).unwrap(), Vec::<String>::new());
        assert_eq!(read(base, "t1").unwrap(), None);

        write(base, "t1", "held text\r\n").unwrap();
        write(base, "t2", "other").unwrap();
        write(base, "t1", "newer").unwrap();
        std::fs::write(base.join("pending").join("junk.tmp"), "x").unwrap();

        assert_eq!(read(base, "t1").unwrap().as_deref(), Some("newer"));
        assert!(base.join("pending").join("t1.txt").exists());
        let mut ids = list(base).unwrap();
        ids.sort();
        assert_eq!(ids, ["t1", "t2"]);

        delete(base, "t1").unwrap();
        delete(base, "t1").unwrap(); // idempotent
        assert_eq!(read(base, "t1").unwrap(), None);
        assert_eq!(list(base).unwrap(), ["t2"]);

        assert!(matches!(
            write(base, "../x", "y"),
            Err(StorageError::InvalidId)
        ));
        assert!(matches!(read(base, "a/b"), Err(StorageError::InvalidId)));
        assert!(matches!(delete(base, ""), Err(StorageError::InvalidId)));
    }
}
