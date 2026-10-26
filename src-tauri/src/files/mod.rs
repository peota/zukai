//! Reading and writing real files on disk.

pub mod commands;
pub mod encoding;
pub mod fingerprint;
pub mod grants;
pub mod io;

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
    /// Serialized with kind `"io"`: the frontend only ever sends labels it got from us.
    #[error("unknown encoding: {0}")]
    UnknownEncoding(String),
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
    }
}
