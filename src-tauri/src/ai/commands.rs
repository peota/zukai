//! Commands for the Ask settings: status, config and the API key.
//! No command ever returns the key.

use super::AiError;
use super::ask::{AskEvent, Asks, stream_answer};
use super::config::{self, AiConfig, Provider, key_account};
use super::keychain::{KeyringStore, SecretStore};
use super::provider::{Message, build_request, provider_label};
use crate::storage;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub config: Option<AiConfig>,
    pub has_key: bool,
    pub ready: bool,
}

pub fn status_in(dir: &Path, store: &dyn SecretStore) -> Result<AiStatus, AiError> {
    let config = config::load(dir);
    let has_key = match &config {
        Some(c) => store.get(&key_account(c))?.is_some(),
        None => false,
    };
    let ready = match &config {
        Some(c) => {
            let has_url = c.base_url.as_deref().is_some_and(|u| !u.trim().is_empty());
            !c.model.trim().is_empty()
                && match c.provider {
                    Provider::Compatible => has_url,
                    _ => has_key,
                }
        }
        None => false,
    };
    Ok(AiStatus {
        config,
        has_key,
        ready,
    })
}

pub fn config_set_in(
    dir: &Path,
    store: &dyn SecretStore,
    new: AiConfig,
) -> Result<AiStatus, AiError> {
    if let Some(old) = config::load(dir)
        && key_account(&old) != key_account(&new)
    {
        store.delete(&key_account(&old))?;
    }
    config::save(dir, &new)?;
    status_in(dir, store)
}

pub fn key_set_in(dir: &Path, store: &dyn SecretStore, key: &str) -> Result<AiStatus, AiError> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AiError::Invalid("the key is empty".into()));
    }
    let Some(c) = config::load(dir) else {
        return Err(AiError::Invalid("choose a provider first".into()));
    };
    store.set(&key_account(&c), key)?;
    status_in(dir, store)
}

pub fn key_remove_in(dir: &Path, store: &dyn SecretStore) -> Result<AiStatus, AiError> {
    if let Some(c) = config::load(dir) {
        store.delete(&key_account(&c))?;
    }
    status_in(dir, store)
}

async fn blocking<T, F>(app: AppHandle, f: F) -> Result<T, AiError>
where
    T: Send + 'static,
    F: FnOnce(PathBuf, &dyn SecretStore) -> Result<T, AiError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let dir = storage::data_dir(&app).map_err(|e| std::io::Error::other(e.to_string()))?;
        f(dir, &KeyringStore)
    })
    .await
    .map_err(|e| AiError::Io(std::io::Error::other(e)))?
}

#[tauri::command]
pub async fn ai_status(app: AppHandle) -> Result<AiStatus, AiError> {
    blocking(app, |d, s| status_in(&d, s)).await
}

#[tauri::command]
pub async fn ai_config_set(app: AppHandle, config: AiConfig) -> Result<AiStatus, AiError> {
    blocking(app, move |d, s| config_set_in(&d, s, config)).await
}

#[tauri::command]
pub async fn ai_key_set(app: AppHandle, key: String) -> Result<AiStatus, AiError> {
    blocking(app, move |d, s| key_set_in(&d, s, &key)).await
}

#[tauri::command]
pub async fn ai_key_remove(app: AppHandle) -> Result<AiStatus, AiError> {
    blocking(app, |d, s| key_remove_in(&d, s)).await
}

/// Starts an answer and returns once the request is built; the answer's
/// events arrive on `on_event`. The key is read here and never leaves Rust.
#[tauri::command]
pub async fn ai_ask(
    app: AppHandle,
    id: u32,
    system: String,
    messages: Vec<Message>,
    on_event: Channel<AskEvent>,
) -> Result<(), AiError> {
    let (req, config) = blocking(app.clone(), move |dir, store| {
        let status = status_in(&dir, store)?;
        let config = match status.config {
            Some(c) if status.ready => c,
            _ => return Err(AiError::NotReady),
        };
        let key = store.get(&key_account(&config))?;
        // Compatible servers may run without a key; the others need one.
        let key = match (key, config.provider) {
            (Some(k), _) => k,
            (None, Provider::Compatible) => String::new(),
            (None, _) => return Err(AiError::NotReady),
        };
        let req = build_request(&config, &key, &system, &messages)?;
        Ok((req, config))
    })
    .await?;
    let cancel = app.state::<Asks>().start(id);
    tauri::async_runtime::spawn_blocking(move || {
        let label = provider_label(&config);
        stream_answer(req, config.provider, &label, &cancel, &mut |e| {
            let _ = on_event.send(e);
        });
        app.state::<Asks>().finish(id, &cancel);
    });
    Ok(())
}

#[tauri::command]
pub fn ai_cancel(app: AppHandle, id: u32) {
    app.state::<Asks>().cancel(id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryStore(Mutex<HashMap<String, String>>);

    impl SecretStore for MemoryStore {
        fn get(&self, a: &str) -> Result<Option<String>, AiError> {
            Ok(self.0.lock().unwrap().get(a).cloned())
        }
        fn set(&self, a: &str, s: &str) -> Result<(), AiError> {
            self.0.lock().unwrap().insert(a.into(), s.into());
            Ok(())
        }
        fn delete(&self, a: &str) -> Result<(), AiError> {
            self.0.lock().unwrap().remove(a);
            Ok(())
        }
    }

    fn cfg(provider: Provider, base: Option<&str>) -> AiConfig {
        AiConfig {
            provider,
            base_url: base.map(str::to_owned),
            model: "m".into(),
        }
    }

    #[test]
    fn config_change_forgets_key() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        config_set_in(dir.path(), &store, cfg(Provider::Anthropic, None)).unwrap();
        assert!(key_set_in(dir.path(), &store, "sk-secret").unwrap().has_key);
        let st = config_set_in(
            dir.path(),
            &store,
            cfg(Provider::Compatible, Some("http://x")),
        )
        .unwrap();
        assert!(!st.has_key);
        assert_eq!(store.get("anthropic").unwrap(), None);
    }

    #[test]
    fn same_config_keeps_key() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        let c = cfg(Provider::Anthropic, None);
        config_set_in(dir.path(), &store, c.clone()).unwrap();
        key_set_in(dir.path(), &store, "sk-secret").unwrap();
        assert!(config_set_in(dir.path(), &store, c).unwrap().has_key);
    }

    #[test]
    fn compatible_ready_without_key() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        let st = config_set_in(
            dir.path(),
            &store,
            cfg(Provider::Compatible, Some("http://x")),
        )
        .unwrap();
        assert!(st.ready);
        assert!(!st.has_key);
    }

    #[test]
    fn status_never_contains_key() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        config_set_in(dir.path(), &store, cfg(Provider::Openai, None)).unwrap();
        let st = key_set_in(dir.path(), &store, "sk-topsecret").unwrap();
        assert!(st.ready);
        assert!(!serde_json::to_string(&st).unwrap().contains("sk-topsecret"));
    }

    #[test]
    fn key_set_rejects_blank() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        config_set_in(dir.path(), &store, cfg(Provider::Openai, None)).unwrap();
        let err = key_set_in(dir.path(), &store, "  ").unwrap_err();
        let v = serde_json::to_value(&err).unwrap();
        assert_eq!(v["kind"], "invalid");
    }
}
