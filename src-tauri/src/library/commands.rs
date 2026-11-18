//! Tauri commands on the Library. Every path the webview sends is checked
//! against the folder grant (`Grants::in_root`) on a blocking thread before
//! anything touches the disk; the root itself only ever comes from Rust.
//!
//! The command bodies are plain functions over `&Grants` so the checks are
//! testable without an app.

use super::index::{NameIndex, SEARCH_LIMIT, SearchResult};
use super::watch::{LIBRARY_CHANGED_EVENT, LibraryWatcher, Sink};
use super::{ops, root};
use crate::files::FileError;
use crate::files::commands::{blocking, path_string};
use crate::files::grants::{Grants, key, win32_alias};
use crate::files::watch::{Watcher as FileWatcher, app_sink as file_sink};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
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

/// Grants the stored root if its folder is there and it still leads to the
/// folder that was chosen (not a link put in its place). Never creates
/// anything.
pub(crate) fn root_state(g: &Grants, data: &Path) -> RootState {
    let Some(stored) = root::load_root(data) else {
        return RootState {
            root: None,
            available: false,
        };
    };
    match g.load_root(&stored).and_then(|c| path_string(&c)) {
        Ok(root) => RootState {
            root: Some(root),
            available: true,
        },
        Err(_) => {
            // Unavailable: its paths still count as Library paths.
            g.set_root_hint(&stored);
            RootState {
                root: stored.to_str().map(str::to_owned),
                available: false,
            }
        }
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

/// "Create it again": makes the stored root's folder again (it was deleted
/// or renamed) and grants it. Only the path Rust stored is ever created.
pub(crate) fn recreate_root(g: &Grants, data: &Path) -> Result<RootState, FileError> {
    let stored = root::load_root(data).ok_or_else(|| other("no Library folder chosen"))?;
    fs::create_dir_all(&stored)?;
    use_root(g, data, &stored)
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

/// `entry`, but not a link that resolves outside the root (or dangles):
/// renamed or moved into the place of a folder, it could carry a path
/// under it out of the Library. The sidebar never offers it anyway.
fn movable(g: &Grants, p: &str) -> Result<PathBuf, FileError> {
    let item = entry(g, p)?;
    if fs::symlink_metadata(&item)?.file_type().is_symlink() {
        g.in_root(&item)?;
    }
    Ok(item)
}

pub(crate) fn rename(g: &Grants, path: &str, new_name: &str) -> Result<String, FileError> {
    path_string(&ops::rename_entry(&movable(g, path)?, new_name)?)
}

pub(crate) fn move_to(g: &Grants, path: &str, dest_dir: &str) -> Result<String, FileError> {
    let src = movable(g, path)?;
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

/// A new empty file named `stem.ext` or `stem (2).ext`… in `parent`, for
/// an Inbox item dropped on a folder (the UI then saves into it).
pub(crate) fn reserve(
    g: &Grants,
    parent: &str,
    stem: &str,
    ext: &str,
) -> Result<String, FileError> {
    path_string(&ops::reserve_file(&folder(g, parent)?, stem, ext)?)
}

/// True for the error Windows gives when a folder can't be renamed or moved
/// because a handle is open inside it (such as a watcher on the folder of an
/// open File): `ERROR_ACCESS_DENIED` or `ERROR_SHARING_VIOLATION`.
fn held_open(e: &FileError) -> bool {
    #[cfg(windows)]
    if let FileError::Io(io) = e {
        return matches!(io.raw_os_error(), Some(5 | 32));
    }
    let _ = e;
    false
}

/// How long a retry waits for released handles to actually close: a
/// dropped watcher closes its folder handles on its own thread, a moment
/// after the drop returns.
const RELEASE_WAIT: std::time::Duration = std::time::Duration::from_secs(2);

/// Runs `op`; if it failed because a handle is open (Windows), runs
/// `release` to close Zukai's own handles and tries again, for as long as
/// it is still refused as held open, up to `RELEASE_WAIT`.
pub(crate) fn retry_released<T>(
    mut op: impl FnMut() -> Result<T, FileError>,
    release: impl FnOnce(),
) -> Result<T, FileError> {
    match op() {
        Err(e) if held_open(&e) => {
            release();
            let deadline = std::time::Instant::now() + RELEASE_WAIT;
            loop {
                match op() {
                    Err(e) if held_open(&e) && std::time::Instant::now() < deadline => {
                        std::thread::sleep(std::time::Duration::from_millis(25));
                    }
                    other => return other,
                }
            }
        }
        other => other,
    }
}

/// `op` (a rename, move or trash): if a handle is held open in the folder,
/// the File and Library watchers are dropped and it retries for up to 2 s
/// while the folder is still held open (`retry_released`); the watchers
/// are started again afterwards either way (the UI then replaces the File
/// set with the paths that moved).
fn with_watchers_released<T>(
    app: &AppHandle,
    g: &Grants,
    op: impl FnMut() -> Result<T, FileError>,
) -> Result<T, FileError> {
    let mut paused = None;
    let out = retry_released(op, || {
        let library_was_running = app.state::<LibraryWatcher>().pause();
        paused = Some((app.state::<FileWatcher>().suspend(), library_was_running));
    });
    if let Some((files, library_was_running)) = paused {
        let _ = app.state::<FileWatcher>().restore(files, file_sink(app));
        if library_was_running {
            let ticket = app.state::<LibraryWatcher>().ticket();
            let _ = watch_root(app, ticket, g.root());
        }
    }
    out
}

/// After `from` became `to` (a rename or move inside the Library): where
/// each of `paths` (Files the UI holds, open or Recently Closed) is now, or
/// `None` for one that isn't under `from` or can't be granted. Each new path
/// is granted exactly as returned, including Files whose folder is gone
/// (Missing), so the next `session_write` accepts the Session naming them.
/// Nothing outside the root is ever granted (`Grants::grant_in_root`).
pub(crate) fn follow(g: &Grants, from: &str, to: &str, paths: &[String]) -> Vec<Option<String>> {
    let (from, to) = (Path::new(from), Path::new(to));
    if g.in_root(to).is_err() {
        return paths.iter().map(|_| None).collect();
    }
    paths
        .iter()
        .map(|p| {
            let rest = suffix_under(Path::new(p), from)?;
            path_string(&g.grant_in_root(&to.join(rest)).ok()?).ok()
        })
        .collect()
}

/// The plain names after `base` in `path` (compared by key, so another case
/// of the same prefix matches), or `None` if `path` isn't at or under it.
fn suffix_under(path: &Path, base: &Path) -> Option<PathBuf> {
    let mut parts = path.components();
    for b in base.components() {
        let p = parts.next()?;
        if key(Path::new(p.as_os_str())) != key(Path::new(b.as_os_str())) {
            return None;
        }
    }
    let mut rest = PathBuf::new();
    for c in parts {
        match c {
            std::path::Component::Normal(name) => rest.push(name),
            _ => return None,
        }
    }
    Some(rest)
}

/// The Library folder an OS drag is over, as the UI last reported it.
#[derive(Default)]
pub struct DropTarget(Mutex<Option<String>>);

impl DropTarget {
    pub fn set(&self, dir: Option<String>) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = dir;
    }

    /// The target of a drop that just happened (cleared for the next drag).
    pub fn take(&self) -> Option<String> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).take()
    }
}

pub const LIBRARY_DROPPED_EVENT: &str = "zukai://library-dropped";

/// What a drop onto a Library folder did.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Dropped {
    pub dir: String,
    pub copied: usize,
    /// The names that couldn't be copied.
    pub failed: Vec<String>,
}

/// Copies paths dropped from outside into `dir`, a Library folder. The
/// sources come from the OS drop (never from the webview), so they need no
/// grant; the destination must be inside the root.
pub(crate) fn drop_into(g: &Grants, dir: &str, paths: &[PathBuf]) -> Result<Dropped, FileError> {
    let dest = folder(g, dir)?;
    let results = ops::copy_into(paths, &dest);
    let failed = paths
        .iter()
        .zip(&results)
        .filter(|(_, r)| r.is_err())
        .map(|(p, _)| {
            p.file_name()
                .map_or_else(|| p.to_string_lossy(), |n| n.to_string_lossy())
                .into_owned()
        })
        .collect();
    Ok(Dropped {
        dir: path_string(&dest)?,
        copied: results.iter().filter(|r| r.is_ok()).count(),
        failed,
    })
}

/// A drop on the window while the UI reported a Library folder under the
/// pointer: copy into it (off the event thread) and tell the UI. A target
/// that is no longer a Library folder opens the files instead.
pub fn copy_dropped(app: &AppHandle, dir: String, paths: Vec<PathBuf>) {
    let app = app.clone();
    std::thread::spawn(
        move || match drop_into(&app.state::<Grants>(), &dir, &paths) {
            Ok(done) => {
                let change = super::watch::LibraryChange {
                    dirs: vec![done.dir.clone()],
                };
                let _ = app.emit(LIBRARY_CHANGED_EVENT, change);
                let _ = app.emit(LIBRARY_DROPPED_EVENT, done);
            }
            Err(_) => crate::files::open_paths::emit_dropped_paths(&app, paths),
        },
    );
}

/// What opening the Library file `path` opens: its canonical path, so a
/// link that stays inside the root opens as its target (spec §5.8.3). The
/// Tab, the Session and the File watcher then all name the target, the one
/// spelling `check_session` accepts; the link stays the tree row for
/// rename, trash and reveal. A link out of the root (or dangling) is
/// refused like any path outside it.
pub(crate) fn resolve(g: &Grants, path: &str) -> Result<String, FileError> {
    let target = g.in_root(Path::new(path))?;
    if target.is_dir() {
        return Err(FileError::NotAFile);
    }
    path_string(&target)
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

#[tauri::command]
pub async fn library_recreate(app: AppHandle) -> Result<RootState, FileError> {
    let handle = app.clone();
    blocking(app, move |g| recreate_root(g, &data_dir(&handle)?)).await
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
    let handle = app.clone();
    blocking(app, move |g| {
        with_watchers_released(&handle, g, || rename(g, &path, &new_name))
    })
    .await
}

#[tauri::command]
pub async fn library_move(
    app: AppHandle,
    path: String,
    dest_dir: String,
) -> Result<String, FileError> {
    let handle = app.clone();
    blocking(app, move |g| {
        with_watchers_released(&handle, g, || move_to(g, &path, &dest_dir))
    })
    .await
}

/// See `follow`.
#[tauri::command]
pub async fn library_follow(
    app: AppHandle,
    from: String,
    to: String,
    paths: Vec<String>,
) -> Result<Vec<Option<String>>, FileError> {
    blocking(app, move |g| Ok(follow(g, &from, &to, &paths))).await
}

#[tauri::command]
pub async fn library_reserve(
    app: AppHandle,
    parent: String,
    stem: String,
    ext: String,
) -> Result<String, FileError> {
    blocking(app, move |g| reserve(g, &parent, &stem, &ext)).await
}

/// The folder an OS drag is over (`None`: not over one). A drop then copies
/// into it instead of opening the files.
#[tauri::command]
pub fn library_set_drop_target(app: AppHandle, dir: Option<String>) {
    app.state::<DropTarget>().set(dir);
}

/// How old the index may be before a focus re-sync rebuilds it.
pub const RESYNC_AGE: Duration = Duration::from_secs(30);

/// The window regained focus: rebuild the index if its build is older than
/// `RESYNC_AGE` (Windows drops watcher events when its buffer overflows).
/// Returns whether a rebuild started.
#[tauri::command]
pub fn library_resync(app: AppHandle) -> bool {
    app.state::<NameIndex>().rebuild_if_older(RESYNC_AGE)
}

#[tauri::command]
pub async fn library_copy_into(
    app: AppHandle,
    srcs: Vec<String>,
    dest_dir: String,
) -> Result<Vec<CopyResult>, FileError> {
    blocking(app, move |g| Ok(copy_to(g, &srcs, &dest_dir))).await
}

/// See `resolve`.
#[tauri::command]
pub async fn library_resolve(app: AppHandle, path: String) -> Result<String, FileError> {
    blocking(app, move |g| resolve(g, &path)).await
}

#[tauri::command]
pub async fn library_trash(app: AppHandle, path: String) -> Result<(), FileError> {
    let handle = app.clone();
    blocking(app, move |g| {
        with_watchers_released(&handle, g, || trash(g, &path))
    })
    .await
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

/// (Re)starts the Library watcher and the name index for `root` (`None`
/// stops both). Blocking: setting up a recursive watch walks the tree on
/// some platforms.
fn watch_root(app: &AppHandle, ticket: u64, root: Option<PathBuf>) -> Result<(), FileError> {
    let sink: Sink = {
        let app = app.clone();
        Arc::new(move |change| {
            let _ = app.emit(LIBRARY_CHANGED_EVENT, change);
        })
    };
    app.state::<LibraryWatcher>()
        .set_ordered(ticket, root, &app.state::<NameIndex>(), sink)
}

/// Watches and indexes the current root, replacing any earlier watcher and
/// index. The UI calls it after `library_root`, `library_use_default` and
/// `library_choose`.
#[tauri::command]
pub async fn library_watch(app: AppHandle) -> Result<(), FileError> {
    let ticket = app.state::<LibraryWatcher>().ticket();
    let handle = app.clone();
    blocking(app, move |g| watch_root(&handle, ticket, g.root())).await
}

/// Files and folders anywhere in the Library whose name contains `query`.
/// The first search for a root starts the index (and its watcher); until
/// the walk is done the result is partial, with `ready: false`.
#[tauri::command]
pub async fn library_search(app: AppHandle, query: String) -> Result<SearchResult, FileError> {
    let handle = app.clone();
    blocking(app, move |g| {
        let index = handle.state::<NameIndex>();
        let root = g.root();
        if root.is_some() && index.root() != root {
            let ticket = handle.state::<LibraryWatcher>().ticket();
            watch_root(&handle, ticket, root)?;
        }
        Ok(index.search(&query, SEARCH_LIMIT))
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
    fn reserve_stays_in_the_root_and_never_replaces() {
        let (_tmp, g, root, outside) = library();
        fs::write(root.join("Idea.md"), "keep").unwrap();
        let p = reserve(&g, s(&root), "Idea", "md").unwrap();
        assert_eq!(p, s(&root.join("Idea (2).md")));
        assert_eq!(fs::read(root.join("Idea.md")).unwrap(), b"keep");
        assert!(matches!(
            reserve(&g, s(&outside), "Idea", "md"),
            Err(FileError::NotGranted)
        ));
    }

    #[test]
    fn drop_into_copies_ungranted_sources_into_a_library_folder() {
        let (_tmp, g, root, outside) = library();
        let png = outside.join("pic.png");
        fs::write(&png, "png").unwrap();
        let dest = root.join("proj");
        fs::create_dir(&dest).unwrap();
        let missing = outside.join("gone.png");
        let done = drop_into(&g, s(&dest), &[png.clone(), missing]).unwrap();
        assert_eq!(done.dir, s(&dest));
        assert_eq!(done.copied, 1);
        assert_eq!(done.failed, ["gone.png"]);
        assert_eq!(fs::read(dest.join("pic.png")).unwrap(), b"png");
        // The source stays where it was, and stays ungranted.
        assert!(png.exists());
        assert!(g.check(s(&png)).is_err());
        // Never into a folder outside the root.
        assert!(matches!(
            drop_into(&g, s(&outside), std::slice::from_ref(&png)),
            Err(FileError::NotGranted)
        ));
    }

    #[test]
    fn drop_target_is_taken_once() {
        let t = DropTarget::default();
        t.set(Some("x".into()));
        assert_eq!(t.take().as_deref(), Some("x"));
        assert_eq!(t.take(), None);
    }

    /// Windows refuses to rename a folder while a handle is open inside it.
    /// The File watcher holds one on each open File's folder: dropping it
    /// and retrying for up to 2 s while the folder is still held open lets
    /// the rename through.
    #[cfg(windows)]
    #[test]
    fn rename_retries_after_dropping_watchers() {
        use crate::files::watch::Sink as FileSink;
        let (_tmp, g, root, _outside) = library();
        let sub = root.join("proj").join("sub");
        fs::create_dir_all(&sub).unwrap();
        let file = sub.join("a.md");
        fs::write(&file, "a").unwrap();
        let files = FileWatcher::default();
        let file_sink: FileSink = Arc::new(|_| {});
        files.set(vec![file.clone()], file_sink).unwrap();
        let lib = LibraryWatcher::default();
        let index = NameIndex::default();
        let lib_sink: Sink = Arc::new(|_| {});
        lib.set(Some(root.clone()), &index, lib_sink).unwrap();

        let proj = s(&root.join("proj")).to_owned();
        // The premise: with the watchers running, Windows refuses.
        let first = rename(&g, &proj, "renamed");
        assert!(
            first.as_ref().is_err_and(held_open),
            "expected a held-open refusal, got {first:?}"
        );

        let mut released = false;
        let out = retry_released(
            || rename(&g, &proj, "renamed"),
            || {
                files.suspend();
                lib.pause();
                released = true;
            },
        );
        assert!(released);
        assert_eq!(out.unwrap(), s(&root.join("renamed")));
        assert!(root.join("renamed").join("sub").join("a.md").is_file());
    }

    #[test]
    fn follow_grants_moved_paths_even_when_their_folder_is_gone() {
        let (_tmp, g, root, outside) = library();
        let proj = root.join("proj");
        fs::create_dir(&proj).unwrap();
        fs::write(proj.join("a.md"), "a").unwrap();
        // A Missing File (its folder was deleted) and a Recently Closed one.
        let gone = proj.join("old").join("x.md");
        let a = proj.join("a.md");
        let work = rename(&g, s(&proj), "work").unwrap();
        assert_eq!(work, s(&root.join("work")));
        let moved = follow(
            &g,
            s(&proj),
            &work,
            &[
                s(&a).to_owned(),
                s(&gone).to_owned(),
                s(&outside.join("y.md")).to_owned(),
                s(&root.join("proj2").join("z.md")).to_owned(),
            ],
        );
        let new_a = s(&root.join("work").join("a.md")).to_owned();
        let new_gone = s(&root.join("work").join("old").join("x.md")).to_owned();
        assert_eq!(
            moved,
            [Some(new_a.clone()), Some(new_gone.clone()), None, None]
        );
        // The Session naming them is accepted byte for byte.
        let json = serde_json::json!({
            "version": 3,
            "tabs": [{ "id": "t", "file": { "path": new_gone } }],
            "closed": [{ "tab": { "id": "c", "file": { "path": new_a } } }],
        })
        .to_string();
        crate::files::grants::check_session(&g, &json).unwrap();
        // Never anywhere outside the root.
        assert_eq!(
            follow(&g, s(&root), s(&outside), &[s(&a).to_owned()]),
            [None]
        );
    }

    /// A stale grant under a folder that went away, then an outside link put
    /// in that folder's place (renamed by Zukai or by anything else): the
    /// grant must not let a write follow the link out.
    #[test]
    fn stale_grant_never_follows_a_link_renamed_into_its_place() {
        let (_tmp, g, root, outside) = library();
        let p = root.join("p");
        let x = p.join("sub").join("x.txt");
        let granted = follow(&g, s(&p), s(&root), &[s(&x).to_owned()]);
        let stale = root.join("sub").join("x.txt");
        assert_eq!(granted, [Some(s(&stale).to_owned())]);
        // Inside the root, a granted path is usable.
        assert_eq!(g.check(s(&stale)).unwrap(), stale);

        link_dir(&root.join("out"), &outside);
        // Zukai refuses to move an outside link (into place or anywhere).
        assert!(matches!(
            rename(&g, s(&root.join("out")), "sub"),
            Err(FileError::NotGranted)
        ));
        fs::create_dir(root.join("dest")).unwrap();
        assert!(matches!(
            move_to(&g, s(&root.join("out")), s(&root.join("dest"))),
            Err(FileError::NotGranted)
        ));
        // Another program does it anyway.
        fs::rename(root.join("out"), root.join("sub")).unwrap();
        assert!(matches!(g.check(s(&stale)), Err(FileError::NotGranted)));
        assert!(g.check_exact(s(&stale)).is_err());
        assert!(g.check(s(&outside.join("x.txt"))).is_err());
        // The stale grant is gone for good, even once the link is.
        #[cfg(windows)]
        fs::remove_dir(root.join("sub")).unwrap(); // the junction itself
        #[cfg(unix)]
        fs::remove_file(root.join("sub")).unwrap(); // the symlink itself
        fs::create_dir(root.join("sub")).unwrap();
        assert!(g.check(s(&stale)).is_ok(), "the root grant still covers it");
        assert!(!outside.join("x.txt").exists());

        // Ordinary in-root grants and writes still work.
        fs::write(root.join("sub").join("y.txt"), "y").unwrap();
        let y = root.join("sub").join("y.txt");
        assert_eq!(g.grant(&y).unwrap(), y);
        assert_eq!(g.check(s(&y)).unwrap(), y);
    }

    /// A Session naming a Missing File under the Library, whose missing
    /// folder is later replaced by one holding a link out: the next launch
    /// (a fresh `Grants`) must not grant through the link.
    #[test]
    fn session_grants_never_follow_a_link_out_after_a_relaunch() {
        let (_tmp, g, root, outside) = library();
        let data = tempfile::tempdir().unwrap();
        use_root(&g, data.path(), &root).unwrap();
        let p = root.join("p");
        let x = p.join("sub").join("lnk").join("x.txt");
        let stale = root.join("sub").join("lnk").join("x.txt");
        let granted = follow(&g, s(&p), s(&root), &[s(&x).to_owned()]);
        assert_eq!(granted, [Some(s(&stale).to_owned())]);
        let json = serde_json::json!({
            "version": 3,
            "tabs": [{ "id": "t", "file": { "path": s(&stale) } }],
            "closed": [],
        })
        .to_string();
        crate::files::grants::check_session(&g, &json).unwrap();

        // A normal folder holding a link out is renamed into place.
        let d = root.join("d");
        fs::create_dir(&d).unwrap();
        link_dir(&d.join("lnk"), &outside);
        rename(&g, s(&d), "sub").unwrap();

        // Relaunch: the root is loaded before the Session is granted.
        let next = Grants::default();
        root_state(&next, data.path());
        let out = crate::files::grants::grant_session(&next, json.clone());
        assert_eq!(out, json, "the Session isn't rewritten to the outside path");
        assert!(next.check(s(&stale)).is_err());
        assert!(next.check(s(&outside.join("x.txt"))).is_err());
        assert!(crate::files::grants::check_session(&next, &json).is_err());
        assert!(!outside.join("x.txt").exists());

        // The same with the root not loaded yet: only its stored path known.
        let early = Grants::default();
        early.set_root_hint(&root);
        let _ = crate::files::grants::grant_session(&early, json.clone());
        assert!(early.check(s(&outside.join("x.txt"))).is_err());
        assert!(early.check(s(&stale)).is_err(), "unusable until checked");
        root_state(&early, data.path());
        assert!(early.check(s(&stale)).is_err());
    }

    /// A Library that is briefly unavailable (renamed away and back, a
    /// drive offline) keeps its grants: refused meanwhile, fine after.
    #[test]
    fn grants_survive_the_root_going_away_and_back() {
        let (tmp, g, root, _outside) = library();
        let p = root.join("p");
        let missing = root.join("m").join("x.txt");
        let granted = follow(
            &g,
            s(&p),
            s(&root),
            &[s(&p.join("m").join("x.txt")).to_owned()],
        );
        assert_eq!(granted, [Some(s(&missing).to_owned())]);
        let away = tmp.path().join("away");
        fs::rename(&root, &away).unwrap();
        assert!(g.check(s(&missing)).is_err());
        assert!(g.check_exact(s(&missing)).is_err());
        fs::rename(&away, &root).unwrap();
        assert_eq!(g.check(s(&missing)).unwrap(), missing);
        assert_eq!(g.check_exact(s(&missing)).unwrap(), missing);
    }

    /// The root compared by key: another case of its spelling is still the
    /// Library, so it can't skip the re-check.
    #[cfg(windows)]
    #[test]
    fn library_paths_are_recognised_in_any_case() {
        let (_tmp, g, root, outside) = library();
        link_dir(&root.join("out"), &outside);
        let upper = PathBuf::from(s(&root).to_uppercase())
            .join("out")
            .join("x.txt");
        assert!(matches!(g.grant(&upper), Err(FileError::NotGranted)));
        assert!(g.check(s(&outside.join("x.txt"))).is_err());
    }

    /// The Library offline at launch: the Session keeps its Library Files
    /// (bookkeeping), but no I/O reaches them until the root is back.
    #[test]
    fn session_keeps_library_files_while_the_root_is_offline_at_launch() {
        use crate::files::grants::{check_session, filter_exact, grant_session};
        let (tmp, g, root, _outside) = library();
        let data = tempfile::tempdir().unwrap();
        use_root(&g, data.path(), &root).unwrap();
        fs::write(root.join("a.md"), "a").unwrap();
        let a = s(&root.join("a.md")).to_owned();
        let m = s(&root.join("m").join("x.txt")).to_owned();
        let json = serde_json::json!({
            "version": 3,
            "tabs": [{ "id": "t", "file": { "path": a } }],
            "closed": [{ "tab": { "id": "c", "file": { "path": m } } }],
        })
        .to_string();
        let away = tmp.path().join("away");
        fs::rename(&root, &away).unwrap();

        let next = Grants::default();
        root_state(&next, data.path());
        assert_eq!(grant_session(&next, json.clone()), json);
        assert_eq!(
            filter_exact(&next, vec![a.clone(), m.clone()]),
            [a.clone(), m.clone()]
        );
        check_session(&next, &json).unwrap();
        assert!(next.check(&a).is_err(), "no I/O while offline");
        assert!(next.check(&m).is_err());

        // C: the drive comes back; Rust finds the root again by itself
        // (once the remembered miss of the checks above has run out).
        next.forget_recover_miss();
        fs::rename(&away, &root).unwrap();
        assert_eq!(next.check(&a).unwrap(), root.join("a.md"));
        assert!(next.root().is_some());
    }

    /// The root goes away mid-run: the Session can still be saved, but I/O
    /// on its Library Files is refused.
    #[test]
    fn session_write_allowed_while_the_root_is_away() {
        let (tmp, g, root, _outside) = library();
        fs::write(root.join("a.md"), "a").unwrap();
        let a = root.join("a.md");
        assert_eq!(g.grant(&a).unwrap(), a);
        let json = serde_json::json!({
            "version": 3,
            "tabs": [{ "id": "t", "file": { "path": s(&a) } }],
            "closed": [],
        })
        .to_string();
        let away = tmp.path().join("away");
        fs::rename(&root, &away).unwrap();
        crate::files::grants::check_session(&g, &json).unwrap();
        assert!(g.check(s(&a)).is_err());
        fs::rename(&away, &root).unwrap();
        assert_eq!(g.check(s(&a)).unwrap(), a);
    }

    /// C: the stored root missing from the start, created later.
    #[test]
    fn root_recovered_from_the_stored_path_when_it_appears() {
        let (tmp, _g, _root, _outside) = library();
        let base = dunce::canonicalize(tmp.path()).unwrap();
        let later = base.join("later");
        let g = Grants::default();
        g.set_root_hint(&later);
        let x = later.join("x.txt");
        assert_eq!(g.grant(&x).unwrap(), x, "kept as given while missing");
        assert!(g.check(s(&x)).is_err());
        fs::create_dir(&later).unwrap();
        // The miss above is remembered for a few seconds.
        assert!(g.check(s(&x)).is_err());
        g.forget_recover_miss();
        assert_eq!(g.check(s(&x)).unwrap(), x);
        assert_eq!(g.root(), Some(later));
    }

    /// D: only a link that leads out (or dangles) counts as escaping; a
    /// plain path that merely can't be read now is kept.
    #[test]
    fn only_a_link_out_counts_as_escaping() {
        let (_tmp, g, root, outside) = library();
        let p = root.join("p");
        let x = p.join("sub").join("x.txt");
        let granted = follow(&g, s(&p), s(&root), &[s(&x).to_owned()]);
        let kept = root.join("sub").join("x.txt");
        assert_eq!(granted, [Some(s(&kept).to_owned())]);
        // Plain parts, present or missing, are never an escape.
        assert!(!crate::files::grants::link_out_on(&kept, &root));
        fs::create_dir(root.join("sub")).unwrap();
        assert!(!crate::files::grants::link_out_on(&kept, &root));
        assert_eq!(g.check_exact(s(&kept)).unwrap(), kept, "grant kept");
        // A link out on the way is an escape: dropped.
        fs::remove_dir(root.join("sub")).unwrap();
        link_dir(&root.join("sub"), &outside.join("gone"));
        assert!(crate::files::grants::link_out_on(&kept, &root), "dangling");
        #[cfg(windows)]
        fs::remove_dir(root.join("sub")).unwrap();
        #[cfg(unix)]
        fs::remove_file(root.join("sub")).unwrap();
        link_dir(&root.join("sub"), &outside);
        assert!(crate::files::grants::link_out_on(&kept, &root));
        assert!(g.check(s(&kept)).is_err());
        assert!(g.check_exact_stored(s(&kept)).is_err());
    }

    /// Grants outside the root (Files opened from a dialog) are untouched.
    #[test]
    fn grants_outside_the_root_are_not_rechecked() {
        let (_tmp, g, _root, outside) = library();
        let f = outside.join("opened.txt");
        fs::write(&f, "o").unwrap();
        assert_eq!(g.grant(&f).unwrap(), f);
        assert_eq!(g.check_exact(s(&f)).unwrap(), f);
    }

    /// A folder link (a junction on Windows, a symlink elsewhere).
    fn link_dir(link: &Path, target: &Path) {
        #[cfg(windows)]
        crate::library::tests::junction(link, target);
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    /// `follow` takes `from`, `to` and the paths from the webview: a link
    /// inside the Library that points outside, or dangles, must never let it
    /// grant past it.
    #[test]
    fn follow_never_grants_through_links_out_of_the_root() {
        let (_tmp, g, root, outside) = library();
        link_dir(&root.join("link"), &outside);
        link_dir(&root.join("dangling"), &outside.join("not-yet"));
        let from = root.join("p");
        let under = |rel: &[&str]| {
            let mut p = from.clone();
            p.extend(rel);
            s(&p).to_owned()
        };
        let out = follow(
            &g,
            s(&from),
            s(&root),
            &[
                // (a) through a link to an outside folder
                under(&["link", "new.txt"]),
                under(&["link", "deeper", "new.txt"]),
                // (b) a dangling link in the last place, and through it
                under(&["dangling"]),
                under(&["dangling", "new.txt"]),
                // the positive control: a plain missing folder
                under(&["sub", "ok.txt"]),
            ],
        );
        assert_eq!(
            out,
            [
                None,
                None,
                None,
                None,
                Some(s(&root.join("sub").join("ok.txt")).to_owned())
            ]
        );
        // Nothing past the links was granted.
        for escaped in [
            outside.join("new.txt"),
            outside.join("deeper").join("new.txt"),
            outside.join("not-yet"),
            outside.join("not-yet").join("new.txt"),
            root.join("link").join("new.txt"),
            root.join("dangling"),
        ] {
            assert!(g.check(s(&escaped)).is_err(), "{escaped:?} was granted");
        }
        // `to` itself through a link is refused outright.
        assert_eq!(
            follow(&g, s(&from), s(&root.join("link")), &[under(&["x.txt"])]),
            [None]
        );
    }

    #[cfg(unix)]
    #[test]
    fn follow_refuses_a_file_link_out_of_the_root() {
        let (_tmp, g, root, outside) = library();
        let secret = outside.join("secret.md");
        fs::write(&secret, "s").unwrap();
        std::os::unix::fs::symlink(&secret, root.join("leak.md")).unwrap();
        let from = root.join("p");
        let out = follow(
            &g,
            s(&from),
            s(&root),
            &[s(&from.join("leak.md")).to_owned()],
        );
        assert_eq!(out, [None]);
        assert!(g.check(s(&secret)).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn follow_refuses_win32_alias_names() {
        let (_tmp, g, root, _outside) = library();
        let from = root.join("p");
        let paths = [format!(r"{}\x.", s(&from)), format!(r"{}\y ", s(&from))];
        assert_eq!(follow(&g, s(&from), s(&root), &paths), [None, None]);
    }

    /// Trashing a folder is a rename into the Recycle Bin: Windows refuses
    /// it while a watcher handle is open inside, like a rename. It really
    /// trashes a temporary folder (purged again afterwards), so it runs only
    /// when asked: CI runs `cargo test -- --include-ignored`.
    #[cfg(windows)]
    #[test]
    #[ignore = "uses the real Recycle Bin; CI runs it with --include-ignored"]
    fn trash_retries_after_dropping_watchers() {
        use crate::files::watch::Sink as FileSink;
        let (_tmp, g, root, _outside) = library();
        let sub = root.join("proj").join("sub");
        fs::create_dir_all(&sub).unwrap();
        let file = sub.join("a.md");
        fs::write(&file, "a").unwrap();
        let files = FileWatcher::default();
        let file_sink: FileSink = Arc::new(|_| {});
        files.set(vec![file.clone()], file_sink).unwrap();
        let proj = s(&root.join("proj")).to_owned();

        let first = trash(&g, &proj);
        assert!(
            first.as_ref().is_err_and(held_open),
            "expected a held-open refusal, got {first:?}"
        );
        assert!(root.join("proj").exists(), "a refused trash moves nothing");
        let mut released = false;
        retry_released(
            || trash(&g, &proj),
            || {
                files.suspend();
                released = true;
            },
        )
        .unwrap();
        assert!(released);
        assert!(!root.join("proj").exists());
        // Purge what this test put in the Recycle Bin.
        let mine: Vec<_> = trash::os_limited::list()
            .unwrap_or_default()
            .into_iter()
            .filter(|item| item.original_parent == root && item.name == "proj")
            .collect();
        let _ = trash::os_limited::purge_all(mine);
    }

    #[test]
    fn retry_released_only_retries_a_held_open_error() {
        let mut calls = 0;
        let mut released = false;
        let out: Result<(), FileError> = retry_released(
            || {
                calls += 1;
                Err(FileError::Exists)
            },
            || released = true,
        );
        assert!(matches!(out, Err(FileError::Exists)));
        assert_eq!((calls, released), (1, false));
    }

    #[test]
    fn recreate_makes_the_stored_root_again() {
        let (_tmp, g, _root, outside) = library();
        let data = tempfile::tempdir().unwrap();
        assert!(recreate_root(&g, data.path()).is_err(), "nothing stored");
        let lib = outside.join("lib");
        fs::create_dir(&lib).unwrap();
        use_root(&g, data.path(), &lib).unwrap();
        fs::remove_dir(&lib).unwrap();
        let state = recreate_root(&Grants::default(), data.path()).unwrap();
        assert!(state.available);
        assert_eq!(state.root.as_deref(), Some(s(&lib)));
        assert!(lib.is_dir());
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

    /// A file link (a symlink; on Windows only where creating one is
    /// allowed). False if it couldn't be made.
    fn link_file(link: &Path, target: &Path) -> bool {
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_file(target, link);
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(target, link);
        made.is_ok()
    }

    /// A file link that stays inside the Library opens as its target, the
    /// one spelling the Session checks accept (now and after a relaunch).
    #[test]
    fn inside_file_link_opens_as_its_target_and_the_session_keeps_it() {
        use crate::files::grants::{check_session, filter_exact, grant_session};
        let (_tmp, g, root, outside) = library();
        let data = tempfile::tempdir().unwrap();
        use_root(&g, data.path(), &root).unwrap();
        fs::write(root.join("real.md"), "r").unwrap();
        fs::write(outside.join("secret.md"), "s").unwrap();
        let link = root.join("link.md");
        if !link_file(&link, &root.join("real.md")) {
            // Windows without Developer Mode or the symlink privilege.
            eprintln!("skipped: creating a file symlink isn't allowed here");
            return;
        }
        let opened = resolve(&g, s(&link)).unwrap();
        assert_eq!(opened, s(&root.join("real.md")));

        let session = |path: &str| {
            serde_json::json!({
                "version": 3,
                "tabs": [{ "id": "t", "file": { "path": path } }],
                "closed": [{ "tab": { "id": "c", "file": { "path": path } } }],
            })
            .to_string()
        };
        let json = session(&opened);
        check_session(&g, &json).unwrap();
        assert_eq!(
            filter_exact(&g, vec![opened.clone()]),
            std::slice::from_ref(&opened)
        );
        // The link's own path is what the UI used to store: refused.
        assert!(check_session(&g, &session(s(&link))).is_err());

        // Relaunch: granted as is, kept, and accepted back.
        let next = Grants::default();
        root_state(&next, data.path());
        assert_eq!(grant_session(&next, json.clone()), json);
        assert_eq!(
            filter_exact(&next, vec![opened.clone()]),
            std::slice::from_ref(&opened)
        );
        check_session(&next, &json).unwrap();

        // A link out of the root, and a folder, don't open.
        assert!(link_file(&root.join("out.md"), &outside.join("secret.md")));
        assert!(matches!(
            resolve(&g, s(&root.join("out.md"))),
            Err(FileError::NotGranted)
        ));
        fs::create_dir(root.join("dir")).unwrap();
        assert!(matches!(
            resolve(&g, s(&root.join("dir"))),
            Err(FileError::NotAFile)
        ));
        assert!(resolve(&g, s(&outside.join("secret.md"))).is_err());
    }

    /// A dead network share as the root: granting the Session never probes
    /// it once per path, and checks share one remembered miss.
    #[test]
    fn a_missing_root_is_probed_at_most_once_for_a_session() {
        use crate::files::grants::{check_session, filter_exact, grant_session};
        let (tmp, g, root, _outside) = library();
        let data = tempfile::tempdir().unwrap();
        use_root(&g, data.path(), &root).unwrap();
        let paths: Vec<String> = (0..20)
            .map(|i| s(&root.join(format!("f{i}.md"))).to_owned())
            .collect();
        let tabs: Vec<_> = paths
            .iter()
            .map(|p| serde_json::json!({ "id": p, "file": { "path": p } }))
            .collect();
        let json = serde_json::json!({ "version": 3, "tabs": tabs, "closed": [] }).to_string();
        fs::rename(&root, tmp.path().join("away")).unwrap();

        let next = Grants::default();
        assert!(!root_state(&next, data.path()).available);
        assert_eq!(grant_session(&next, json.clone()), json);
        assert_eq!(next.recover_probes(), 0, "no probe while granting");
        assert_eq!(filter_exact(&next, paths.clone()), paths);
        check_session(&next, &json).unwrap();
        for p in &paths {
            assert!(next.check(p).is_err());
        }
        assert!(next.recover_probes() <= 1, "{}", next.recover_probes());
    }

    /// The stored root was replaced by a link to another folder: it is not
    /// the Library that was chosen, so neither the load nor a later
    /// recovery grants it.
    #[test]
    fn a_stored_root_that_became_a_link_elsewhere_is_refused() {
        let (tmp, g, root, outside) = library();
        let data = tempfile::tempdir().unwrap();
        use_root(&g, data.path(), &root).unwrap();
        fs::write(outside.join("secret.md"), "s").unwrap();
        fs::rename(&root, tmp.path().join("away")).unwrap();
        link_dir(&root, &outside);

        let next = Grants::default();
        let state = root_state(&next, data.path());
        assert!(!state.available);
        assert_eq!(state.root.as_deref(), Some(s(&root)));
        assert_eq!(next.root(), None);
        assert!(next.check(s(&root.join("secret.md"))).is_err());
        assert!(next.check(s(&outside.join("secret.md"))).is_err());
        next.forget_recover_miss();
        let _ = next.grant(&root.join("secret.md"));
        assert!(next.check(s(&root.join("secret.md"))).is_err());
        assert_eq!(next.root(), None, "recovery refuses it too");
    }
}
