use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// Write `bytes` to `path` atomically: temp file in the same folder, fsync, rename.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    atomic_write_with_mode(path, bytes, None).map(drop)
}

/// Creates the temp file. On Unix with `mode`, it is created with (at most)
/// those permission bits and then set to exactly them before any byte is
/// written, so it is never more readable than the file it replaces.
#[cfg(unix)]
fn create_temp(tmp: &Path, mode: Option<u32>) -> io::Result<File> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    if let Some(mode) = mode {
        opts.mode(mode);
    }
    let f = opts.open(tmp)?;
    if let Some(mode) = mode {
        // The create mode was reduced by the umask; set the exact bits.
        f.set_permissions(fs::Permissions::from_mode(mode))?;
    }
    Ok(f)
}

#[cfg(not(unix))]
fn create_temp(tmp: &Path, _mode: Option<u32>) -> io::Result<File> {
    OpenOptions::new().write(true).create_new(true).open(tmp)
}

/// Like [`atomic_write`], but on Unix gives the file `mode & 0o777` (setuid,
/// setgid and sticky bits are dropped); `mode` is ignored elsewhere. Returns the
/// metadata of the written file, taken before the rename (which keeps mtime).
pub fn atomic_write_with_mode(
    path: &Path,
    bytes: &[u8],
    mode: Option<u32>,
) -> io::Result<fs::Metadata> {
    let mode = mode.map(|m| m & 0o777);
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
        let mut f = create_temp(&tmp, mode)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        let meta = f.metadata()?;
        drop(f);
        fs::rename(&tmp, path)?;
        Ok(meta)
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
