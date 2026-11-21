//! Commands for the Ask settings: status, config and the API key.
//! No command ever returns the key.

use super::AiError;
use super::ask::{AskEvent, Asks, stream_answer};
use super::config::{self, AiConfig, Provider, effective_model, key_account};
use super::keychain::{KeyringStore, SecretStore};
use super::models::fetch_models;
use super::provider::{HttpRequest, Message, build_request, models_request, provider_label};
use crate::storage;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub config: Option<AiConfig>,
    pub has_key: bool,
    pub ready: bool,
    /// Why the key couldn't be read (no keychain, a locked one). The key
    /// then counts as missing; keyless compatible servers still work.
    pub keychain_error: Option<String>,
}

pub fn status_in(dir: &Path, store: &dyn SecretStore) -> Result<AiStatus, AiError> {
    let config = config::load(dir);
    let (has_key, keychain_error) = match &config {
        Some(c) => match store.get(&key_account(c)) {
            Ok(k) => (k.is_some(), None),
            Err(e) => (false, Some(e.to_string())),
        },
        None => (false, None),
    };
    let ready = match &config {
        Some(c) => {
            let has_url = c.base_url.as_deref().is_some_and(|u| !u.trim().is_empty());
            !effective_model(c).is_empty()
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
        keychain_error,
    })
}

pub fn config_set_in(
    dir: &Path,
    store: &dyn SecretStore,
    new: AiConfig,
) -> Result<AiStatus, AiError> {
    if let Some(old) = config::load(dir)
        && key_account(&old) != key_account(&new)
        && let Err(e) = store.delete(&key_account(&old))
    {
        // A keychain that can't be read at all holds no key we could
        // forget (and keys are per provider and URL, so an old one never
        // reaches the new config). Otherwise the key must go first.
        if store.get(&key_account(&old)).is_ok() {
            return Err(e);
        }
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

/// A request ready to send, with what its answer needs.
pub struct Prepared {
    pub req: HttpRequest,
    pub provider: Provider,
    pub label: String,
    /// Kept only to take it out of error messages.
    pub key: String,
}

/// Builds the request for an ask: reads the config and the key (the slow,
/// blocking part). A key that can't be read counts as none.
pub fn prepare_in(
    dir: &Path,
    store: &dyn SecretStore,
    system: &str,
    messages: &[Message],
) -> Result<Prepared, AiError> {
    let status = status_in(dir, store)?;
    let config = match status.config {
        Some(c) if status.ready => c,
        _ => return Err(AiError::NotReady),
    };
    let key = store.get(&key_account(&config)).unwrap_or(None);
    // Compatible servers may run without a key; the others need one.
    let key = match (key, config.provider) {
        (Some(k), _) => k,
        (None, Provider::Compatible) => String::new(),
        (None, _) => return Err(AiError::NotReady),
    };
    let req = build_request(&config, &key, system, messages)?;
    Ok(Prepared {
        req,
        provider: config.provider,
        label: provider_label(&config),
        key,
    })
}

/// What listing the models needs: the request, and the key to take out of
/// errors.
pub struct ModelsPrepared {
    pub req: HttpRequest,
    pub provider: Provider,
    pub label: String,
    pub key: String,
}

/// Builds the models-list request. Needs a saved provider and its key (or,
/// for a compatible server, its URL); a model needn't be chosen yet.
pub fn models_prepare_in(dir: &Path, store: &dyn SecretStore) -> Result<ModelsPrepared, AiError> {
    let Some(config) = config::load(dir) else {
        return Err(AiError::NotReady);
    };
    let key = match (store.get(&key_account(&config))?, config.provider) {
        (Some(k), _) => k,
        (None, Provider::Compatible) => String::new(),
        (None, _) => return Err(AiError::NotReady),
    };
    Ok(ModelsPrepared {
        req: models_request(&config, &key)?,
        provider: config.provider,
        label: provider_label(&config),
        key,
    })
}

/// `text` with every copy of a non-empty `key` replaced by `[key]`.
fn without_key(text: String, key: &str) -> String {
    if key.is_empty() || !text.contains(key) {
        text
    } else {
        text.replace(key, "[key]")
    }
}

/// Streams a prepared answer to `sink`, the key taken out of any error,
/// then forgets answer `id`. Nothing is sent if `cancel` is already set.
pub fn answer(
    asks: &Asks,
    id: u32,
    cancel: &Arc<AtomicBool>,
    p: Prepared,
    sink: &mut dyn FnMut(AskEvent),
) {
    let Prepared {
        req,
        provider,
        label,
        key,
    } = p;
    stream_answer(req, provider, &label, cancel, &mut |e| {
        sink(match e {
            AskEvent::Error { message } => AskEvent::Error {
                message: without_key(message, &key),
            },
            other => other,
        })
    });
    asks.finish(id, cancel);
}

/// One AI config or key command at a time, so a key can't be stored under
/// the account of a config that's being replaced.
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

async fn blocking<T, F>(app: AppHandle, f: F) -> Result<T, AiError>
where
    T: Send + 'static,
    F: FnOnce(PathBuf, &dyn SecretStore) -> Result<T, AiError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let dir = storage::data_dir(&app).map_err(|e| std::io::Error::other(e.to_string()))?;
        let _held = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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
    // Registered before the keychain read, so a Stop that comes during it
    // is seen.
    let cancel = app.state::<Asks>().start(id);
    let prepared = blocking(app.clone(), move |dir, store| {
        prepare_in(&dir, store, &system, &messages)
    })
    .await;
    let p = match prepared {
        Ok(p) => p,
        Err(e) => {
            app.state::<Asks>().finish(id, &cancel);
            return Err(e);
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        answer(&app.state::<Asks>(), id, &cancel, p, &mut |e| {
            let _ = on_event.send(e);
        });
    });
    Ok(())
}

/// The saved provider's model ids, for the Model dropdown.
#[tauri::command]
pub async fn ai_models(app: AppHandle) -> Result<Vec<String>, AiError> {
    let p = blocking(app, |d, s| models_prepare_in(&d, s)).await?;
    tauri::async_runtime::spawn_blocking(move || {
        fetch_models(&p.req, p.provider, &p.label).map_err(|e| match e {
            AiError::Network(m) => AiError::Network(without_key(m, &p.key)),
            other => other,
        })
    })
    .await
    .map_err(|e| AiError::Io(std::io::Error::other(e)))?
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

    /// A keychain that can't be read (Linux without a Secret Service).
    struct FailingStore;

    impl SecretStore for FailingStore {
        fn get(&self, _: &str) -> Result<Option<String>, AiError> {
            Err(AiError::Keychain("no Secret Service".into()))
        }
        fn set(&self, _: &str, _: &str) -> Result<(), AiError> {
            Err(AiError::Keychain("no Secret Service".into()))
        }
        fn delete(&self, _: &str) -> Result<(), AiError> {
            Ok(())
        }
    }

    /// Hands out a key, but a Stop for answer `id` arrives while it's read.
    struct CancellingStore(Arc<Asks>, u32);

    impl SecretStore for CancellingStore {
        fn get(&self, _: &str) -> Result<Option<String>, AiError> {
            self.0.cancel(self.1);
            Ok(Some("sk-secret".into()))
        }
        fn set(&self, _: &str, _: &str) -> Result<(), AiError> {
            Ok(())
        }
        fn delete(&self, _: &str) -> Result<(), AiError> {
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
    fn models_need_a_key_but_not_a_model() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        assert!(matches!(
            models_prepare_in(dir.path(), &store),
            Err(AiError::NotReady)
        ));
        let mut c = cfg(Provider::Openai, None);
        c.model = String::new();
        config_set_in(dir.path(), &store, c).unwrap();
        assert!(matches!(
            models_prepare_in(dir.path(), &store),
            Err(AiError::NotReady)
        ));
        key_set_in(dir.path(), &store, "sk-secret").unwrap();
        let p = models_prepare_in(dir.path(), &store).unwrap();
        assert_eq!(p.req.url, "https://api.openai.com/v1/models");
        assert_eq!(p.key, "sk-secret");
    }

    #[test]
    fn compatible_models_need_no_key() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        config_set_in(
            dir.path(),
            &store,
            cfg(Provider::Compatible, Some("http://localhost:11434/v1")),
        )
        .unwrap();
        let p = models_prepare_in(dir.path(), &store).unwrap();
        assert_eq!(p.req.url, "http://localhost:11434/v1/models");
        assert!(p.req.headers.is_empty());
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

    fn msgs() -> Vec<Message> {
        vec![Message {
            role: super::super::provider::Role::User,
            content: "hi".into(),
        }]
    }

    #[test]
    fn openai_with_key_but_no_model_is_not_ready() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        let mut c = cfg(Provider::Openai, None);
        c.model = "".into();
        config_set_in(dir.path(), &store, c).unwrap();
        let st = key_set_in(dir.path(), &store, "sk-secret").unwrap();
        assert!(st.has_key);
        assert!(!st.ready);
    }

    #[test]
    fn anthropic_without_key_is_not_ready() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        let st = config_set_in(dir.path(), &store, cfg(Provider::Anthropic, None)).unwrap();
        assert!(!st.ready);
    }

    #[test]
    fn anthropic_with_key_and_empty_model_is_ready() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        let mut c = cfg(Provider::Anthropic, None);
        c.model = "".into();
        config_set_in(dir.path(), &store, c).unwrap();
        assert!(key_set_in(dir.path(), &store, "sk-secret").unwrap().ready);
        let p = prepare_in(dir.path(), &store, "sys", &msgs()).unwrap();
        assert_eq!(p.req.body["model"], "claude-sonnet-5-5");
    }

    #[test]
    fn unreadable_keychain_is_a_missing_key_with_a_reason() {
        let dir = tempfile::tempdir().unwrap();
        config::save(dir.path(), &cfg(Provider::Anthropic, None)).unwrap();
        let st = status_in(dir.path(), &FailingStore).unwrap();
        assert!(!st.has_key);
        assert!(!st.ready);
        let v = serde_json::to_value(&st).unwrap();
        assert_eq!(v["keychainError"], "the keychain failed: no Secret Service");
        let err = prepare_in(dir.path(), &FailingStore, "sys", &msgs())
            .err()
            .unwrap();
        assert!(matches!(err, AiError::NotReady));
        // With a readable keychain there's no reason to show.
        let st = status_in(dir.path(), &MemoryStore::default()).unwrap();
        assert!(serde_json::to_value(&st).unwrap()["keychainError"].is_null());
    }

    #[test]
    fn unreadable_keychain_still_lets_a_keyless_server_work() {
        let dir = tempfile::tempdir().unwrap();
        let c = cfg(Provider::Compatible, Some("http://localhost:11434/v1"));
        config::save(dir.path(), &c).unwrap();
        let st = status_in(dir.path(), &FailingStore).unwrap();
        assert!(st.ready);
        assert!(st.keychain_error.is_some());
        let p = prepare_in(dir.path(), &FailingStore, "sys", &msgs()).unwrap();
        assert!(p.key.is_empty());
        assert!(
            !p.req
                .headers
                .iter()
                .any(|(k, _)| k.eq_ignore_ascii_case("authorization"))
        );
    }

    /// Reads fail, and so does forgetting (a real keyring with no service).
    struct NoService;

    impl SecretStore for NoService {
        fn get(&self, _: &str) -> Result<Option<String>, AiError> {
            Err(AiError::Keychain("no Secret Service".into()))
        }
        fn set(&self, _: &str, _: &str) -> Result<(), AiError> {
            Err(AiError::Keychain("no Secret Service".into()))
        }
        fn delete(&self, _: &str) -> Result<(), AiError> {
            Err(AiError::Keychain("no Secret Service".into()))
        }
    }

    #[test]
    fn unreadable_keychain_still_lets_the_url_change() {
        let dir = tempfile::tempdir().unwrap();
        config_set_in(dir.path(), &NoService, cfg(Provider::Compatible, None)).unwrap();
        let st = config_set_in(
            dir.path(),
            &NoService,
            cfg(Provider::Compatible, Some("http://localhost:11434/v1")),
        )
        .unwrap();
        assert!(st.ready);
    }

    /// Holds a key it refuses to delete.
    struct StuckKey;

    impl SecretStore for StuckKey {
        fn get(&self, _: &str) -> Result<Option<String>, AiError> {
            Ok(Some("sk-secret".into()))
        }
        fn set(&self, _: &str, _: &str) -> Result<(), AiError> {
            Ok(())
        }
        fn delete(&self, _: &str) -> Result<(), AiError> {
            Err(AiError::Keychain("locked".into()))
        }
    }

    #[test]
    fn a_key_that_cant_be_forgotten_blocks_the_change() {
        let dir = tempfile::tempdir().unwrap();
        config_set_in(dir.path(), &StuckKey, cfg(Provider::Anthropic, None)).unwrap();
        assert!(config_set_in(dir.path(), &StuckKey, cfg(Provider::Openai, None)).is_err());
        assert_eq!(
            config::load(dir.path()).unwrap().provider,
            Provider::Anthropic
        );
    }

    #[test]
    fn stop_during_key_read_sends_nothing() {
        use std::net::TcpListener;
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        l.set_nonblocking(true).unwrap();
        let base = format!("http://{}/v1", l.local_addr().unwrap());
        let dir = tempfile::tempdir().unwrap();
        config::save(dir.path(), &cfg(Provider::Compatible, Some(&base))).unwrap();
        let asks = Arc::new(Asks::default());
        let store = CancellingStore(asks.clone(), 5);
        let cancel = asks.start(5);
        let p = prepare_in(dir.path(), &store, "sys", &msgs()).unwrap();
        let mut out = Vec::new();
        answer(&asks, 5, &cancel, p, &mut |e| out.push(e));
        std::thread::sleep(std::time::Duration::from_millis(200));
        assert!(l.accept().is_err(), "a connection was made");
        assert!(out.is_empty(), "{out:?}");
        assert!(!asks.running(5));
    }

    #[test]
    fn key_echoed_in_an_error_is_replaced() {
        use std::io::{BufRead, BufReader, Read, Write};
        use std::net::TcpListener;
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/v1", l.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut len = 0usize;
            loop {
                let mut line = String::new();
                r.read_line(&mut line).unwrap();
                if line.trim().is_empty() {
                    break;
                }
                if let Some(v) = line.to_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap();
                }
            }
            let mut b = vec![0; len];
            r.read_exact(&mut b).unwrap();
            let body = r#"{"error":{"message":"Incorrect API key: sk-echoed-123"}}"#;
            let _ = write!(
                s,
                "HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
        });
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        config_set_in(dir.path(), &store, cfg(Provider::Compatible, Some(&base))).unwrap();
        key_set_in(dir.path(), &store, "sk-echoed-123").unwrap();
        let asks = Asks::default();
        let cancel = asks.start(1);
        let p = prepare_in(dir.path(), &store, "sys", &msgs()).unwrap();
        let mut out = Vec::new();
        answer(&asks, 1, &cancel, p, &mut |e| out.push(e));
        let host = base.trim_start_matches("http://").trim_end_matches("/v1");
        assert_eq!(
            out,
            vec![AskEvent::Error {
                message: format!("{host}: Incorrect API key: [key]")
            }]
        );
    }
}
