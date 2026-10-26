//! Cheap identity of a file's content: mtime + size, backed by an xxh3 hash.

use super::io::read_capped;
use serde::{Deserialize, Serialize};
use std::fs::{File, Metadata};
use std::io;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Fingerprint {
    pub mtime_ms: u64,
    pub size: u64,
    pub hash: String,
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:016x}", xxhash_rust::xxh3::xxh3_64(bytes))
}

pub fn mtime_ms(meta: &Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

pub fn from_parts(meta: &Metadata, bytes: &[u8]) -> Fingerprint {
    Fingerprint {
        mtime_ms: mtime_ms(meta),
        size: bytes.len() as u64,
        hash: hash_bytes(bytes),
    }
}

/// The fingerprint of a file too large to read: its real mtime and size with
/// an empty hash, which marks "never read" and never matches real content,
/// so the UI always treats it as changed.
pub fn unread(meta: &Metadata) -> Fingerprint {
    Fingerprint {
        mtime_ms: mtime_ms(meta),
        size: meta.len(),
        hash: String::new(),
    }
}

/// Fingerprint of the file at `path`, or `None` if it doesn't exist. A file
/// past `MAX_OPEN_BYTES` is not read: see `unread`.
pub fn fingerprint_of(path: &Path) -> io::Result<Option<Fingerprint>> {
    let f = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let meta = f.metadata()?;
    Ok(Some(match read_capped(&f, meta.len())? {
        Some(bytes) => from_parts(&meta, &bytes),
        None => unread(&meta),
    }))
}

/// For re-checks only (never before a write): `expected` itself when the
/// file's mtime and size still match it, without reading the file; otherwise
/// a full `fingerprint_of`. An empty (unread) hash never short-cuts.
pub fn fingerprint_quick(path: &Path, expected: &Fingerprint) -> io::Result<Option<Fingerprint>> {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    if !expected.hash.is_empty()
        && meta.is_file()
        && mtime_ms(&meta) == expected.mtime_ms
        && meta.len() == expected.size
    {
        return Ok(Some(expected.clone()));
    }
    fingerprint_of(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_fingerprint_skips_the_hash_only_when_time_and_size_match() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        assert_eq!(
            fingerprint_quick(
                &p,
                &Fingerprint {
                    mtime_ms: 1,
                    size: 1,
                    hash: "x".into()
                }
            )
            .unwrap(),
            None
        );
        std::fs::write(&p, b"hello").unwrap();
        let real = fingerprint_of(&p).unwrap().unwrap();
        // Same time and size: the expected one comes back as is, unhashed
        // (a stand-in hash proves the file wasn't read).
        let expected = Fingerprint {
            hash: "stored".into(),
            ..real.clone()
        };
        assert_eq!(
            fingerprint_quick(&p, &expected).unwrap(),
            Some(expected.clone())
        );
        // A different size or time: a full fingerprint.
        let other_size = Fingerprint {
            size: 4,
            ..expected.clone()
        };
        assert_eq!(
            fingerprint_quick(&p, &other_size).unwrap(),
            Some(real.clone())
        );
        let other_time = Fingerprint {
            mtime_ms: real.mtime_ms + 1,
            ..expected.clone()
        };
        assert_eq!(
            fingerprint_quick(&p, &other_time).unwrap(),
            Some(real.clone())
        );
        // An unread (empty) hash never short-cuts.
        let unread = Fingerprint {
            hash: String::new(),
            ..real.clone()
        };
        assert_eq!(fingerprint_quick(&p, &unread).unwrap(), Some(real));
    }

    #[test]
    fn fingerprint_of_over_cap_file_is_unread_and_never_matches() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("big.txt");
        let len = crate::files::io::MAX_OPEN_BYTES + 1;
        File::create(&p).unwrap().set_len(len).unwrap();
        let fp = fingerprint_of(&p).unwrap().unwrap();
        assert_eq!(fp.size, len);
        assert_eq!(fp.hash, "");
    }

    #[test]
    fn fingerprint_missing_is_none_and_present_matches_content() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.txt");
        assert_eq!(fingerprint_of(&p).unwrap(), None);
        std::fs::write(&p, b"hello").unwrap();
        let fp = fingerprint_of(&p).unwrap().unwrap();
        assert_eq!(fp.size, 5);
        assert_eq!(fp.hash, hash_bytes(b"hello"));
        assert!(fp.mtime_ms > 0);
    }
}
