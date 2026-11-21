//! The Ask feature's backend: provider config and the API key store.

pub mod commands;
pub mod config;
pub mod keychain;

use serde::{Serialize, Serializer, ser::SerializeStruct};

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    /// The OS keychain refused or is unavailable. Never carries the key.
    #[error("the keychain failed: {0}")]
    Keychain(String),
    #[error("{0}")]
    Invalid(String),
}

impl Serialize for AiError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let kind = match self {
            AiError::Io(_) => "io",
            AiError::Keychain(_) => "keychain",
            AiError::Invalid(_) => "invalid",
        };
        let mut st = s.serialize_struct("AiError", 2)?;
        st.serialize_field("kind", kind)?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}
