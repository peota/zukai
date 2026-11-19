//! Tauri commands on user Files. Every path the webview sends must already be
//! in the `Grants` allowlist; only the dialogs (shown from Rust) add to it here.
//!
//! Grant checks canonicalize paths, so they run inside `blocking` with the
//! rest of the file work: a slow or unreachable path never stalls the async
//! runtime, and the grants lock is never held across a file system call.

use super::FileError;
use super::encoding::FileFormat;
use super::exec;
use super::fingerprint::{self, Fingerprint};
use super::grants::{self, Grants};
use super::io::{self, FileRead, WriteOutcome};
use std::path::{Path, PathBuf};
use tauri::ipc::Response;
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

/// Renames a File to a Language's extension (`note.md` → `note.ts`).
#[tauri::command]
pub async fn file_change_extension(
    app: AppHandle,
    path: String,
    ext: String,
) -> Result<String, FileError> {
    blocking(app, move |g| {
        let renamed = io::change_extension(&g.check(&path)?, &ext)?;
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

/// A granted File's raw bytes (an Image), at most `MAX_OPEN_BYTES`.
pub(crate) fn read_bytes_checked(g: &Grants, path: &str) -> Result<Vec<u8>, FileError> {
    Ok(io::read_bytes(&g.check(path)?)?.0)
}

/// Raw bytes, not JSON: an `ArrayBuffer` in the webview.
#[tauri::command]
pub async fn file_read_bytes(app: AppHandle, path: String) -> Result<Response, FileError> {
    blocking(app, move |g| {
        Ok(Response::new(read_bytes_checked(g, &path)?))
    })
    .await
}

fn is_link(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink())
}

/// What `open_default` may hand to the OS: the granted regular File `path`
/// names, or `None` if it would run something (see `exec`). A link (as the path given or
/// as what it was granted as) is never followed, and a folder never opened.
pub(crate) fn open_target(g: &Grants, path: &str) -> Result<Option<PathBuf>, FileError> {
    let target = g.check(path)?;
    if is_link(Path::new(path)) || is_link(&target) {
        return Err(FileError::NotGranted);
    }
    if !std::fs::metadata(&target)?.is_file() {
        return Err(FileError::NotAFile);
    }
    if exec::exec_name(Path::new(path)) || exec::executable(&target) {
        return Ok(None);
    }
    Ok(Some(target))
}

#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OpenOutcome {
    Opened,
    RefusedExec,
}

/// Opens a granted File in its default app, from Rust: the webview has no
/// `opener:*` permission. Only the explicit button calls this.
#[tauri::command]
pub async fn open_default(app: AppHandle, path: String) -> Result<OpenOutcome, FileError> {
    blocking(app, move |g| {
        let Some(target) = open_target(g, &path)? else {
            return Ok(OpenOutcome::RefusedExec);
        };
        tauri_plugin_opener::open_path(&target, None::<&str>)
            .map_err(|e| FileError::Io(std::io::Error::other(e.to_string())))?;
        Ok(OpenOutcome::Opened)
    })
    .await
}

/// True for a link the Markdown preview may hand to the browser: an
/// `http(s)://` or `mailto:` URL of printable characters, nothing else (no
/// `file:`, `javascript:` or app-specific scheme).
fn web_link(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    let scheme_ok = ["http://", "https://", "mailto:"]
        .iter()
        .any(|s| lower.starts_with(s) && lower.len() > s.len());
    scheme_ok && url.len() <= 2048 && !url.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// Opens a web or mail link from the Markdown preview in the default browser
/// or mail app. Anything else is refused.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), FileError> {
    if !web_link(&url) {
        return Err(FileError::InvalidName);
    }
    tauri_plugin_opener::open_url(&url, None::<&str>)
        .map_err(|e| FileError::Io(std::io::Error::other(e.to_string())))
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
    fn web_link_takes_only_http_https_and_mailto() {
        for ok in [
            "https://zukai.app/docs?a=1#x",
            "HTTP://example.com",
            "mailto:someone@example.com",
        ] {
            assert!(web_link(ok), "{ok}");
        }
        for bad in [
            "javascript:alert(1)",
            "file:///C:/Windows/System32/calc.exe",
            "C:\\Windows\\notepad.exe",
            "ms-settings:privacy",
            "https://",
            "https://a b",
            "https://a\nb",
            "",
        ] {
            assert!(!web_link(bad), "{bad:?} must be refused");
        }
        assert!(!web_link(&format!("https://{}", "a".repeat(3000))));
    }

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

    use crate::files::io::MAX_OPEN_BYTES;
    use crate::library::tests::library;
    use std::fs;

    fn s(p: &Path) -> &str {
        p.to_str().unwrap()
    }

    #[test]
    fn open_default_refuses_exec_extensions() {
        let (_tmp, g, root, outside) = library();
        for name in [
            "a.exe",
            "b.COM",
            "c.msi",
            "d.Bat",
            "e.cmd",
            "f.ps1",
            "g.vbs",
            "h.lnk",
            "i.app",
            "j.desktop",
            "k.sh",
            "l.command",
            // Beyond the spec's floor: what Windows, macOS and Linux also run.
            "m.scr",
            "n.PIF",
            "o.cpl",
            "p.jar",
            "q.hta",
            "r.js",
            "s.wsf",
            "t.reg",
            "u.url",
            "v.appref-ms",
            "w.py",
            "x.pkg",
            "y.AppImage",
            "z.run",
        ] {
            let p = root.join(name);
            fs::write(&p, "x").unwrap();
            assert!(
                matches!(open_target(&g, s(&p)), Ok(None)),
                "{name} must be refused"
            );
        }
        // Windows drops trailing dots and spaces: such a spelling is an alias
        // there (refused by the grants); elsewhere it is still executable.
        let dotted = format!("{}.", s(&root.join("dot.exe")));
        fs::write(&dotted, "x").unwrap();
        #[cfg(windows)]
        assert!(matches!(
            open_target(&g, &dotted),
            Err(FileError::NotGranted)
        ));
        #[cfg(unix)]
        assert!(matches!(open_target(&g, &dotted), Ok(None)));

        let pdf = root.join("doc.pdf");
        fs::write(&pdf, "%PDF").unwrap();
        assert_eq!(open_target(&g, s(&pdf)).unwrap(), Some(pdf.clone()));
        // A folder is never opened.
        fs::create_dir(root.join("dir")).unwrap();
        assert!(matches!(
            open_target(&g, s(&root.join("dir"))),
            Err(FileError::NotAFile)
        ));
        // Outside the Library and not granted.
        let secret = outside.join("secret.pdf");
        fs::write(&secret, "s").unwrap();
        assert!(matches!(
            open_target(&g, s(&secret)),
            Err(FileError::NotGranted)
        ));
        // A File the user opened from a dialog is granted exactly.
        g.grant(&secret).unwrap();
        assert_eq!(open_target(&g, s(&secret)).unwrap(), Some(secret.clone()));
    }

    /// A folder link as the path is never opened, even one that stays in the
    /// Library.
    #[test]
    fn open_default_refuses_folder_links() {
        let (_tmp, g, root, _outside) = library();
        // A folder link that stays in the Library (a junction on Windows).
        fs::create_dir(root.join("sub")).unwrap();
        let dir_link = root.join("dir-link");
        #[cfg(windows)]
        crate::library::tests::junction(&dir_link, &root.join("sub"));
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("sub"), &dir_link).unwrap();
        assert!(matches!(
            open_target(&g, s(&dir_link)),
            Err(FileError::NotGranted)
        ));
    }

    /// A file link as the last part of the path is never opened, whether it
    /// stays in the Library or leads out.
    #[test]
    #[cfg_attr(
        windows,
        ignore = "file symlinks need Developer Mode or elevation on Windows"
    )]
    fn open_default_refuses_file_links() {
        let (_tmp, g, root, outside) = library();
        let target = root.join("real.pdf");
        fs::write(&target, "x").unwrap();
        fs::write(outside.join("out.pdf"), "o").unwrap();
        let link = root.join("link.pdf");
        let out_link = root.join("out-link.pdf");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&target, &link).unwrap();
            std::os::unix::fs::symlink(outside.join("out.pdf"), &out_link).unwrap();
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_file(&target, &link).unwrap();
            std::os::windows::fs::symlink_file(outside.join("out.pdf"), &out_link).unwrap();
        }
        assert!(matches!(
            open_target(&g, s(&link)),
            Err(FileError::NotGranted)
        ));
        assert!(matches!(
            open_target(&g, s(&out_link)),
            Err(FileError::NotGranted)
        ));
    }

    /// On Unix an execute bit means the desktop may run it: refused,
    /// whatever its name.
    #[cfg(unix)]
    #[test]
    fn open_default_refuses_executable_bit() {
        use std::os::unix::fs::PermissionsExt;
        let (_tmp, g, root, _outside) = library();
        let tool = root.join("tool");
        fs::write(
            &tool,
            "#!/bin/sh
",
        )
        .unwrap();
        fs::set_permissions(&tool, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(matches!(open_target(&g, s(&tool)), Ok(None)));
        let notes = root.join("notes.txt");
        fs::write(&notes, "n").unwrap();
        fs::set_permissions(&notes, fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(open_target(&g, s(&notes)).unwrap(), Some(notes.clone()));
    }

    #[test]
    fn read_bytes_requires_grant_and_cap() {
        let (_tmp, g, root, outside) = library();
        let png = root.join("pic.png");
        fs::write(&png, [0x89, b'P', b'N', b'G', 0, 1, 2]).unwrap();
        assert_eq!(
            read_bytes_checked(&g, s(&png)).unwrap(),
            vec![0x89, b'P', b'N', b'G', 0, 1, 2]
        );

        let out = outside.join("pic.png");
        fs::write(&out, "o").unwrap();
        assert!(matches!(
            read_bytes_checked(&g, s(&out)),
            Err(FileError::NotGranted)
        ));
        assert!(matches!(
            read_bytes_checked(&g, "pic.png"),
            Err(FileError::NotGranted)
        ));
        g.grant(&out).unwrap();
        assert_eq!(read_bytes_checked(&g, s(&out)).unwrap(), b"o");

        let big = root.join("big.png");
        fs::File::create(&big)
            .unwrap()
            .set_len(MAX_OPEN_BYTES + 1)
            .unwrap();
        assert!(matches!(
            read_bytes_checked(&g, s(&big)),
            Err(FileError::TooLarge)
        ));
        assert!(matches!(
            read_bytes_checked(&g, s(&root)),
            Err(FileError::NotAFile)
        ));
    }

    #[test]
    fn open_outcome_serializes_kind() {
        let v = serde_json::to_value(OpenOutcome::RefusedExec).unwrap();
        assert_eq!(v["kind"], "refused_exec");
        let v = serde_json::to_value(OpenOutcome::Opened).unwrap();
        assert_eq!(v["kind"], "opened");
    }
}
