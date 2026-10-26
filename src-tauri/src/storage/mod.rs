pub mod atomic;
pub mod scratchpads;
pub mod session;
pub mod shadow;
pub mod startup_log;

use serde::{Serialize, Serializer, ser::SerializeStruct};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("invalid scratchpad id")]
    InvalidId,
    #[error("this path was not opened by the user")]
    NotGranted,
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
}

impl Serialize for StorageError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        let kind = match self {
            StorageError::InvalidId => "invalid_id",
            StorageError::NotGranted => "not_granted",
            _ => "io",
        };
        let mut st = s.serialize_struct("StorageError", 2)?;
        st.serialize_field("kind", kind)?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type Result<T> = std::result::Result<T, StorageError>;

/// `<data_dir>/Zukai`, with `scratchpads/` and `closed/` created if missing.
pub fn data_dir(app: &AppHandle) -> Result<PathBuf> {
    let base = app.path().data_dir()?.join("Zukai");
    std::fs::create_dir_all(base.join("scratchpads"))?;
    std::fs::create_dir_all(base.join("closed"))?;
    Ok(base)
}

/// Accepts only `^[A-Za-z0-9_-]{1,64}$`.
pub fn validate_id(id: &str) -> Result<()> {
    let ok = (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(StorageError::InvalidId)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_id_rejects_traversal() {
        assert!(validate_id("../x").is_err());
        assert!(validate_id("a/b").is_err());
        assert!(validate_id("").is_err());
        assert!(validate_id(&"a".repeat(65)).is_err());
        assert!(validate_id("7f3a-e1_X").is_ok());
    }
}
