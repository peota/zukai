//! Watching the open Files for changes made by other programs (spec §5.5).

use super::FileError;
use super::grants::{self, Grants};
use notify::RecursiveMode;
use notify_debouncer_mini::{DebounceEventResult, DebouncedEventKind, Debouncer, new_debouncer};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
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
pub struct Watcher {
    active: Mutex<Option<Active>>,
    /// Held across build and swap, so callers never interleave; holds the
    /// ticket of the set currently applied.
    gate: Mutex<u64>,
    issued: AtomicU64,
    /// The Files of the set currently applied.
    files: Mutex<Vec<PathBuf>>,
}

impl Watcher {
    /// Numbers a request in arrival order; a later number always wins.
    pub fn ticket(&self) -> u64 {
        self.issued.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Watches exactly `files` (canonical paths), replacing the previous set.
    #[cfg(test)]
    pub fn set(&self, files: Vec<PathBuf>, sink: Sink) -> Result<(), FileError> {
        self.set_ordered(self.ticket(), files, sink)
    }

    /// Like `set`, but a request older than one already applied is discarded
    /// (blocking threads can finish out of order). Parent folders are watched
    /// non-recursively, because many editors save by deleting and renaming,
    /// which loses a watch on the file itself.
    pub fn set_ordered(
        &self,
        ticket: u64,
        files: Vec<PathBuf>,
        sink: Sink,
    ) -> Result<(), FileError> {
        let mut applied = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        if ticket < *applied {
            return Ok(());
        }
        let new = if files.is_empty() {
            None
        } else {
            Some(start(files.clone(), sink)?)
        };
        *applied = ticket;
        *self.files.lock().unwrap_or_else(|e| e.into_inner()) = files;
        let old = std::mem::replace(
            &mut *self.active.lock().unwrap_or_else(|e| e.into_inner()),
            new,
        );
        drop(old);
        Ok(())
    }

    /// Stops watching (closing every folder handle) and returns the Files
    /// that were watched, for `restore`. Windows refuses to rename a folder
    /// while a handle is open inside it.
    pub fn suspend(&self) -> Vec<PathBuf> {
        let _applied = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        drop(self.active.lock().unwrap_or_else(|e| e.into_inner()).take());
        std::mem::take(&mut *self.files.lock().unwrap_or_else(|e| e.into_inner()))
    }

    /// Watches `files` again after `suspend`, unless a newer set arrives.
    pub fn restore(&self, files: Vec<PathBuf>, sink: Sink) -> Result<(), FileError> {
        self.set_ordered(self.ticket(), files, sink)
    }
}

/// Sends changes to the UI.
pub fn app_sink(app: &AppHandle) -> Sink {
    let app = app.clone();
    Arc::new(move |change| {
        let _ = app.emit(FILE_CHANGED_EVENT, change);
    })
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
        let report = |file: &PathBuf| {
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
        };
        let Ok(events) = res else {
            // Events may have been lost (rescan, overflow): have the UI
            // re-check every watched File.
            by_key.values().for_each(report);
            return;
        };
        let mut seen = HashSet::new();
        for event in events {
            // `AnyContinuous` repeats every window during a burst; wait for
            // the settled `Any`, so half-written content isn't reloaded.
            if event.kind != DebouncedEventKind::Any {
                continue;
            }
            let key = grants::key(&event.path);
            let Some(file) = by_key.get(&key) else {
                continue;
            };
            if seen.insert(key) {
                report(file);
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
    let ticket = app.state::<Watcher>().ticket();
    tauri::async_runtime::spawn_blocking(move || {
        let grants: State<Grants> = app.state();
        let files: Vec<PathBuf> = paths.iter().filter_map(|p| grants.check(p).ok()).collect();
        app.state::<Watcher>()
            .set_ordered(ticket, files, app_sink(&app))
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

    /// Drops events still in flight from creating the fixtures.
    fn drain(rx: &Receiver<FileChange>) {
        while rx.recv_timeout(Duration::from_millis(500)).is_ok() {}
    }

    fn setup(name: &str) -> (tempfile::TempDir, PathBuf, Watcher, Receiver<FileChange>) {
        let dir = tempfile::tempdir().unwrap();
        let file = grants::canonical(dir.path()).unwrap().join(name);
        std::fs::write(&file, "one").unwrap();
        let watcher = Watcher::default();
        let (sink, rx) = sink_pair();
        watcher.set(vec![file.clone()], sink).unwrap();
        drain(&rx);
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
        // A burst longer than the debounce window. The debouncer emits `Any`
        // only once a path has been quiet for the whole window, so a burst
        // with no long pause yields one event. A scheduler stall on a slow
        // runner can still open a real quiet period, so record the gaps.
        let mut last = Instant::now();
        let mut max_gap = Duration::ZERO;
        let mut quiet_periods = 1;
        for i in 0..50 {
            std::fs::write(&file, format!("v{i}")).unwrap();
            let now = Instant::now();
            if i > 0 {
                max_gap = max_gap.max(now - last);
                // Close to the window: the debouncer may legitimately split.
                if now - last >= Duration::from_millis(150) {
                    quiet_periods += 1;
                }
            }
            last = now;
            std::thread::sleep(Duration::from_millis(10));
        }
        let first = next(&rx);
        assert_eq!(first.kind, Kind::Changed);
        assert_eq!(first.path, file.to_str().unwrap());
        // Collect anything else, waiting longer than the debounce window.
        let mut events = 1;
        while rx.recv_timeout(Duration::from_millis(600)).is_ok() {
            events += 1;
        }
        if quiet_periods == 1 {
            assert_eq!(events, 1, "continuous burst (max gap {max_gap:?}) split");
        } else {
            eprintln!(
                "note: writes paused up to {max_gap:?}; burst split into {quiet_periods}                  quiet periods, got {events} events"
            );
            assert!(
                events <= quiet_periods,
                "{events} events for {quiet_periods} quiet periods"
            );
        }
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
        assert!(rx2.recv_timeout(Duration::from_millis(600)).is_err());
    }

    #[test]
    fn suspend_stops_and_restore_resumes() {
        let (_dir, file, w, rx) = setup("a.txt");
        assert_eq!(w.suspend(), vec![file.clone()]);
        std::fs::write(&file, "while suspended").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(600)).is_err());
        let (sink, rx2) = sink_pair();
        w.restore(vec![file.clone()], sink).unwrap();
        drain(&rx2);
        std::fs::write(&file, "after").unwrap();
        assert_eq!(next(&rx2).kind, Kind::Changed);
    }

    #[test]
    fn stale_ticket_is_discarded() {
        let (_dir, file, w, rx) = setup("a.txt");
        let (newer_sink, rx_new) = sink_pair();
        let t_old = w.ticket();
        let t_new = w.ticket();
        w.set_ordered(t_new, vec![file.clone()], newer_sink)
            .unwrap();
        // The older request finishes last and must not replace the newer set.
        let (older_sink, rx_old) = sink_pair();
        w.set_ordered(t_old, Vec::new(), older_sink).unwrap();
        drain(&rx_new);
        std::fs::write(&file, "changed").unwrap();
        assert_eq!(next(&rx_new).kind, Kind::Changed);
        assert!(rx_old.try_recv().is_err());
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
    }
}
