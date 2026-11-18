//! Tauri commands on user Files. Every path the webview sends must already be
//! in the `Grants` allowlist; only the dialogs (shown from Rust) add to it here.
//!
//! Grant checks canonicalize paths, so they run inside `blocking` with the
//! rest of the file work: a slow or unreachable path never stalls the async
//! runtime, and the grants lock is never held across a file system call.

use super::FileError;
use super::encoding::FileFormat;
use super::fingerprint::{self, Fingerprint};
use super::grants::{self, Grants};
use super::io::{self, FileRead, WriteOutcome};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FilePath};

/// Runs blocking file work, with the allowlist, off the async runtime.
pub(crate) async fn blocking<T, F>(app: AppHandle, f: F) -> Result<T, FileError>
where
    T: Send + 'static,
    F: FnOnce(&Grants) -> Result<T, FileError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || f(&app.state::<Grants>()))
        .await
        .map_err(|e| FileError::Io(std::io::Error::other(e)))?
}

/// Paths cross to the webview as strings; one that isn't UTF-8 can't round-trip.
pub(crate) fn path_string(p: &Path) -> Result<String, FileError> {
    p.to_str()
        .map(str::to_owned)
        .ok_or_else(|| FileError::Io(std::io::Error::other("path is not valid UTF-8")))
}

fn dialog_path(p: FilePath) -> Result<PathBuf, FileError> {
    p.into_path()
        .map_err(|e| FileError::Io(std::io::Error::other(e.to_string())))
}

/// Grants a path the user chose in a dialog and returns its canonical string.
fn grant_picked(grants: &Grants, p: FilePath) -> Result<String, FileError> {
    path_string(&grants.grant(&dialog_path(p)?)?)
}

#[tauri::command]
pub async fn file_read(app: AppHandle, path: String) -> Result<FileRead, FileError> {
    blocking(app, move |g| io::read_file(&g.check(&path)?)).await
}

#[tauri::command]
pub async fn file_reread_as(
    app: AppHandle,
    path: String,
    encoding: String,
) -> Result<FileRead, FileError> {
    blocking(app, move |g| io::reread_as(&g.check(&path)?, &encoding)).await
}

#[tauri::command]
pub async fn file_write(
    app: AppHandle,
    path: String,
    text: String,
    format: FileFormat,
    expected: Fingerprint,
) -> Result<WriteOutcome, FileError> {
    blocking(app, move |g| {
        io::write_file(&g.check(&path)?, &text, &format, &expected)
    })
    .await
}

/// `path` must have been granted by `file_pick_save`.
#[tauri::command]
pub async fn file_save_as(
    app: AppHandle,
    path: String,
    text: String,
    format: FileFormat,
) -> Result<WriteOutcome, FileError> {
    blocking(app, move |g| io::save_as(&g.check(&path)?, &text, &format)).await
}

/// Returns the new canonical path, which is granted. The old path stays
/// granted: the user opened it, and a Session saved before the UI catches up
/// may still name it.
#[tauri::command]
pub async fn file_rename(
    app: AppHandle,
    path: String,
    new_stem: String,
) -> Result<String, FileError> {
    blocking(app, move |g| {
        let renamed = io::rename_no_replace(&g.check(&path)?, &new_stem)?;
        path_string(&g.grant(&renamed)?)
    })
    .await
}

/// Over `MAX_OPEN_BYTES` the file isn't read: the fingerprint has the real
/// mtime and size and an empty hash, which never matches (always "changed").
#[tauri::command]
pub async fn file_fingerprint(
    app: AppHandle,
    path: String,
) -> Result<Option<Fingerprint>, FileError> {
    blocking(app, move |g| {
        Ok(fingerprint::fingerprint_of(&g.check(&path)?)?)
    })
    .await
}

/// Like `file_fingerprint`, for re-checks: `expected` unchanged (no hash)
/// when the file's mtime and size still match it. Writes never use this.
#[tauri::command]
pub async fn file_fingerprint_quick(
    app: AppHandle,
    path: String,
    expected: Fingerprint,
) -> Result<Option<Fingerprint>, FileError> {
    blocking(app, move |g| {
        Ok(fingerprint::fingerprint_quick(&g.check(&path)?, &expected)?)
    })
    .await
}

/// The OS open dialog (multi-select). Grants and returns the chosen Files'
/// canonical paths; cancelling returns none. A pick that can't be granted
/// (a folder, a non-UTF-8 path) is skipped rather than failing the rest.
#[tauri::command]
pub async fn file_pick_open(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<String>, FileError> {
    let dialog = window.dialog().file().set_parent(&window);
    blocking(app, move |g| {
        let picked = dialog.blocking_pick_files().unwrap_or_default();
        Ok(picked
            .into_iter()
            .filter_map(|p| grant_picked(g, p).ok())
            .collect())
    })
    .await
}

/// The one file type a save dialog offers (a Canvas: `.excalidraw`).
#[derive(Debug, serde::Deserialize)]
pub struct SaveFilter {
    name: String,
    extensions: Vec<String>,
}

/// Plain extensions only (letters and digits), so the filter can't be abused
/// to smuggle a pattern into the dialog.
fn plain_extensions(f: &SaveFilter) -> Vec<&str> {
    f.extensions
        .iter()
        .map(String::as_str)
        .filter(|e| !e.is_empty() && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .collect()
}

/// The OS save dialog (which confirms any overwrite). Grants and returns the
/// chosen path, or `None` if cancelled.
#[tauri::command]
pub async fn file_pick_save(
    app: AppHandle,
    window: WebviewWindow,
    suggested_name: String,
    directory: Option<String>,
    filter: Option<SaveFilter>,
) -> Result<Option<String>, FileError> {
    let mut dialog = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_file_name(suggested_name);
    if let Some(f) = &filter {
        let exts = plain_extensions(f);
        if !exts.is_empty() {
            dialog = dialog.add_filter(&f.name, &exts);
        }
    }
    // Only where the dialog starts: the user still picks, and the pick is
    // what gets granted.
    if let Some(dir) = directory.filter(|d| Path::new(d).is_absolute()) {
        dialog = dialog.set_directory(dir);
    }
    blocking(app, move |g| {
        dialog
            .blocking_save_file()
            .map(|p| grant_picked(g, p))
            .transpose()
    })
    .await
}

/// The Session File paths that are granted under exactly that spelling.
/// `session_read` keeps paths it couldn't grant; the UI drops those so that
/// `session_write` accepts the Session it saves back.
#[tauri::command]
pub async fn grants_filter(app: AppHandle, paths: Vec<String>) -> Result<Vec<String>, FileError> {
    blocking(app, move |g| Ok(grants::filter_exact(g, paths))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_filter_keeps_plain_extensions_only() {
        let f = SaveFilter {
            name: "Drawing".into(),
            extensions: vec![
                "excalidraw".into(),
                "*".into(),
                "".into(),
                "a.b".into(),
                "png2".into(),
            ],
        };
        assert_eq!(plain_extensions(&f), vec!["excalidraw", "png2"]);
    }
}
