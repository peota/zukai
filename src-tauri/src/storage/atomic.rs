use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// Write `bytes` to `path` atomically: temp file in the same folder, fsync, rename.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    atomic_write_with_permissions(path, bytes, None)
}

/// Like [`atomic_write`], but applies `perms` to the temp file before the rename,
/// so the replaced file never exists with different permissions.
pub fn atomic_write_with_permissions(
    path: &Path,
    bytes: &[u8],
    perms: Option<fs::Permissions>,
) -> io::Result<()> {
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?
        .to_string_lossy();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let unique = format!(
        "{:x}{:x}{:x}",
        std::process::id(),
        nanos,
        COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let tmp = path.with_file_name(format!("{name}.{unique}.tmp"));

    let result = (|| {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        if let Some(perms) = perms {
            f.set_permissions(perms)?;
        }
        drop(f);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_files(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect()
    }

    #[test]
    fn atomic_write_creates_and_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f.txt");
        atomic_write(&p, b"a").unwrap();
        atomic_write(&p, b"b").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "b");
        assert!(tmp_files(dir.path()).is_empty());
    }

    #[test]
    fn atomic_write_failure_keeps_original() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f.txt");
        atomic_write(&p, b"orig").unwrap();

        // Missing parent: the temp file cannot be created.
        let bad = dir.path().join("missing").join("f.txt");
        assert!(atomic_write(&bad, b"new").is_err());

        // Target is a non-empty directory: temp file is written but the
        // final rename fails on every OS, so the temp file must be cleaned up.
        let target = dir.path().join("d.txt");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("x"), "x").unwrap();
        assert!(atomic_write(&target, b"new").is_err());
        assert!(target.join("x").exists());

        assert_eq!(fs::read_to_string(&p).unwrap(), "orig");
        assert!(tmp_files(dir.path()).is_empty());
    }
}
