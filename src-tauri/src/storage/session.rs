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

pub fn write(base: &Path, json: &str) -> Result<()> {
    Ok(atomic_write(&base.join("session.json"), json.as_bytes())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_read_missing_is_none() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(read(d.path()).unwrap(), None);
    }
}
