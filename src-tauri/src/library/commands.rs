//! Tauri commands on the Library. Every path the webview sends is checked
//! against the folder grant (`Grants::in_root`) on a blocking thread before
//! anything touches the disk; the root itself only ever comes from Rust.
//!
//! The command bodies are plain functions over `&Grants` so the checks are
//! testable without an app.

use super::{ops, root};
use crate::files::FileError;
use crate::files::commands::{blocking, path_string};
use crate::files::grants::{Grants, key, win32_alias};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RootState {
    /// The stored root, canonical when available; `null` if none was chosen.
    pub root: Option<String>,
    /// False when there is no root or its folder is missing or unreachable.
    pub available: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CopyResult {
    pub path: Option<String>,
    pub error: Option<FileError>,
}

/// What a new `.excalidraw` file holds: an empty scene.
const EMPTY_CANVAS: &str =
    r#"{"type":"excalidraw","version":2,"source":"zukai","elements":[],"appState":{},"files":{}}"#;

fn other(msg: &str) -> FileError {
    FileError::Io(std::io::Error::other(msg.to_owned()))
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, FileError> {
    crate::storage::data_dir(app).map_err(|e| other(&e.to_string()))
}

/// Grants the stored root if its folder is there. Never creates anything.
pub(crate) fn root_state(g: &Grants, data: &Path) -> RootState {
    let Some(stored) = root::load_root(data) else {
        return RootState {
            root: None,
            available: false,
        };
    };
    match g.set_root(&stored).and_then(|c| path_string(&c)) {
        Ok(root) => RootState {
            root: Some(root),
            available: true,
        },
        Err(_) => RootState {
            root: stored.to_str().map(str::to_owned),
            available: false,
        },
    }
}

/// Saves `dir` as the root and grants it. `dir` must be an existing folder.
pub(crate) fn use_root(g: &Grants, data: &Path, dir: &Path) -> Result<RootState, FileError> {
    if !dir.is_absolute() {
        return Err(FileError::NotGranted);
    }
    let canon = dunce::canonicalize(dir)?;
    if !canon.is_dir() {
        return Err(other("not a folder"));
    }
    root::save_root(data, &canon)?;
    let granted = g.set_root(&canon)?;
    Ok(RootState {
        root: Some(path_string(&granted)?),
        available: true,
    })
}

/// A folder inside the root (or the root itself).
fn folder(g: &Grants, p: &str) -> Result<PathBuf, FileError> {
    let dir = g.in_root(Path::new(p))?;
    if dir.is_dir() {
        Ok(dir)
    } else {
        Err(other("not a folder"))
    }
}

/// An existing item strictly inside the root, as the item itself: its folder
/// is resolved, but a link in the last place is the link, not its target, so
/// renaming, moving or trashing a link never touches what it points at. A
/// non-link is canonical (so its case matches the disk).
///
/// The resolved item must be exactly the one named: in the checked folder,
/// under the requested name (up to case where the file system ignores it).
/// That refuses every alias the OS would resolve elsewhere, above all one
/// for the root itself (`<root>\...` on Windows).
fn entry(g: &Grants, p: &str) -> Result<PathBuf, FileError> {
    let p = Path::new(p);
    let (Some(parent), Some(name)) = (p.parent(), p.file_name()) else {
        return Err(FileError::NotGranted);
    };
    if name == "." || name == ".." || win32_alias(Path::new(name)) {
        return Err(FileError::NotGranted);
    }
    let parent = g.in_root(parent)?;
    let path = parent.join(name);
    let meta = fs::symlink_metadata(&path)?;
    let item = if meta.file_type().is_symlink() {
        path
    } else {
        dunce::canonicalize(&path)?
    };
    let root = g.root().ok_or(FileError::NotGranted)?;
    let same_name = item
        .file_name()
        .is_some_and(|n| key(Path::new(n)) == key(Path::new(name)));
    if item == root || item.parent() != Some(parent.as_path()) || !same_name {
        return Err(FileError::NotGranted);
    }
    Ok(item)
}

pub(crate) fn list(g: &Grants, dir: &str) -> Result<Vec<ops::Entry>, FileError> {
    let dir = folder(g, dir)?;
    let root = g.root().ok_or(FileError::NotGranted)?;
    Ok(ops::list_dir(&dir, &root)?)
}

pub(crate) fn create_folder(g: &Grants, parent: &str, name: &str) -> Result<String, FileError> {
    path_string(&ops::create_folder(&folder(g, parent)?, name)?)
}

pub(crate) fn create_file(
    g: &Grants,
    parent: &str,
    stem: &str,
    ext: &str,
) -> Result<String, FileError> {
    let contents = if ext.eq_ignore_ascii_case("excalidraw") {
        EMPTY_CANVAS.as_bytes()
    } else {
        b""
    };
    path_string(&ops::create_file(&folder(g, parent)?, stem, ext, contents)?)
}

pub(crate) fn rename(g: &Grants, path: &str, new_name: &str) -> Result<String, FileError> {
    path_string(&ops::rename_entry(&entry(g, path)?, new_name)?)
}

pub(crate) fn move_to(g: &Grants, path: &str, dest_dir: &str) -> Result<String, FileError> {
    let src = entry(g, path)?;
    path_string(&ops::move_entry(&src, &folder(g, dest_dir)?)?)
}

/// Each source must already be granted (a File the user opened, or anything
/// in the Library); one that isn't fails alone.
pub(crate) fn copy_to(g: &Grants, srcs: &[String], dest_dir: &str) -> Vec<CopyResult> {
    let fail = |error| CopyResult {
        path: None,
        error: Some(error),
    };
    let dest = match folder(g, dest_dir) {
        Ok(dest) => dest,
        Err(e) => {
            return srcs.iter().map(|_| fail(e.clone())).collect();
        }
    };
    srcs.iter()
        .map(|src| {
            let copied = g.check(src).and_then(|src| {
                ops::copy_into(&[src], &dest)
                    .pop()
                    .unwrap_or_else(|| Err(other("nothing copied")))
            });
            match copied.and_then(|p| path_string(&p)) {
                Ok(path) => CopyResult {
                    path: Some(path),
                    error: None,
                },
                Err(e) => fail(e),
            }
        })
        .collect()
}

pub(crate) fn trash(g: &Grants, path: &str) -> Result<(), FileError> {
    ops::trash_entry(&entry(g, path)?)
}

/// What "Show in Explorer / Finder" may reveal: an item in the Library (a
/// link only if it points inside it), or the root itself.
pub(crate) fn reveal_target(g: &Grants, path: &str) -> Result<PathBuf, FileError> {
    match entry(g, path) {
        Ok(item) => {
            if fs::symlink_metadata(&item)?.file_type().is_symlink() {
                g.in_root(&item)?;
            }
            Ok(item)
        }
        Err(e) => {
            let target = g.in_root(Path::new(path))?;
            if Some(&target) == g.root().as_ref() {
                Ok(target)
            } else {
                Err(e)
            }
        }
    }
}

#[tauri::command]
pub async fn library_root(app: AppHandle) -> Result<RootState, FileError> {
    let handle = app.clone();
    blocking(app, move |g| Ok(root_state(g, &data_dir(&handle)?))).await
}

/// Creates `<Documents>/Zukai` if needed and makes it the root.
#[tauri::command]
pub async fn library_use_default(app: AppHandle) -> Result<RootState, FileError> {
    let handle = app.clone();
    blocking(app, move |g| {
        let data = data_dir(&handle)?;
        let dir = root::default_root().ok_or_else(|| other("no Documents folder"))?;
        fs::create_dir_all(&dir)?;
        use_root(g, &data, &dir)
    })
    .await
}

/// The native folder dialog. It only points Zukai at the chosen folder;
/// cancelling leaves the root as it was.
#[tauri::command]
pub async fn library_choose(app: AppHandle, window: WebviewWindow) -> Result<RootState, FileError> {
    let handle = app.clone();
    let dialog = window.dialog().file().set_parent(&window);
    blocking(app, move |g| {
        let data = data_dir(&handle)?;
        match dialog.blocking_pick_folder() {
            Some(picked) => {
                let dir = picked.into_path().map_err(|e| other(&e.to_string()))?;
                use_root(g, &data, &dir)
            }
            None => Ok(root_state(g, &data)),
        }
    })
    .await
}

#[tauri::command]
pub async fn library_list(app: AppHandle, dir: String) -> Result<Vec<ops::Entry>, FileError> {
    blocking(app, move |g| list(g, &dir)).await
}

#[tauri::command]
pub async fn library_create_folder(
    app: AppHandle,
    parent: String,
    name: String,
) -> Result<String, FileError> {
    blocking(app, move |g| create_folder(g, &parent, &name)).await
}

#[tauri::command]
pub async fn library_create_file(
    app: AppHandle,
    parent: String,
    stem: String,
    ext: String,
) -> Result<String, FileError> {
    blocking(app, move |g| create_file(g, &parent, &stem, &ext)).await
}

#[tauri::command]
pub async fn library_rename(
    app: AppHandle,
    path: String,
    new_name: String,
) -> Result<String, FileError> {
    blocking(app, move |g| rename(g, &path, &new_name)).await
}

#[tauri::command]
pub async fn library_move(
    app: AppHandle,
    path: String,
    dest_dir: String,
) -> Result<String, FileError> {
    blocking(app, move |g| move_to(g, &path, &dest_dir)).await
}

#[tauri::command]
pub async fn library_copy_into(
    app: AppHandle,
    srcs: Vec<String>,
    dest_dir: String,
) -> Result<Vec<CopyResult>, FileError> {
    blocking(app, move |g| Ok(copy_to(g, &srcs, &dest_dir))).await
}

#[tauri::command]
pub async fn library_trash(app: AppHandle, path: String) -> Result<(), FileError> {
    blocking(app, move |g| trash(g, &path)).await
}

/// Reveals from Rust: the webview has no `opener:*` permission.
#[tauri::command]
pub async fn library_reveal(app: AppHandle, path: String) -> Result<(), FileError> {
    blocking(app, move |g| {
        let target = reveal_target(g, &path)?;
        tauri_plugin_opener::reveal_item_in_dir(&target).map_err(|e| other(&e.to_string()))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::library;

    fn s(p: &Path) -> &str {
        p.to_str().unwrap()
    }

    #[test]
    fn move_dest_outside_root_refused() {
        let (_tmp, g, root, outside) = library();
        let a = root.join("a.md");
        fs::write(&a, "a").unwrap();
        assert!(matches!(
            move_to(&g, s(&a), s(&outside)),
            Err(FileError::NotGranted)
        ));
        assert!(matches!(
            move_to(&g, s(&a), s(&root.join("..").join("outside"))),
            Err(FileError::NotGranted)
        ));
        assert!(a.exists());
        // Nor can anything outside be pulled in, or the root itself moved.
        let secret = outside.join("secret.md");
        fs::write(&secret, "s").unwrap();
        fs::create_dir(root.join("dest")).unwrap();
        let dest = root.join("dest");
        assert!(matches!(
            move_to(&g, s(&secret), s(&dest)),
            Err(FileError::NotGranted)
        ));
        assert!(matches!(
            move_to(&g, s(&root), s(&dest)),
            Err(FileError::NotGranted)
        ));
        assert!(secret.exists());
        // Inside to inside works.
        assert_eq!(move_to(&g, s(&a), s(&dest)).unwrap(), s(&dest.join("a.md")));
    }

    #[test]
    fn commands_stay_inside_the_root() {
        let (_tmp, g, root, outside) = library();
        let secret = outside.join("secret.md");
        fs::write(&secret, "s").unwrap();
        let no = |r: Result<String, FileError>| matches!(r, Err(FileError::NotGranted));

        assert!(matches!(list(&g, s(&outside)), Err(FileError::NotGranted)));
        assert!(no(create_folder(&g, s(&outside), "x")));
        assert!(no(create_file(&g, s(&outside), "x", "md")));
        assert!(no(rename(&g, s(&secret), "y")));
        assert!(no(rename(&g, s(&root), "y")));
        assert!(matches!(trash(&g, s(&secret)), Err(FileError::NotGranted)));
        assert!(matches!(trash(&g, s(&root)), Err(FileError::NotGranted)));
        assert!(matches!(
            reveal_target(&g, s(&secret)),
            Err(FileError::NotGranted)
        ));
        assert_eq!(reveal_target(&g, s(&root)).unwrap(), root);
        assert!(secret.exists());

        // Copying in needs a granted source.
        let out = copy_to(&g, &[s(&secret).to_owned()], s(&root));
        assert!(matches!(out[0].error, Some(FileError::NotGranted)));
        g.grant(&secret).unwrap();
        let out = copy_to(&g, &[s(&secret).to_owned()], s(&root));
        assert_eq!(out[0].path.as_deref(), Some(s(&root.join("secret.md"))));
        let out = copy_to(&g, &[s(&secret).to_owned()], s(&outside));
        assert!(matches!(out[0].error, Some(FileError::NotGranted)));
        assert_eq!(
            serde_json::to_value(&out[0]).unwrap()["error"]["kind"],
            "not_granted"
        );
        assert!(!outside.join("secret (2).md").exists());
    }

    /// Win32 drops trailing dots and spaces, so `<root>\...` is the root
    /// itself and `<root>\sub.` is `sub`: none of these may name an item.
    #[cfg(windows)]
    #[test]
    fn root_aliases_are_refused_on_windows() {
        let (_tmp, g, root, outside) = library();
        let sub = root.join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("a.md"), "a").unwrap();
        let r = s(&root).to_owned();
        let sub_str = s(&sub).to_owned();
        for alias in ["...", ". ", ".. ", "....", "  ", " ", "."] {
            let p = format!(r"{r}\{alias}");
            assert!(trash(&g, &p).is_err(), "trash {alias:?}");
            assert!(rename(&g, &p, "renamed").is_err(), "rename {alias:?}");
            assert!(move_to(&g, &p, &sub_str).is_err(), "move {alias:?}");
            assert!(move_to(&g, &p, s(&outside)).is_err(), "move {alias:?}");
            if alias == "." {
                // `<root>\.` is the root in plain spelling: revealing it is fine.
                assert_eq!(reveal_target(&g, &p).unwrap(), root);
            } else {
                assert!(reveal_target(&g, &p).is_err(), "reveal {alias:?}");
            }
        }
        for alias in ["sub.", "sub ", "sub. .", "SUB."] {
            let p = format!(r"{r}\{alias}");
            let refused =
                |res: Result<String, FileError>| matches!(res, Err(FileError::NotGranted));
            assert!(
                matches!(trash(&g, &p), Err(FileError::NotGranted)),
                "{alias:?}"
            );
            assert!(refused(rename(&g, &p, "x")), "{alias:?}");
            assert!(refused(move_to(&g, &p, &r)), "{alias:?}");
            assert!(
                matches!(list(&g, &p), Err(FileError::NotGranted)),
                "{alias:?}"
            );
            assert!(refused(create_file(&g, &p, "n", "md")), "{alias:?}");
            assert!(refused(create_folder(&g, &p, "n")), "{alias:?}");
            let out = copy_to(&g, &[format!(r"{sub_str}\a.md")], &p);
            assert!(
                matches!(out[0].error, Some(FileError::NotGranted)),
                "{alias:?}"
            );
            let a = format!(r"{p}\a.md");
            assert!(
                matches!(trash(&g, &a), Err(FileError::NotGranted)),
                "{alias:?}"
            );
        }
        assert!(root.is_dir());
        assert!(sub.join("a.md").is_file());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn reveal_refuses_links_that_point_outside() {
        use std::os::unix::fs::symlink;
        let (_tmp, g, root, outside) = library();
        symlink(&outside, root.join("out")).unwrap();
        assert!(reveal_target(&g, s(&root.join("out"))).is_err());
        fs::create_dir(root.join("real")).unwrap();
        symlink(root.join("real"), root.join("in")).unwrap();
        assert!(reveal_target(&g, s(&root.join("in"))).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn reveal_refuses_junctions_that_point_outside() {
        use crate::library::tests::junction;
        let (_tmp, g, root, outside) = library();
        junction(&root.join("out"), &outside);
        assert!(reveal_target(&g, s(&root.join("out"))).is_err());
        fs::create_dir(root.join("real")).unwrap();
        junction(&root.join("in"), &root.join("real"));
        assert!(reveal_target(&g, s(&root.join("in"))).is_ok());
    }

    #[test]
    fn root_commands_round_trip() {
        let (_tmp, g, root, outside) = library();
        let data = tempfile::tempdir().unwrap();
        let fresh = Grants::default();
        assert_eq!(
            root_state(&fresh, data.path()),
            RootState {
                root: None,
                available: false
            }
        );
        let state = use_root(&fresh, data.path(), &root).unwrap();
        assert_eq!(state.root.as_deref(), Some(s(&root)));
        assert!(state.available);

        // A later launch grants the stored root again.
        let next = Grants::default();
        assert_eq!(root_state(&next, data.path()), state);
        assert!(next.in_root(&root.join("a.md")).is_ok());

        // A vanished root is reported, not recreated.
        let gone = outside.join("gone");
        fs::create_dir(&gone).unwrap();
        use_root(&g, data.path(), &gone).unwrap();
        fs::remove_dir(&gone).unwrap();
        let state = root_state(&Grants::default(), data.path());
        assert_eq!(state.root.as_deref(), Some(s(&gone)));
        assert!(!state.available);
        assert!(!gone.exists());
    }

    #[test]
    fn new_canvas_file_holds_an_empty_scene() {
        let (_tmp, g, root, _outside) = library();
        let p = create_file(&g, s(&root), "Untitled", "excalidraw").unwrap();
        let v: serde_json::Value = serde_json::from_slice(&fs::read(&p).unwrap()).unwrap();
        assert_eq!(v["type"], "excalidraw");
        let note = create_file(&g, s(&root), "Untitled", "md").unwrap();
        assert_eq!(fs::read(&note).unwrap(), b"");
    }
}
