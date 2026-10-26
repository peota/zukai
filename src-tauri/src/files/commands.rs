//! Tauri commands on user Files. Every path the webview sends must already be
//! in the `Grants` allowlist; only the dialogs (shown from Rust) add to it here.

use super::FileError;
use super::encoding::FileFormat;
use super::fingerprint::{self, Fingerprint};
use super::grants::Grants;
use super::io::{self, FileRead, WriteOutcome};
use std::path::{Path, PathBuf};
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};

/// Runs blocking file work off the async runtime.
async fn blocking<T, F>(f: F) -> Result<T, FileError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, FileError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| FileError::Io(std::io::Error::other(e)))?
}

/// Paths cross to the webview as strings; one that isn't UTF-8 can't round-trip.
fn path_string(p: &Path) -> Result<String, FileError> {
    p.to_str()
        .map(str::to_owned)
        .ok_or_else(|| FileError::Io(std::io::Error::other("path is not valid UTF-8")))
}

fn dialog_path(p: FilePath) -> Result<PathBuf, FileError> {
    p.into_path()
        .map_err(|e| FileError::Io(std::io::Error::other(e.to_string())))
}

#[tauri::command]
pub async fn file_read(grants: State<'_, Grants>, path: String) -> Result<FileRead, FileError> {
    let p = grants.check(&path)?;
    blocking(move || io::read_file(&p)).await
}

#[tauri::command]
pub async fn file_reread_as(
    grants: State<'_, Grants>,
    path: String,
    encoding: String,
) -> Result<FileRead, FileError> {
    let p = grants.check(&path)?;
    blocking(move || io::reread_as(&p, &encoding)).await
}

#[tauri::command]
pub async fn file_write(
    grants: State<'_, Grants>,
    path: String,
    text: String,
    format: FileFormat,
    expected: Fingerprint,
) -> Result<WriteOutcome, FileError> {
    let p = grants.check(&path)?;
    blocking(move || io::write_file(&p, &text, &format, &expected)).await
}

/// `path` must have been granted by `file_pick_save`.
#[tauri::command]
pub async fn file_save_as(
    grants: State<'_, Grants>,
    path: String,
    text: String,
    format: FileFormat,
) -> Result<WriteOutcome, FileError> {
    let p = grants.check(&path)?;
    blocking(move || io::save_as(&p, &text, &format)).await
}

/// Returns the new canonical path, which is granted. The old path stays
/// granted: the user opened it, and a Session saved before the UI catches up
/// may still name it.
#[tauri::command]
pub async fn file_rename(
    grants: State<'_, Grants>,
    path: String,
    new_stem: String,
) -> Result<String, FileError> {
    let p = grants.check(&path)?;
    let renamed = blocking(move || io::rename_no_replace(&p, &new_stem)).await?;
    path_string(&grants.grant(&renamed)?)
}

#[tauri::command]
pub async fn file_fingerprint(
    grants: State<'_, Grants>,
    path: String,
) -> Result<Option<Fingerprint>, FileError> {
    let p = grants.check(&path)?;
    blocking(move || Ok(fingerprint::fingerprint_of(&p)?)).await
}

/// The OS open dialog (multi-select). Grants and returns the chosen Files'
/// canonical paths; cancelling returns none.
#[tauri::command]
pub async fn file_pick_open(
    window: WebviewWindow,
    grants: State<'_, Grants>,
) -> Result<Vec<String>, FileError> {
    let dialog = window.dialog().file().set_parent(&window);
    let picked = blocking(move || Ok(dialog.blocking_pick_files())).await?;
    let mut paths = Vec::new();
    for p in picked.unwrap_or_default() {
        paths.push(path_string(&grants.grant(&dialog_path(p)?)?)?);
    }
    Ok(paths)
}

/// The OS save dialog (which confirms any overwrite). Grants and returns the
/// chosen path, or `None` if cancelled.
#[tauri::command]
pub async fn file_pick_save(
    window: WebviewWindow,
    grants: State<'_, Grants>,
    suggested_name: String,
) -> Result<Option<String>, FileError> {
    let dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_file_name(suggested_name);
    let Some(picked) = blocking(move || Ok(dialog.blocking_save_file())).await? else {
        return Ok(None);
    };
    Ok(Some(path_string(&grants.grant(&dialog_path(picked)?)?)?))
}
