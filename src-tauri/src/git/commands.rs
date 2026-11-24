//! Tauri commands for git sync. All of them answer `Disabled` (and run
//! nothing) until the frontend turns the "Git sync" setting on. A folder
//! the webview names must be exactly a granted root (the Library or an
//! added folder), and holds that folder's busy lock while git runs. A clone's
//! parent only ever comes from the dialog, by token.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use super::state::GitState;
use super::{FolderGit, Git, GitError, GitKind, check_name, clone_into, folder_git, ops};
use crate::files::FileError;
use crate::files::grants::{Grants, key};
use crate::library::added::{self, Refusal};
use crate::library::commands::{RootState, add_folder, data_dir, sync_added_watchers, use_root};

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitAvailability {
    pub available: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PickedParent {
    /// Names the picked folder in `git_clone`; good for one clone.
    pub token: String,
    /// The picked folder, canonical, for the UI to show.
    pub path: String,
}

/// Runs git work off the async runtime.
async fn run<T, F>(app: AppHandle, f: F) -> Result<T, GitError>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle) -> Result<T, GitError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || f(&app))
        .await
        .map_err(|e| GitError::new(GitKind::Failed, e.to_string()))?
}

fn failed(e: impl ToString) -> GitError {
    GitError::new(GitKind::Failed, e.to_string())
}

fn not_allowed() -> GitError {
    GitError::new(GitKind::NotAllowed, "that folder is not in the sidebar")
}

/// A library error as a git one: the add-folder refusals stay `Refused`
/// with the text the user sees.
fn from_file(e: FileError) -> GitError {
    const REFUSALS: [Refusal; 5] = [
        Refusal::InLibrary,
        Refusal::ContainsLibrary,
        Refusal::AlreadyAdded,
        Refusal::ContainsAdded,
        Refusal::TooBroad,
    ];
    if matches!(e, FileError::NotGranted) {
        return not_allowed();
    }
    let msg = e.to_string();
    let kind = if REFUSALS.iter().any(|r| r.message() == msg) {
        GitKind::Refused
    } else {
        GitKind::Failed
    };
    GitError::new(kind, msg)
}

/// The canonical `folder` if it is exactly a granted root, else `NotAllowed`.
fn root_folder(g: &Grants, folder: &str) -> Result<PathBuf, GitError> {
    let t = g.in_root(Path::new(folder)).map_err(|_| not_allowed())?;
    if g.root_of(&t).as_ref() == Some(&t) {
        Ok(t)
    } else {
        Err(not_allowed())
    }
}

/// Runs `f` on the root `folder` with git, holding the folder's busy lock.
async fn on_folder<T, F>(app: AppHandle, folder: String, f: F) -> Result<T, GitError>
where
    T: Send + 'static,
    F: FnOnce(&Git, &Path) -> Result<T, GitError> + Send + 'static,
{
    run(app, move |app| {
        let st = app.state::<GitState>();
        // Authorized before git runs at all (even first-time discovery).
        st.check_enabled()?;
        let dir = root_folder(&app.state::<Grants>(), &folder)?;
        let _busy = st.lock(key(&dir))?;
        let git = st.git()?;
        f(&git, &dir)
    })
    .await
}

/// The user's home folder, canonical where possible.
fn home() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(dunce::canonicalize(&home).unwrap_or(home))
}

/// Turns git sync on or off. Off never runs git; on finds git as at startup
/// (a found git stays cached, "not found" is looked for again). `available`
/// is whether git was found (when off: as far as is known, without looking).
#[tauri::command]
pub async fn git_set_enabled(app: AppHandle, enabled: bool) -> Result<GitAvailability, GitError> {
    let st = app.state::<GitState>();
    st.set_enabled(enabled);
    if !enabled {
        return Ok(GitAvailability {
            available: st.known_available(),
        });
    }
    run(app.clone(), |app| {
        Ok(GitAvailability {
            available: app.state::<GitState>().git().is_ok(),
        })
    })
    .await
}

#[tauri::command]
pub async fn git_status(app: AppHandle, folder: String) -> Result<FolderGit, GitError> {
    on_folder(app, folder, folder_git).await
}

#[tauri::command]
pub async fn git_pull(app: AppHandle, folder: String) -> Result<(), GitError> {
    on_folder(app, folder, ops::pull).await
}

#[tauri::command]
pub async fn git_commit_push(
    app: AppHandle,
    folder: String,
    message: String,
) -> Result<(), GitError> {
    on_folder(app, folder, move |git, dir| {
        ops::commit_push(git, dir, &message)
    })
    .await
}

#[tauri::command]
pub async fn git_push(app: AppHandle, folder: String) -> Result<(), GitError> {
    on_folder(app, folder, ops::push).await
}

#[tauri::command]
pub async fn git_setup(app: AppHandle, folder: String, url: String) -> Result<(), GitError> {
    on_folder(app, folder, move |git, dir| ops::setup(git, dir, &url)).await
}

/// The native folder dialog for where to clone. `None` if cancelled.
#[tauri::command]
pub async fn git_pick_clone_parent(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<PickedParent>, GitError> {
    let dialog = window.dialog().file().set_parent(&window);
    run(app, move |app| {
        let st = app.state::<GitState>();
        st.git()?;
        let Some(picked) = dialog.blocking_pick_folder() else {
            return Ok(None);
        };
        let dir = picked.into_path().map_err(failed)?;
        let canon = dunce::canonicalize(&dir).map_err(failed)?;
        let path = canon
            .to_str()
            .ok_or_else(|| failed("path is not valid UTF-8"))?
            .to_owned();
        let token = st.add_pick(canon);
        Ok(Some(PickedParent { token, path }))
    })
    .await
}

/// Clones `url` into `name` inside the folder picked under `token`, then
/// adds it to the sidebar or makes it the Library. Cancellable through
/// `git_cancel(op_id)`. The pick is used up once the clone succeeds; after
/// a failure or cancel the same token works for a retry. `open_paths` (the
/// Files the UI holds) stay granted when the Library changes, as in
/// `library_choose`.
#[tauri::command]
pub async fn git_clone(
    app: AppHandle,
    token: String,
    url: String,
    name: String,
    use_as_library: bool,
    op_id: String,
    open_paths: Vec<String>,
) -> Result<RootState, GitError> {
    run(app, move |app| {
        let st = app.state::<GitState>();
        let reg = st.register_cancel(op_id);
        // Everything is authorized before git runs at all.
        st.check_enabled()?;
        check_name(&name)?;
        // Kept until the clone succeeds, so a failed one can be retried.
        let parent = st.pick(&token).ok_or_else(|| {
            GitError::new(GitKind::NotAllowed, "pick the folder to clone into again")
        })?;
        let dest = parent.join(&name);
        let g = app.state::<Grants>();
        // Checked before cloning, so a refused folder is never made. As the
        // Library, `use_root` takes any folder (the destination can't be a
        // drive root or the home folder: it is new, inside the parent).
        if !use_as_library
            && let Some(r) = added::refusal(
                &dest,
                g.root_place().as_deref(),
                &g.added(),
                home().as_deref(),
                false,
            )
        {
            return Err(GitError::new(GitKind::Refused, r.message()));
        }
        let _busy = st.lock(key(&dest))?;
        let git = st.git()?;
        clone_into(&git, &url, &dest, &reg.flag)?;
        st.take_pick(&token);
        let data = data_dir(app).map_err(from_file)?;
        let state = if use_as_library {
            // As `library_choose`: the Files the UI holds stay granted.
            use_root(&g, &data, &dest, &open_paths)
        } else {
            add_folder(&g, &data, &dest)
        }
        .map_err(from_file)?;
        sync_added_watchers(app, &g);
        Ok(state)
    })
    .await
}

/// Asks the clone running under `op_id` to stop; nothing if there is none.
/// Works with the setting off too: it runs nothing, and turning sync off
/// lets a running clone finish, so this stays the way out of it.
#[tauri::command]
pub async fn git_cancel(app: AppHandle, op_id: String) -> Result<(), GitError> {
    let st = app.state::<GitState>();
    st.cancel(&op_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refusals_map_to_refused_with_their_text() {
        let e = from_file(FileError::Io(std::io::Error::other(
            Refusal::InLibrary.message(),
        )));
        assert_eq!(e.kind, GitKind::Refused);
        assert_eq!(e.detail, Refusal::InLibrary.message());
        assert_eq!(from_file(FileError::NotGranted).kind, GitKind::NotAllowed);
        assert_eq!(from_file(FileError::Exists).kind, GitKind::Failed);
    }
}
