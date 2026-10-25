use super::{Result, atomic::atomic_write};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

pub fn read(base: &Path) -> Result<Option<String>> {
    match fs::read_to_string(base.join("session.json")) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Copy `session.json` to `session.json.bak` (atomically), before a session
/// file that could not be read or parsed is overwritten. No-op when missing.
pub fn backup(base: &Path) -> Result<()> {
    let bytes = match fs::read(base.join("session.json")) {
        Ok(b) => b,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    Ok(atomic_write(&base.join("session.json.bak"), &bytes)?)
}

pub fn write(base: &Path, json: &str) -> Result<()> {
    Ok(atomic_write(&base.join("session.json"), json.as_bytes())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_copies_the_session_file() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("session.json"), b"{broken\xff").unwrap();
        backup(d.path()).unwrap();
        assert_eq!(
            fs::read(d.path().join("session.json.bak")).unwrap(),
            b"{broken\xff"
        );
    }

    #[test]
    fn backup_without_a_session_is_a_no_op() {
        let d = tempfile::tempdir().unwrap();
        backup(d.path()).unwrap();
        assert!(!d.path().join("session.json.bak").exists());
    }

    #[test]
    fn session_read_missing_is_none() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(read(d.path()).unwrap(), None);
    }
}
