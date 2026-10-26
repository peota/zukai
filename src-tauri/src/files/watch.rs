//! Watching the open Files for changes made by other programs (spec §5.5).

use super::FileError;
use super::grants::{self, Grants};
use notify::RecursiveMode;
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

pub const FILE_CHANGED_EVENT: &str = "zukai://file-changed";
pub const DEBOUNCE: Duration = Duration::from_millis(200);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Changed,
    Removed,
}

/// `path` is the granted canonical string, exactly what the UI stores.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileChange {
    pub path: String,
    pub kind: Kind,
}

pub type Sink = Arc<dyn Fn(FileChange) + Send + Sync>;

type Active = Debouncer<notify::RecommendedWatcher>;

/// Managed state: the current watcher, replaced wholesale by `file_watch`.
#[derive(Default)]
pub struct Watcher(Mutex<Option<Active>>);

impl Watcher {
    /// Watches exactly `files` (canonical paths), replacing the previous set.
    /// Parent folders are watched non-recursively, because many editors save
    /// by deleting and renaming, which loses a watch on the file itself.
    pub fn set(&self, files: Vec<PathBuf>, sink: Sink) -> Result<(), FileError> {
        let new = if files.is_empty() {
            None
        } else {
            Some(start(files, sink)?)
        };
        let old = std::mem::replace(&mut *self.0.lock().unwrap_or_else(|e| e.into_inner()), new);
        drop(old);
        Ok(())
    }
}

fn start(files: Vec<PathBuf>, sink: Sink) -> Result<Active, FileError> {
    let by_key: HashMap<String, PathBuf> =
        files.iter().map(|f| (grants::key(f), f.clone())).collect();
    let mut folders: Vec<PathBuf> = files
        .iter()
        .filter_map(|f| f.parent().map(|p| p.to_path_buf()))
        .collect();
    folders.sort();
    folders.dedup();

    let mut debouncer = new_debouncer(DEBOUNCE, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let mut seen = HashSet::new();
        for event in events {
            let key = grants::key(&event.path);
            let Some(file) = by_key.get(&key) else {
                continue;
            };
            if !seen.insert(key) {
                continue;
            }
            // A rename-over (atomic save) reports a remove or rename too:
            // what the file is now decides.
            let kind = if file.exists() {
                Kind::Changed
            } else {
                Kind::Removed
            };
            if let Some(path) = file.to_str() {
                sink(FileChange {
                    path: path.to_owned(),
                    kind,
                });
            }
        }
    })
    .map_err(notify_error)?;
    for folder in folders {
        // A folder that is gone can't be watched; its Files report nothing.
        let _ = debouncer
            .watcher()
            .watch(&folder, RecursiveMode::NonRecursive);
    }
    Ok(debouncer)
}

fn notify_error(e: notify::Error) -> FileError {
    FileError::Io(std::io::Error::other(e))
}

/// Replaces the watched set. Paths that aren't granted are ignored.
#[tauri::command]
pub async fn file_watch(app: AppHandle, paths: Vec<String>) -> Result<(), FileError> {
    tauri::async_runtime::spawn_blocking(move || {
        let grants: State<Grants> = app.state();
        let files: Vec<PathBuf> = paths.iter().filter_map(|p| grants.check(p).ok()).collect();
        let sink: Sink = {
            let app = app.clone();
            Arc::new(move |change| {
                let _ = app.emit(FILE_CHANGED_EVENT, change);
            })
        };
        app.state::<Watcher>().set(files, sink)
    })
    .await
    .map_err(|e| FileError::Io(std::io::Error::other(e)))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{Receiver, channel};
    use std::time::Instant;

    fn sink_pair() -> (Sink, Receiver<FileChange>) {
        let (tx, rx) = channel();
        let tx = Mutex::new(tx);
        let sink: Sink = Arc::new(move |c| {
            let _ = tx.lock().unwrap().send(c);
        });
        (sink, rx)
    }

    fn setup(name: &str) -> (tempfile::TempDir, PathBuf, Watcher, Receiver<FileChange>) {
        let dir = tempfile::tempdir().unwrap();
        let file = grants::canonical(dir.path()).unwrap().join(name);
        std::fs::write(&file, "one").unwrap();
        let watcher = Watcher::default();
        let (sink, rx) = sink_pair();
        watcher.set(vec![file.clone()], sink).unwrap();
        // Let the OS watcher settle before the test touches the file.
        std::thread::sleep(Duration::from_millis(100));
        (dir, file, watcher, rx)
    }

    /// The next event, waiting at most 3 s.
    fn next(rx: &Receiver<FileChange>) -> FileChange {
        rx.recv_timeout(Duration::from_secs(3))
            .expect("no event within 3 s")
    }

    #[test]
    fn debounced_events_coalesce_per_path() {
        let (_dir, file, _w, rx) = setup("a.txt");
        for i in 0..50 {
            std::fs::write(&file, format!("v{i}")).unwrap();
        }
        let first = next(&rx);
        assert_eq!(first.kind, Kind::Changed);
        assert_eq!(first.path, file.to_str().unwrap());
        // Nothing more for the same burst, well past the debounce window.
        assert!(rx.recv_timeout(Duration::from_millis(600)).is_err());
    }

    #[test]
    fn delete_reports_removed() {
        let (_dir, file, _w, rx) = setup("a.txt");
        std::fs::remove_file(&file).unwrap();
        let start = Instant::now();
        loop {
            let c = next(&rx);
            if c.kind == Kind::Removed {
                assert_eq!(c.path, file.to_str().unwrap());
                break;
            }
            assert!(start.elapsed() < Duration::from_secs(3));
        }
    }

    #[test]
    fn atomic_replace_reports_changed_not_removed() {
        let (dir, file, _w, rx) = setup("a.txt");
        let tmp = dir.path().join("a.txt.tmp");
        std::fs::write(&tmp, "replacement").unwrap();
        std::fs::rename(&tmp, &file).unwrap();
        let c = next(&rx);
        assert_eq!(c.kind, Kind::Changed);
        assert_eq!(c.path, file.to_str().unwrap());
        // The temp file is not a watched File; no further event arrives.
        assert!(rx.recv_timeout(Duration::from_millis(600)).is_err());
    }

    #[test]
    fn unrelated_siblings_are_ignored() {
        let (dir, _file, _w, rx) = setup("a.txt");
        std::fs::write(dir.path().join("other.txt"), "x").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(600)).is_err());
    }

    #[test]
    fn set_replaces_the_watched_set() {
        let (_dir, file, w, rx) = setup("a.txt");
        let (sink, rx2) = sink_pair();
        w.set(Vec::new(), sink).unwrap();
        std::fs::write(&file, "changed").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(600)).is_err());
        assert!(rx2.try_recv().is_err());
    }
}
