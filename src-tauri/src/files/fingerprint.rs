//! Cheap identity of a file's content: mtime + size, backed by an xxh3 hash.

use serde::{Deserialize, Serialize};
use std::fs::{File, Metadata};
use std::io::{self, Read};
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

/// Fingerprint of the file at `path`, or `None` if it doesn't exist.
pub fn fingerprint_of(path: &Path) -> io::Result<Option<Fingerprint>> {
    let mut f = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let meta = f.metadata()?;
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    f.read_to_end(&mut bytes)?;
    Ok(Some(from_parts(&meta, &bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

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
