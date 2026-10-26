use crate::files::grants::{self, Grants};
use crate::storage::{self, Result, StorageError, scratchpads, session, shadow};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

async fn blocking<T, F>(app: AppHandle, f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(PathBuf) -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || f(storage::data_dir(&app)?))
        .await
        .map_err(|e| StorageError::Io(std::io::Error::other(e)))?
}

#[tauri::command]
pub async fn scratchpad_read(app: AppHandle, id: String) -> Result<String> {
    storage::validate_id(&id)?;
    blocking(app, move |b| scratchpads::read(&b, &id)).await
}

#[tauri::command]
pub async fn scratchpad_write(app: AppHandle, id: String, content: String) -> Result<()> {
    storage::validate_id(&id)?;
    blocking(app, move |b| scratchpads::write(&b, &id, &content)).await
}

#[tauri::command]
pub async fn scratchpad_delete(app: AppHandle, id: String) -> Result<()> {
    storage::validate_id(&id)?;
    blocking(app, move |b| scratchpads::delete(&b, &id)).await
}

#[tauri::command]
pub async fn scratchpad_close(app: AppHandle, id: String) -> Result<()> {
    storage::validate_id(&id)?;
    blocking(app, move |b| scratchpads::close(&b, &id)).await
}

#[tauri::command]
pub async fn scratchpad_reopen(app: AppHandle, id: String) -> Result<()> {
    storage::validate_id(&id)?;
    blocking(app, move |b| scratchpads::reopen(&b, &id)).await
}

#[tauri::command]
pub async fn scratchpad_list(app: AppHandle) -> Result<Vec<String>> {
    blocking(app, |b| scratchpads::list(&b)).await
}

#[tauri::command]
pub async fn scratchpad_list_closed(app: AppHandle) -> Result<Vec<scratchpads::ClosedFile>> {
    blocking(app, |b| scratchpads::list_closed(&b)).await
}

#[tauri::command]
pub async fn scratchpad_purge_closed(app: AppHandle, ids: Vec<String>) -> Result<()> {
    for id in &ids {
        storage::validate_id(id)?;
    }
    blocking(app, move |b| scratchpads::purge_closed(&b, &ids)).await
}

/// Grants every File path in the Session before the UI sees it: the Session
/// on disk is one of the Rust-side sources of grants. A path that can't be
/// granted (now a folder, say) is skipped; the UI finds out when it opens it.
#[tauri::command]
pub async fn session_read(app: AppHandle) -> Result<Option<String>> {
    let handle = app.clone();
    blocking(app, move |b| {
        let json = session::read(&b)?;
        if let Some(json) = &json {
            let grants = handle.state::<Grants>();
            for path in grants::extract_file_paths(json) {
                let _ = grants.grant(Path::new(&path));
            }
        }
        Ok(json)
    })
    .await
}

/// Refuses a Session naming a File that isn't granted, so the webview can't
/// grant itself paths through the next launch.
#[tauri::command]
pub async fn session_write(app: AppHandle, json: String) -> Result<()> {
    let handle = app.clone();
    blocking(app, move |b| {
        grants::check_session(&handle.state::<Grants>(), &json)
            .map_err(|_| StorageError::NotGranted)?;
        session::write(&b, &json)
    })
    .await
}

#[tauri::command]
pub async fn session_backup(app: AppHandle) -> Result<()> {
    blocking(app, |b| session::backup(&b)).await
}

#[tauri::command]
pub async fn shadow_write(app: AppHandle, id: String, text: String) -> Result<()> {
    blocking(app, move |b| shadow::write(&b, &id, &text)).await
}

#[tauri::command]
pub async fn shadow_read(app: AppHandle, id: String) -> Result<Option<String>> {
    blocking(app, move |b| shadow::read(&b, &id)).await
}

#[tauri::command]
pub async fn shadow_delete(app: AppHandle, id: String) -> Result<()> {
    blocking(app, move |b| shadow::delete(&b, &id)).await
}

#[tauri::command]
pub async fn shadow_list(app: AppHandle) -> Result<Vec<String>> {
    blocking(app, |b| shadow::list(&b)).await
}
