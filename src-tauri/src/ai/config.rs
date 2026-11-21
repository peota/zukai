//! Which provider and model Ask uses, kept in `ai.json` (never the key).

use super::AiError;
use crate::storage::atomic::atomic_write;
use serde::{Deserialize, Serialize};
use std::path::Path;

const FILE: &str = "ai.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    Openai,
    Compatible,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub provider: Provider,
    #[serde(default)]
    pub base_url: Option<String>,
    pub model: String,
}

/// The keychain account a config's key lives under. A key belongs to one
/// provider (and, for compatible endpoints, one URL).
pub fn key_account(c: &AiConfig) -> String {
    match c.provider {
        Provider::Anthropic => "anthropic".to_string(),
        Provider::Openai => "openai".to_string(),
        Provider::Compatible => format!(
            "compatible:{}",
            c.base_url.as_deref().unwrap_or("").trim_end_matches('/')
        ),
    }
}

pub fn load(dir: &Path) -> Option<AiConfig> {
    let bytes = std::fs::read(dir.join(FILE)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn save(dir: &Path, c: &AiConfig) -> Result<(), AiError> {
    let bytes = serde_json::to_vec_pretty(c).map_err(std::io::Error::other)?;
    atomic_write(&dir.join(FILE), &bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(provider: Provider, base_url: Option<&str>) -> AiConfig {
        AiConfig {
            provider,
            base_url: base_url.map(str::to_owned),
            model: "m".into(),
        }
    }

    #[test]
    fn key_account_per_provider() {
        assert_eq!(key_account(&cfg(Provider::Anthropic, None)), "anthropic");
        assert_eq!(key_account(&cfg(Provider::Openai, None)), "openai");
        assert_eq!(
            key_account(&cfg(
                Provider::Compatible,
                Some("http://localhost:11434/v1/")
            )),
            "compatible:http://localhost:11434/v1"
        );
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()), None);
        let c = cfg(Provider::Compatible, Some("http://x"));
        save(dir.path(), &c).unwrap();
        assert_eq!(load(dir.path()), Some(c));
        let json = std::fs::read_to_string(dir.path().join("ai.json")).unwrap();
        assert!(json.contains("baseUrl"));
    }
}
