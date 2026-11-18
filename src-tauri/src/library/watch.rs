//! Watching the whole Library for changes made outside Zukai (spec §5.4).
//!
//! One recursive watch on the root, which never follows links. Each settled
//! batch is turned into the folders whose listing changed: the index is
//! resynced from those, then the UI is told to re-list them. It coexists
//! with the per-File watcher (`files::watch`), which reports content changes
//! of open Files.

use super::index::NameIndex;
use crate::files::FileError;
use crate::files::grants::key;
use notify::{Event, EventHandler, RecommendedWatcher, RecursiveMode, Watcher, WatcherKind};
use notify_debouncer_mini::{
    DebounceEventResult, DebouncedEventKind, Debouncer, new_debouncer_opt,
};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const LIBRARY_CHANGED_EVENT: &str = "zukai://library-changed";
pub const DEBOUNCE: Duration = Duration::from_millis(200);

/// The folders whose listing changed, as canonical strings matching the
/// paths `library_list` returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LibraryChange {
    pub dirs: Vec<String>,
}

pub type Sink = Arc<dyn Fn(LibraryChange) + Send + Sync>;

/// The platform watcher, except that a "rescan" event (the OS dropped
/// events, e.g. an inotify queue overflow) becomes an error. The debouncer
/// would otherwise discard it, as it carries no path, and passes errors
/// straight through.
struct RescanAware(RecommendedWatcher);

impl Watcher for RescanAware {
    fn new<F: EventHandler>(mut handler: F, config: notify::Config) -> notify::Result<Self> {
        RecommendedWatcher::new(
            move |event: notify::Result<Event>| match event {
                Ok(e) if e.need_rescan() => {
                    handler.handle_event(Err(notify::Error::generic("events were lost")));
                }
                other => handler.handle_event(other),
            },
            config,
        )
        .map(Self)
    }

    fn watch(&mut self, path: &Path, mode: RecursiveMode) -> notify::Result<()> {
        self.0.watch(path, mode)
    }

    fn unwatch(&mut self, path: &Path) -> notify::Result<()> {
        self.0.unwatch(path)
    }

    fn kind() -> WatcherKind {
        RecommendedWatcher::kind()
    }
}

type Active = Debouncer<RescanAware>;

/// Managed state: the Library watcher, replaced wholesale by `library_watch`.
#[derive(Default)]
pub struct LibraryWatcher {
    active: Mutex<Option<Active>>,
    /// Held across build and swap, so callers never interleave; holds the
    /// ticket of the request currently applied.
    gate: Mutex<u64>,
    issued: AtomicU64,
}

impl LibraryWatcher {
    /// Numbers a request in arrival order; a later number always wins.
    pub fn ticket(&self) -> u64 {
        self.issued.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Watches and indexes `root` (canonical), or stops both for `None`.
    #[cfg(test)]
    pub fn set(
        &self,
        root: Option<PathBuf>,
        index: &NameIndex,
        sink: Sink,
    ) -> Result<(), FileError> {
        self.set_ordered(self.ticket(), root, index, sink)
    }

    /// Like `set`, but a request older than one already applied is
    /// discarded (blocking threads can finish out of order). The previous
    /// watcher is dropped and the index rebuilt from scratch.
    pub fn set_ordered(
        &self,
        ticket: u64,
        root: Option<PathBuf>,
        index: &NameIndex,
        sink: Sink,
    ) -> Result<(), FileError> {
        let mut applied = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        if ticket < *applied {
            return Ok(());
        }
        let mut active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        // The old watcher stops before the index restarts under the new one.
        drop(active.take());
        *applied = ticket;
        let Some(root) = root else {
            index.clear();
            return Ok(());
        };
        // Watch first, then walk: a change during the walk is either seen by
        // it or applied after it. Search still works without a watcher
        // (some network drives can't be watched); the error is reported.
        let started = start(&root, index.clone(), sink);
        index.start_build(root);
        *active = Some(started?);
        Ok(())
    }

    /// Stops watching (closing the handle on the root) and keeps the index;
    /// `set_ordered` with a fresh ticket starts again.
    pub fn pause(&self) {
        let _applied = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        drop(self.active.lock().unwrap_or_else(|e| e.into_inner()).take());
    }
}

/// The folders whose listing a batch of changed `paths` may have changed:
/// each one's parent, once, in the spelling `list_dir` uses (the canonical
/// root joined with the names). Paths outside the root, the root itself and
/// anything at or under a dot-name (hidden from every listing) are skipped.
fn changed_dirs<'a>(root: &Path, paths: impl IntoIterator<Item = &'a Path>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut dirs = Vec::new();
    for path in paths {
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let hidden = rel.components().any(|c| match c {
            Component::Normal(name) => name.to_string_lossy().starts_with('.'),
            _ => true,
        });
        let Some(parent) = rel.parent() else {
            continue;
        };
        if hidden {
            continue;
        }
        // `root.join("")` would add a trailing separator.
        let dir = if parent.as_os_str().is_empty() {
            root.to_path_buf()
        } else {
            root.join(parent)
        };
        if seen.insert(key(&dir)) {
            dirs.push(dir);
        }
    }
    dirs
}

fn start(root: &Path, index: NameIndex, sink: Sink) -> Result<Active, FileError> {
    let config = notify_debouncer_mini::Config::default()
        .with_timeout(DEBOUNCE)
        .with_notify_config(notify::Config::default().with_follow_symlinks(false));
    let watched = root.to_path_buf();
    let mut debouncer =
        new_debouncer_opt::<_, RescanAware>(config, move |res: DebounceEventResult| {
            let dirs = match res {
                // `AnyContinuous` repeats during a burst; the settled `Any` follows.
                Ok(events) => changed_dirs(
                    &watched,
                    events
                        .iter()
                        .filter(|e| e.kind == DebouncedEventKind::Any)
                        .map(|e| e.path.as_path()),
                ),
                Err(_) => {
                    // Changes may have been lost: the whole tree may differ.
                    index.rebuild(&watched);
                    vec![watched.clone()]
                }
            };
            if dirs.is_empty() {
                return;
            }
            // The index first, so a search prompted by the event sees the change.
            index.apply(&dirs);
            let dirs = dirs
                .iter()
                .filter_map(|d| d.to_str().map(str::to_owned))
                .collect();
            sink(LibraryChange { dirs });
        })
        .map_err(notify_error)?;
    debouncer
        .watcher()
        .watch(root, RecursiveMode::Recursive)
        .map_err(notify_error)?;
    Ok(debouncer)
}

fn notify_error(e: notify::Error) -> FileError {
    FileError::Io(std::io::Error::other(e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::index::tests::wait_ready;
    use crate::library::tests::library;
    use std::fs;
    use std::path::Path;
    use std::sync::Mutex;
    use std::sync::mpsc::{Receiver, channel};
    use std::time::Instant;

    fn sink_pair() -> (Sink, Receiver<LibraryChange>) {
        let (tx, rx) = channel();
        let tx = Mutex::new(tx);
        let sink: Sink = Arc::new(move |c| {
            let _ = tx.lock().unwrap().send(c);
        });
        (sink, rx)
    }

    /// Drops events still in flight from creating the fixtures.
    fn drain(rx: &Receiver<LibraryChange>) {
        while rx.recv_timeout(Duration::from_millis(500)).is_ok() {}
    }

    /// Waits up to 3 s for a batch naming `dir`; other batches are skipped
    /// (some platforms also report the folder's own parent).
    fn expect_dir(rx: &Receiver<LibraryChange>, dir: &Path, what: &str) {
        let want = dir.to_str().unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut seen = Vec::new();
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left) {
                Ok(c) if c.dirs.iter().any(|d| d == want) => {
                    let mut unique = c.dirs.clone();
                    unique.sort();
                    unique.dedup();
                    assert_eq!(unique.len(), c.dirs.len(), "duplicates in {:?}", c.dirs);
                    return;
                }
                Ok(c) => seen.push(c),
                Err(_) => panic!("{what}: no change for {want} within 3 s; got {seen:?}"),
            }
        }
    }

    #[test]
    fn changed_dirs_are_parents_deduplicated_and_visible() {
        let root = std::env::temp_dir().join("lib-root");
        let sub = root.join("sub");
        let paths = [
            sub.join("a.md"),
            sub.join("b.md"),
            root.join("top.md"),
            root.join("sub"),
            root.join(".git").join("index"),
            sub.join(".hidden.md"),
            root.clone(),
            std::env::temp_dir().join("elsewhere.md"),
        ];
        let dirs = changed_dirs(&root, paths.iter().map(PathBuf::as_path));
        assert_eq!(dirs, [sub.clone(), root.clone()]);
        // No trailing separator on the root: it must equal `list_dir`'s spelling.
        assert_eq!(dirs[1].to_str(), root.to_str());
    }

    #[test]
    fn stale_ticket_is_discarded() {
        let (_tmp, _g, root, outside) = library();
        let index = NameIndex::default();
        let w = LibraryWatcher::default();
        let (sink, _rx) = sink_pair();
        let (t_old, t_new) = (w.ticket(), w.ticket());
        w.set_ordered(t_new, Some(root.clone()), &index, sink.clone())
            .unwrap();
        w.set_ordered(t_old, Some(outside), &index, sink).unwrap();
        assert_eq!(index.root(), Some(root));
    }

    #[test]
    fn watch_reports_parent_dirs_of_changes() {
        let (_tmp, _g, root, _outside) = library();
        let sub = root.join("sub");
        fs::create_dir(&sub).unwrap();
        let index = NameIndex::default();
        let w = LibraryWatcher::default();
        let (sink, rx) = sink_pair();
        w.set(Some(root.clone()), &index, sink).unwrap();
        drain(&rx);

        let a = sub.join("a.md");
        fs::write(&a, "a").unwrap();
        expect_dir(&rx, &sub, "create");
        drain(&rx);

        let b = sub.join("b.md");
        fs::rename(&a, &b).unwrap();
        expect_dir(&rx, &sub, "rename");
        drain(&rx);

        fs::remove_file(&b).unwrap();
        expect_dir(&rx, &sub, "delete");
        drain(&rx);

        fs::write(root.join("top.md"), "t").unwrap();
        expect_dir(&rx, &root, "create at the root");
        drain(&rx);

        // Changes inside dot-folders change no listing.
        fs::create_dir(root.join(".git")).unwrap();
        drain(&rx);
        fs::write(root.join(".git").join("index"), "x").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(600)).is_err());

        // Stopping the watcher stops the events.
        let (sink2, rx2) = sink_pair();
        w.set(None, &index, sink2).unwrap();
        fs::write(sub.join("late.md"), "l").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(600)).is_err());
        assert!(rx2.recv_timeout(Duration::from_millis(100)).is_err());
    }

    /// Polls `index` until `cond` holds, at most 3 s.
    fn eventually(index: &NameIndex, what: &str, cond: impl Fn(&NameIndex) -> bool) {
        let start = Instant::now();
        while !cond(index) {
            assert!(
                start.elapsed() < Duration::from_secs(3),
                "{what} within 3 s"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn found(index: &NameIndex, q: &str) -> usize {
        index.search(q, 100).entries.len()
    }

    #[test]
    fn index_tracks_watcher_changes() {
        let (_tmp, _g, root, _outside) = library();
        let sub = root.join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("existing.md"), "").unwrap();
        let index = NameIndex::default();
        let w = LibraryWatcher::default();
        let (sink, rx) = sink_pair();
        w.set(Some(root.clone()), &index, sink).unwrap();
        wait_ready(&index);
        drain(&rx);
        assert_eq!(found(&index, "existing"), 1);

        fs::write(sub.join("fresh-note.md"), "").unwrap();
        eventually(&index, "create", |i| found(i, "fresh-note") == 1);

        fs::rename(sub.join("fresh-note.md"), sub.join("renamed.md")).unwrap();
        eventually(&index, "rename", |i| {
            found(i, "fresh-note") == 0 && found(i, "renamed") == 1
        });

        let deep = root.join("newdir").join("deep");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("needle.md"), "").unwrap();
        eventually(&index, "new folder tree", |i| found(i, "needle") == 1);

        fs::remove_dir_all(root.join("newdir")).unwrap();
        eventually(&index, "folder delete", |i| {
            found(i, "needle") == 0 && found(i, "newdir") == 0
        });
        assert_eq!(found(&index, "existing"), 1);
        assert_eq!(found(&index, "renamed"), 1);
    }
}
