//! Paths that reach Zukai from outside the webview: this process's argv, a
//! second launch, a drop on the window. Rust classifies and grants them, then
//! tells the UI; the webview can never ask for a path to be granted.

use super::grants::Grants;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub const OPEN_PATHS_EVENT: &str = "zukai://open-paths";

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Classified {
    pub files: Vec<PathBuf>,
    pub folders: Vec<PathBuf>,
    pub missing: Vec<PathBuf>,
}

/// Splits paths into files, folders and ones that don't exist.
pub fn classify(paths: Vec<PathBuf>) -> Classified {
    let mut out = Classified::default();
    for p in paths {
        match std::fs::metadata(&p) {
            Ok(m) if m.is_dir() => out.folders.push(p),
            Ok(_) => out.files.push(p),
            Err(_) => out.missing.push(p),
        }
    }
    out
}

/// The paths in a command line: argv[0] and flags (`--capture`) are skipped,
/// relative entries resolve against the launching process's `cwd`.
pub fn argv_paths(argv: &[String], cwd: &Path) -> Vec<PathBuf> {
    argv.iter()
        .skip(1)
        .filter(|a| !a.is_empty() && !a.starts_with("--"))
        .map(|a| {
            let p = Path::new(a);
            if p.is_absolute() {
                p.to_path_buf()
            } else {
                cwd.join(p)
            }
        })
        .collect()
}

#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
pub struct OpenPaths {
    pub paths: Vec<String>,
    pub folders: Vec<String>,
    pub missing: Vec<String>,
}

fn lossy(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Classifies `paths` and grants the files (blocking: file system work).
pub fn resolve(grants: &Grants, paths: Vec<PathBuf>) -> OpenPaths {
    let c = classify(paths);
    let mut out = OpenPaths {
        folders: c.folders.iter().map(|p| lossy(p)).collect(),
        missing: c.missing.iter().map(|p| lossy(p)).collect(),
        ..OpenPaths::default()
    };
    for file in c.files {
        match grants.grant(&file) {
            Ok(granted) => match granted.to_str() {
                Some(s) => out.paths.push(s.to_owned()),
                None => out.missing.push(lossy(&file)),
            },
            // Not openable (unreadable, relative): reported as missing.
            Err(_) => out.missing.push(lossy(&file)),
        }
    }
    out
}

fn emit_paths(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    let app = app.clone();
    // Granting touches the file system: keep it off the caller's thread.
    std::thread::spawn(move || {
        let payload = resolve(&app.state::<Grants>(), paths);
        let _ = app.emit(OPEN_PATHS_EVENT, payload);
    });
}

/// A second launch (single-instance): queued if the UI hasn't taken the
/// launch paths yet (several "Open with" processes can start at once, before
/// the first instance's UI listens), otherwise granted and sent to the UI.
pub fn emit(app: &AppHandle, argv: &[String], cwd: &Path) {
    queue_or_emit(app, argv_paths(argv, cwd));
}

fn queue_or_emit(app: &AppHandle, paths: Vec<PathBuf>) {
    if let Some(paths) = app.state::<LaunchPaths>().add_or_return(paths) {
        emit_paths(app, paths);
    }
}

/// Files dropped on the window.
pub fn emit_dropped(app: &AppHandle, paths: Vec<PathBuf>) {
    emit_paths(app, paths);
}

/// This process's own argv (and macOS `Opened` URLs that arrive early),
/// held until the UI has restored its Session and takes them.
#[derive(Default)]
pub struct LaunchPaths(Mutex<LaunchState>);

#[derive(Default)]
struct LaunchState {
    paths: Vec<PathBuf>,
    taken: bool,
}

impl LaunchPaths {
    fn state(&self) -> std::sync::MutexGuard<'_, LaunchState> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Adds this process's own argv. Extends, so paths a second launch
    /// queued first are kept; this process's own come first.
    pub fn set(&self, paths: Vec<PathBuf>) {
        let mut st = self.state();
        let queued = std::mem::replace(&mut st.paths, paths);
        st.paths.extend(queued);
    }

    /// Queues `paths` for the UI if it hasn't taken the launch paths yet.
    /// Returns them back when it has (the caller then emits instead).
    pub fn add_or_return(&self, paths: Vec<PathBuf>) -> Option<Vec<PathBuf>> {
        let mut st = self.state();
        if st.taken {
            Some(paths)
        } else {
            st.paths.extend(paths);
            None
        }
    }

    fn take(&self) -> Vec<PathBuf> {
        let mut st = self.state();
        st.taken = true;
        std::mem::take(&mut st.paths)
    }
}

/// Brings the main window to the front (unminimised, shown, focused).
pub fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Paths opened by the OS (macOS Finder, Open With): queued if the UI is
/// still starting (it shows the window itself once restored), otherwise the
/// window comes to the front and they're sent like a second launch.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn opened(app: &AppHandle, paths: Vec<PathBuf>) {
    if let Some(paths) = app.state::<LaunchPaths>().add_or_return(paths) {
        focus_main(app);
        emit_paths(app, paths);
    }
}

/// The paths from this process's own argv, granted, once. Folders and missing
/// paths are returned too, so the UI can tell the user about them.
#[tauri::command]
pub async fn take_launch_paths(app: AppHandle) -> OpenPaths {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = app.state::<LaunchPaths>().take();
        resolve(&app.state::<Grants>(), paths)
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argv_split_into_files_folders_missing() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        std::fs::write(&file, "x").unwrap();
        let folder = dir.path().join("sub");
        std::fs::create_dir(&folder).unwrap();
        let missing = dir.path().join("nope.txt");

        let c = classify(vec![file.clone(), folder.clone(), missing.clone()]);
        assert_eq!(c.files, [file]);
        assert_eq!(c.folders, [folder]);
        assert_eq!(c.missing, [missing]);
    }

    #[test]
    fn argv_skips_program_and_flags_and_resolves_relative() {
        let cwd = tempfile::tempdir().unwrap();
        let abs = cwd.path().join("abs.txt");
        let argv = vec![
            "zukai".to_owned(),
            "--capture".to_owned(),
            "rel.txt".to_owned(),
            abs.to_str().unwrap().to_owned(),
        ];
        assert_eq!(
            argv_paths(&argv, cwd.path()),
            [cwd.path().join("rel.txt"), abs]
        );
    }

    #[test]
    fn resolve_grants_files_canonically() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        std::fs::write(&file, "x").unwrap();
        let g = Grants::default();
        let out = resolve(&g, vec![file, dir.path().to_path_buf()]);
        assert_eq!(out.paths.len(), 1);
        assert!(g.check(&out.paths[0]).is_ok());
        assert_eq!(out.folders.len(), 1);
        assert!(out.missing.is_empty());
    }

    #[test]
    fn launch_paths_are_taken_once() {
        let l = LaunchPaths::default();
        l.set(vec![PathBuf::from("/x")]);
        assert!(l.add_or_return(vec![PathBuf::from("/y")]).is_none());
        assert_eq!(l.take().len(), 2);
        assert!(l.take().is_empty());
        // Once taken, later paths are handed back for emitting.
        assert!(l.add_or_return(vec![PathBuf::from("/z")]).is_some());
    }

    #[test]
    fn second_launch_paths_queued_before_set_survive_set() {
        // Several "Open with" processes start at once: a second launch can
        // reach the first instance before its setup records its own argv.
        let l = LaunchPaths::default();
        assert!(l.add_or_return(vec![PathBuf::from("/b")]).is_none());
        l.set(vec![PathBuf::from("/a")]);
        assert!(l.add_or_return(vec![PathBuf::from("/c")]).is_none());
        assert_eq!(
            l.take(),
            [
                PathBuf::from("/a"),
                PathBuf::from("/b"),
                PathBuf::from("/c")
            ]
        );
        // After take, a later launch is handed back to be emitted.
        assert_eq!(
            l.add_or_return(vec![PathBuf::from("/d")]),
            Some(vec![PathBuf::from("/d")])
        );
    }
}
