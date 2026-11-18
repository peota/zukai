//! Reading and writing real files on disk.

pub mod commands;
pub mod encoding;
pub mod exec;
pub mod fingerprint;
pub mod grants;
pub mod io;
pub mod open_paths;
pub mod watch;

use serde::{Serialize, Serializer, ser::SerializeStruct};

#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("this path was not opened by the user")]
    NotGranted,
    #[error("not a file")]
    NotAFile,
    #[error("too large to open yet")]
    TooLarge,
    #[error("a file with that name already exists")]
    Exists,
    #[error("invalid file name")]
    InvalidName,
    /// The OS trash refused the item (e.g. on some network drives); nothing
    /// was deleted, and Zukai never falls back to a permanent delete.
    #[error("the trash isn't available here, so nothing was deleted ({0})")]
    TrashUnavailable(String),
    #[error("a folder can't be moved into itself")]
    IntoSelf,
    /// Serialized with kind `"io"`: the frontend only ever sends labels it got from us.
    #[error("unknown encoding: {0}")]
    UnknownEncoding(String),
}

/// `io::Error` isn't `Clone`; a copy keeps the variant (so the UI still sees
/// the same kind) and, for I/O errors, the error kind and message.
impl Clone for FileError {
    fn clone(&self) -> Self {
        match self {
            FileError::Io(e) => FileError::Io(std::io::Error::new(e.kind(), e.to_string())),
            FileError::NotGranted => FileError::NotGranted,
            FileError::NotAFile => FileError::NotAFile,
            FileError::TooLarge => FileError::TooLarge,
            FileError::Exists => FileError::Exists,
            FileError::InvalidName => FileError::InvalidName,
            FileError::TrashUnavailable(why) => FileError::TrashUnavailable(why.clone()),
            FileError::IntoSelf => FileError::IntoSelf,
            FileError::UnknownEncoding(label) => FileError::UnknownEncoding(label.clone()),
        }
    }
}

impl Serialize for FileError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        let kind = match self {
            FileError::Io(_) | FileError::UnknownEncoding(_) => "io",
            FileError::NotGranted => "not_granted",
            FileError::NotAFile => "not_a_file",
            FileError::TooLarge => "too_large",
            FileError::Exists => "exists",
            FileError::InvalidName => "invalid_name",
            FileError::TrashUnavailable(_) => "trash_unavailable",
            FileError::IntoSelf => "into_self",
        };
        let mut st = s.serialize_struct("FileError", 2)?;
        st.serialize_field("kind", kind)?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_error_serializes_kind_and_message() {
        let v = serde_json::to_value(FileError::Exists).unwrap();
        assert_eq!(v["kind"], "exists");
        assert!(v["message"].as_str().unwrap().contains("exists"));
        let v = serde_json::to_value(FileError::UnknownEncoding("x".into())).unwrap();
        assert_eq!(v["kind"], "io");
        let v = serde_json::to_value(FileError::TrashUnavailable("no bin".into())).unwrap();
        assert_eq!(v["kind"], "trash_unavailable");
        assert!(v["message"].as_str().unwrap().contains("no bin"));
        let v = serde_json::to_value(FileError::IntoSelf).unwrap();
        assert_eq!(v["kind"], "into_self");
    }
}
