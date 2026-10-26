//! Reading, fingerprint-checked writing and safe renaming of user files.

use super::FileError;
use super::encoding::{Decoded, EncodeError, FileFormat, decode_as, detect_and_decode, encode};
use super::fingerprint::{self, Fingerprint, fingerprint_of, mtime_ms};
use crate::storage::atomic::atomic_write_with_permissions;
use serde::Serialize;
use std::ffi::OsString;
use std::fs::{self, File, Metadata};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

pub const MAX_OPEN_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileRead {
    pub text: String,
    pub format: FileFormat,
    pub readable: bool,
    pub fingerprint: Fingerprint,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WriteOutcome {
    Written { fingerprint: Fingerprint },
    Conflict { fingerprint: Fingerprint },
    Missing,
    Unencodable { ch: String, line: u32, col: u32 },
}

/// Reads at most `MAX_OPEN_BYTES` of a regular file, checking the size from
/// metadata first so an oversized file is never read into memory.
fn read_bytes(path: &Path) -> Result<(Vec<u8>, Fingerprint), FileError> {
    // Path metadata first: on Windows a directory can't even be opened as a File.
    let meta = fs::metadata(path)?;
    if !meta.is_file() {
        return Err(FileError::NotAFile);
    }
    if meta.len() > MAX_OPEN_BYTES {
        return Err(FileError::TooLarge);
    }
    let f = File::open(path)?;
    let meta = f.metadata()?;
    if !meta.is_file() {
        return Err(FileError::NotAFile);
    }
    let mut bytes = Vec::with_capacity(meta.len().min(MAX_OPEN_BYTES) as usize);
    // The file may grow between the size check and the read.
    f.take(MAX_OPEN_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_OPEN_BYTES {
        return Err(FileError::TooLarge);
    }
    let fp = fingerprint::from_parts(&meta, &bytes);
    Ok((bytes, fp))
}

fn file_read(decoded: Decoded, fingerprint: Fingerprint) -> FileRead {
    FileRead {
        text: decoded.text,
        format: decoded.format,
        readable: decoded.readable,
        fingerprint,
    }
}

pub fn read_file(path: &Path) -> Result<FileRead, FileError> {
    let (bytes, fp) = read_bytes(path)?;
    Ok(file_read(detect_and_decode(&bytes), fp))
}

pub fn reread_as(path: &Path, label: &str) -> Result<FileRead, FileError> {
    let (bytes, fp) = read_bytes(path)?;
    let decoded =
        decode_as(&bytes, label).ok_or_else(|| FileError::UnknownEncoding(label.to_string()))?;
    Ok(file_read(decoded, fp))
}

/// Encodes `text`, separating "can't be represented" (an outcome) from real errors.
fn encode_for_write(
    text: &str,
    format: &FileFormat,
) -> Result<Result<Vec<u8>, WriteOutcome>, FileError> {
    match encode(text, format) {
        Ok(bytes) => Ok(Ok(bytes)),
        Err(EncodeError::Unencodable(u)) => Ok(Err(WriteOutcome::Unencodable {
            ch: u.ch,
            line: u.line,
            col: u.col,
        })),
        Err(EncodeError::UnknownEncoding(label)) => Err(FileError::UnknownEncoding(label)),
    }
}

/// Unix mode bits of the file being replaced; nothing to carry over elsewhere.
fn permissions_to_keep(existing: Option<&Metadata>) -> Option<fs::Permissions> {
    #[cfg(unix)]
    {
        existing.map(Metadata::permissions)
    }
    #[cfg(not(unix))]
    {
        let _ = existing;
        None
    }
}

fn write_and_fingerprint(
    path: &Path,
    bytes: &[u8],
    existing: Option<&Metadata>,
) -> Result<WriteOutcome, FileError> {
    atomic_write_with_permissions(path, bytes, permissions_to_keep(existing))?;
    let meta = fs::metadata(path)?;
    Ok(WriteOutcome::Written {
        fingerprint: fingerprint::from_parts(&meta, bytes),
    })
}

/// Writes `text` over the file only if the disk content is still what `expected`
/// describes. The check runs immediately before the atomic write.
pub fn write_file(
    path: &Path,
    text: &str,
    format: &FileFormat,
    expected: &Fingerprint,
) -> Result<WriteOutcome, FileError> {
    // Encode first (pure, possibly slow) so the disk check sits right before the write.
    let encoded = encode_for_write(text, format)?;

    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(WriteOutcome::Missing),
        Err(e) => return Err(e.into()),
    };
    if !meta.is_file() {
        return Err(FileError::NotAFile);
    }
    if meta.len() != expected.size || mtime_ms(&meta) != expected.mtime_ms {
        // Something touched the file: only a real content change is a conflict.
        match fingerprint_of(path)? {
            None => return Ok(WriteOutcome::Missing),
            Some(disk) if disk.hash != expected.hash => {
                return Ok(WriteOutcome::Conflict { fingerprint: disk });
            }
            Some(_) => {}
        }
    }

    match encoded {
        Err(unencodable) => Ok(unencodable),
        Ok(bytes) => write_and_fingerprint(path, &bytes, Some(&meta)),
    }
}

/// Writes `text` to `path` with no fingerprint check (the OS dialog already
/// confirmed any overwrite).
pub fn save_as(path: &Path, text: &str, format: &FileFormat) -> Result<WriteOutcome, FileError> {
    let bytes = match encode_for_write(text, format)? {
        Ok(bytes) => bytes,
        Err(unencodable) => return Ok(unencodable),
    };
    let existing = fs::metadata(path).ok().filter(Metadata::is_file);
    write_and_fingerprint(path, &bytes, existing.as_ref())
}

const RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// A stem must be a valid file name on every OS Zukai runs on, so a file
/// renamed on Linux still opens on Windows.
fn validate_stem(stem: &str) -> Result<(), FileError> {
    let bad_char = |c: char| c.is_control() || r#"/\:*?"<>|"#.contains(c);
    let device = stem.split('.').next().unwrap_or("").trim_end();
    let ok = !stem.trim().is_empty()
        && !stem.ends_with('.')
        && !stem.ends_with(' ')
        && !stem.chars().any(bad_char)
        && !RESERVED_NAMES
            .iter()
            .any(|r| r.eq_ignore_ascii_case(device));
    if ok {
        Ok(())
    } else {
        Err(FileError::InvalidName)
    }
}

/// Renames `from` to `<new_stem>.<its extension>` in the same folder, refusing
/// to replace an existing file (atomically, not check-then-rename).
pub fn rename_no_replace(from: &Path, new_stem: &str) -> Result<PathBuf, FileError> {
    validate_stem(new_stem)?;
    let mut new_name = OsString::from(new_stem);
    if let Some(ext) = from.extension() {
        new_name.push(".");
        new_name.push(ext);
    }
    if new_name.len() > 255 {
        return Err(FileError::InvalidName);
    }
    if from.file_name() == Some(new_name.as_os_str()) {
        fs::metadata(from)?;
        return Ok(from.to_path_buf());
    }
    let to = from.with_file_name(&new_name);
    sys::rename_no_replace(from, &to).map_err(|e| {
        if e.kind() == io::ErrorKind::AlreadyExists {
            FileError::Exists
        } else {
            FileError::Io(e)
        }
    })?;
    Ok(to)
}

#[cfg(windows)]
mod sys {
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    fn wide(p: &Path) -> Vec<u16> {
        p.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    /// `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING` fails with
    /// `ERROR_ALREADY_EXISTS` when the target exists.
    pub fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
        let (a, b) = (wide(from), wide(to));
        // SAFETY: both buffers are NUL-terminated UTF-16 and outlive the call.
        let ok = unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), 0) };
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

#[cfg(unix)]
mod sys {
    use std::ffi::CString;
    use std::fs;
    use std::io;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    #[allow(dead_code)] // unused on targets with a native no-replace rename
    fn c_path(p: &Path) -> io::Result<CString> {
        CString::new(p.as_os_str().as_bytes())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains NUL"))
    }

    /// `link` fails with `EEXIST` if `to` exists, so this never replaces.
    #[allow(dead_code)] // only a fallback on Linux and macOS
    fn link_then_unlink(from: &Path, to: &Path) -> io::Result<()> {
        fs::hard_link(from, to)?;
        if let Err(e) = fs::remove_file(from) {
            let _ = fs::remove_file(to);
            return Err(e);
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    pub fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
        let (a, b) = (c_path(from)?, c_path(to)?);
        // SAFETY: both are valid NUL-terminated C strings for the duration of the call.
        let r = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                a.as_ptr(),
                libc::AT_FDCWD,
                b.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        if r == 0 {
            return Ok(());
        }
        let e = io::Error::last_os_error();
        match e.raw_os_error() {
            // Kernel or filesystem without RENAME_NOREPLACE.
            Some(libc::EINVAL) | Some(libc::ENOSYS) => link_then_unlink(from, to),
            _ => Err(e),
        }
    }

    #[cfg(target_os = "macos")]
    pub fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
        let (a, b) = (c_path(from)?, c_path(to)?);
        // SAFETY: both are valid NUL-terminated C strings for the duration of the call.
        let r = unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_EXCL) };
        if r == 0 {
            return Ok(());
        }
        let e = io::Error::last_os_error();
        match e.raw_os_error() {
            // Filesystem without RENAME_EXCL support.
            Some(libc::ENOTSUP) => link_then_unlink(from, to),
            _ => Err(e),
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    pub fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
        link_then_unlink(from, to)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::encoding::LineEnding;
    use crate::files::fingerprint::{fingerprint_of, hash_bytes};
    use std::fs;
    use std::time::{Duration, SystemTime};

    fn cp1252_crlf() -> FileFormat {
        FileFormat {
            encoding: "windows-1252".into(),
            bom: false,
            line_ending: LineEnding::Crlf,
            mixed: false,
        }
    }

    #[test]
    fn read_file_returns_format_and_fingerprint() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        fs::write(&p, b"one\r\ntwo\r\n").unwrap();
        let r = read_file(&p).unwrap();
        assert_eq!(r.text, "one\ntwo\n");
        assert_eq!(r.format.encoding, "utf-8");
        assert_eq!(r.format.line_ending, LineEnding::Crlf);
        assert!(r.readable);
        assert_eq!(r.fingerprint, fingerprint_of(&p).unwrap().unwrap());
        assert_eq!(r.fingerprint.size, 10);
        assert_eq!(r.fingerprint.hash, hash_bytes(b"one\r\ntwo\r\n"));
    }

    #[test]
    fn read_file_too_large() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("big.txt");
        fs::File::create(&p)
            .unwrap()
            .set_len(MAX_OPEN_BYTES + 1)
            .unwrap();
        assert!(matches!(read_file(&p), Err(FileError::TooLarge)));
    }

    #[test]
    fn read_file_rejects_directory() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(read_file(dir.path()), Err(FileError::NotAFile)));
    }

    #[test]
    fn reread_as_uses_given_encoding() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        fs::write(&p, [0x63, 0x61, 0x66, 0xE9]).unwrap(); // "café" in cp1252
        let r = reread_as(&p, "windows-1252").unwrap();
        assert_eq!(r.text, "café");
        assert_eq!(r.format.encoding, "windows-1252");
        assert!(matches!(
            reread_as(&p, "no-such-encoding"),
            Err(FileError::UnknownEncoding(_))
        ));
    }

    #[test]
    fn write_ok_returns_new_fingerprint() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        fs::write(&p, b"old\r\n").unwrap();
        let r = read_file(&p).unwrap();
        let out = write_file(&p, "new\ntext", &r.format, &r.fingerprint).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"new\r\ntext");
        let disk = fingerprint_of(&p).unwrap().unwrap();
        assert_eq!(out, WriteOutcome::Written { fingerprint: disk });
    }

    #[test]
    fn write_refused_when_fingerprint_changed() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        fs::write(&p, b"original").unwrap();
        let r = read_file(&p).unwrap();

        // Another program changes the file through its own handle.
        {
            use std::io::Write;
            let mut other = fs::OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(&p)
                .unwrap();
            other.write_all(b"changed elsewhere").unwrap();
        }

        let out = write_file(&p, "mine", &r.format, &r.fingerprint).unwrap();
        let disk = fingerprint_of(&p).unwrap().unwrap();
        assert_eq!(out, WriteOutcome::Conflict { fingerprint: disk });
        assert_eq!(fs::read(&p).unwrap(), b"changed elsewhere");
    }

    #[test]
    fn write_missing_when_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        fs::write(&p, b"x").unwrap();
        let r = read_file(&p).unwrap();
        fs::remove_file(&p).unwrap();
        let out = write_file(&p, "mine", &r.format, &r.fingerprint).unwrap();
        assert_eq!(out, WriteOutcome::Missing);
        assert!(!p.exists());
    }

    #[test]
    fn write_unencodable_leaves_file_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        fs::write(&p, b"abc").unwrap();
        let fp = fingerprint_of(&p).unwrap().unwrap();
        let out = write_file(&p, "ok\nsmile \u{1F600}", &cp1252_crlf(), &fp).unwrap();
        assert_eq!(
            out,
            WriteOutcome::Unencodable {
                ch: "\u{1F600}".into(),
                line: 2,
                col: 7
            }
        );
        assert_eq!(fs::read(&p).unwrap(), b"abc");
        let entries = fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(entries, 1, "no temp file left behind");
    }

    #[test]
    fn touch_without_change_is_not_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        fs::write(&p, b"same").unwrap();
        let r = read_file(&p).unwrap();
        let later = SystemTime::now() + Duration::from_secs(60);
        fs::File::options()
            .write(true)
            .open(&p)
            .unwrap()
            .set_modified(later)
            .unwrap();
        assert_ne!(fingerprint_of(&p).unwrap().unwrap(), r.fingerprint);

        let out = write_file(&p, "updated", &r.format, &r.fingerprint).unwrap();
        assert!(matches!(out, WriteOutcome::Written { .. }));
        assert_eq!(fs::read(&p).unwrap(), b"updated");
    }

    #[test]
    fn save_as_creates_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("new.txt");
        let out = save_as(&p, "a\nb", &cp1252_crlf()).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"a\r\nb");
        let disk = fingerprint_of(&p).unwrap().unwrap();
        assert_eq!(out, WriteOutcome::Written { fingerprint: disk });

        let q = dir.path().join("other.txt");
        let out = save_as(&q, "\u{1F600}", &cp1252_crlf()).unwrap();
        assert!(matches!(out, WriteOutcome::Unencodable { .. }));
        assert!(!q.exists());
    }

    #[test]
    fn write_outcome_serializes_with_kind_tag() {
        let v = serde_json::to_value(WriteOutcome::Missing).unwrap();
        assert_eq!(v, serde_json::json!({ "kind": "missing" }));
        let v = serde_json::to_value(WriteOutcome::Written {
            fingerprint: Fingerprint {
                mtime_ms: 1,
                size: 2,
                hash: "h".into(),
            },
        })
        .unwrap();
        assert_eq!(v["kind"], "written");
        assert_eq!(v["fingerprint"]["mtimeMs"], 1);
    }

    #[cfg(unix)]
    #[test]
    fn write_keeps_unix_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("run.sh");
        fs::write(&p, b"echo hi\n").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o750)).unwrap();
        let r = read_file(&p).unwrap();
        let out = write_file(&p, "echo bye\n", &r.format, &r.fingerprint).unwrap();
        assert!(matches!(out, WriteOutcome::Written { .. }));
        let mode = fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o750);
    }

    #[test]
    fn rename_no_replace_refuses_existing() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.txt");
        let b = dir.path().join("b.txt");
        fs::write(&a, b"aaa").unwrap();
        fs::write(&b, b"bbb").unwrap();
        assert!(matches!(rename_no_replace(&a, "b"), Err(FileError::Exists)));
        assert_eq!(fs::read(&a).unwrap(), b"aaa");
        assert_eq!(fs::read(&b).unwrap(), b"bbb");
    }

    #[test]
    fn rename_keeps_extension() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("notes.v1.md");
        fs::write(&a, b"x").unwrap();
        let to = rename_no_replace(&a, "plan").unwrap();
        assert_eq!(to, dir.path().join("plan.md"));
        assert!(!a.exists());
        assert_eq!(fs::read(&to).unwrap(), b"x");

        let n = dir.path().join("Makefile");
        fs::write(&n, b"y").unwrap();
        let to = rename_no_replace(&n, "GNUmakefile").unwrap();
        assert_eq!(to, dir.path().join("GNUmakefile"));
        assert_eq!(fs::read(&to).unwrap(), b"y");
    }

    #[test]
    fn rename_rejects_separators() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.txt");
        fs::write(&a, b"x").unwrap();
        for bad in [
            "x/y", "x\\y", "..", ".", "", "  ", "con", "NUL", "com1", "lpt9", "a:b", "a*b", "a?b",
            "a<b", "a>b", "a|b", "a\"b", "a\0b", "trail.", "trail ",
        ] {
            assert!(
                matches!(rename_no_replace(&a, bad), Err(FileError::InvalidName)),
                "{bad:?} should be rejected"
            );
        }
        assert!(a.exists());
    }

    #[test]
    fn rename_missing_source_is_io_error() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("gone.txt");
        assert!(matches!(rename_no_replace(&a, "b"), Err(FileError::Io(_))));
    }
}
