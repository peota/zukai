//! The OS keychain, behind a trait so tests can use memory.

use super::AiError;

const SERVICE: &str = "Zukai";

pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, AiError>;
    fn set(&self, account: &str, secret: &str) -> Result<(), AiError>;
    fn delete(&self, account: &str) -> Result<(), AiError>;
}

pub struct KeyringStore;

fn entry(account: &str) -> Result<keyring::Entry, AiError> {
    keyring::Entry::new(SERVICE, account).map_err(|e| AiError::Keychain(e.to_string()))
}

impl SecretStore for KeyringStore {
    fn get(&self, account: &str) -> Result<Option<String>, AiError> {
        match entry(account)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AiError::Keychain(e.to_string())),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), AiError> {
        entry(account)?
            .set_password(secret)
            .map_err(|e| AiError::Keychain(e.to_string()))
    }

    fn delete(&self, account: &str) -> Result<(), AiError> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AiError::Keychain(e.to_string())),
        }
    }
}
