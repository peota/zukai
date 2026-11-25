use super::{Result, atomic::atomic_write};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

/// Per-PDF reading positions, kept as opaque JSON; the UI parses it
/// defensively.
pub fn read(base: &Path) -> Result<Option<String>> {
    match fs::read_to_string(base.join("pdf-positions.json")) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn write(base: &Path, json: &str) -> Result<()> {
    Ok(atomic_write(
        &base.join("pdf-positions.json"),
        json.as_bytes(),
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_is_none() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(read(d.path()).unwrap(), None);
    }

    #[test]
    fn write_then_read_round_trips() {
        let d = tempfile::tempdir().unwrap();
        write(d.path(), r#"{"a":1}"#).unwrap();
        assert_eq!(read(d.path()).unwrap(), Some(r#"{"a":1}"#.to_string()));
    }
}
