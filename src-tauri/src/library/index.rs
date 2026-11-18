//! The Library name index (spec §5.8 item 1): every visible file and folder
//! name in the Library, so search covers folders the tree hasn't listed.
//!
//! Built by a walk on its own thread that never follows links or junctions
//! and skips dotfiles and dot-folders, like `list_dir`; kept current by the
//! Library watcher through `apply`.

use super::ops::{self, Entry, LinkKind};
use crate::files::grants::key;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// How many matches `library_search` returns.
pub const SEARCH_LIMIT: usize = 200;

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub entries: Vec<Entry>,
    /// False while the index is still being built: `entries` is partial.
    pub ready: bool,
}

/// The root's slot.
const ROOT: u32 = 0;

/// One file or folder. Only its own name is stored; paths are rebuilt from
/// the parent chain, which keeps a 100k-entry tree at a few MB.
struct Node {
    parent: u32,
    name: Box<str>,
    /// Empty for files, links and dead slots.
    children: Vec<u32>,
    is_dir: bool,
    link: Option<LinkKind>,
    alive: bool,
}

/// One visible item of a fresh folder listing.
struct Item {
    name: String,
    is_dir: bool,
    link: Option<LinkKind>,
}

#[derive(Default)]
struct State {
    /// Bumped by every (re)start; a walk from an older one stops writing.
    generation: u64,
    /// Canonical; `None` before the first build or after `clear`.
    root: Option<PathBuf>,
    nodes: Vec<Node>,
    /// Dead slots, reused only between builds.
    free: Vec<u32>,
    building: bool,
    ready: bool,
    /// When the current build started.
    started: Option<Instant>,
}

/// Managed state, cheap to clone: the Library watcher holds a clone.
///
/// The walk takes the lock once per folder, after reading it, so a search
/// never waits on the disk.
#[derive(Clone, Default)]
pub struct NameIndex {
    state: Arc<Mutex<State>>,
}

/// The visible items of `dir`, or `None` if it can't be read.
fn read_listing(dir: &Path, root: &Path) -> Option<Vec<Item>> {
    let items = fs::read_dir(dir).ok()?;
    Some(
        items
            .filter_map(Result::ok)
            .filter_map(|item| ops::visible(&item, root))
            .map(|(name, is_dir, link)| Item { name, is_dir, link })
            .collect(),
    )
}

/// Case-insensitive substring test; `query` is already lowercase.
fn matches(name: &str, query: &str) -> bool {
    if query.is_ascii() {
        // An ASCII byte never occurs inside a UTF-8 multi-byte sequence.
        let q = query.as_bytes();
        name.len() >= q.len()
            && name
                .as_bytes()
                .windows(q.len())
                .any(|w| w.eq_ignore_ascii_case(q))
    } else {
        name.to_lowercase().contains(query)
    }
}

impl State {
    /// Starts over for `root`; returns the new generation and the old nodes
    /// (freed by the caller, outside the lock).
    fn fresh(&mut self, root: Option<PathBuf>) -> (u64, Vec<Node>) {
        self.generation += 1;
        self.building = root.is_some();
        self.root = root;
        self.free = Vec::new();
        self.ready = false;
        self.started = self.building.then(Instant::now);
        let nodes = if self.building {
            vec![Node {
                parent: ROOT,
                name: "".into(),
                children: Vec::new(),
                is_dir: true,
                link: None,
                alive: true,
            }]
        } else {
            Vec::new()
        };
        (self.generation, std::mem::replace(&mut self.nodes, nodes))
    }

    fn finish(&mut self, generation: u64) {
        if self.generation == generation {
            self.building = false;
            self.ready = true;
        }
    }

    fn node(&self, id: u32) -> &Node {
        &self.nodes[id as usize]
    }

    fn node_mut(&mut self, id: u32) -> &mut Node {
        &mut self.nodes[id as usize]
    }

    /// The live, real (not linked) folder at `path`, if the index has it.
    fn resolve(&self, path: &Path) -> Option<u32> {
        let rel = path.strip_prefix(self.root.as_ref()?).ok()?;
        let mut id = ROOT;
        for part in rel.components() {
            let Component::Normal(name) = part else {
                return None;
            };
            let name = name.to_str()?;
            let children = &self.node(id).children;
            let exact = children.iter().find(|&&c| &*self.node(c).name == name);
            // Event paths can differ in case where the file system ignores it.
            let child = exact.or_else(|| {
                let want = key(Path::new(name));
                children
                    .iter()
                    .find(|&&c| key(Path::new(&*self.node(c).name)) == want)
            })?;
            id = *child;
        }
        let n = self.node(id);
        (n.alive && n.is_dir && n.link.is_none()).then_some(id)
    }

    fn path_of(&self, mut id: u32) -> Option<PathBuf> {
        let mut parts = Vec::new();
        while id != ROOT {
            let n = self.node(id);
            parts.push(&*n.name);
            id = n.parent;
        }
        let mut path = self.root.clone()?;
        path.extend(parts.into_iter().rev());
        Some(path)
    }

    fn alloc(&mut self, node: Node) -> u32 {
        // While building, queued slots must not be reused under the walk.
        if !self.building
            && let Some(id) = self.free.pop()
        {
            *self.node_mut(id) = node;
            return id;
        }
        self.nodes.push(node);
        u32::try_from(self.nodes.len() - 1).expect("over 4 billion Library entries")
    }

    /// Frees `id` and everything under it; the caller unlinks it from its
    /// parent.
    fn kill(&mut self, id: u32) {
        let mut stack = vec![id];
        while let Some(id) = stack.pop() {
            let n = self.node_mut(id);
            n.alive = false;
            n.name = "".into();
            stack.append(&mut n.children);
            n.children = Vec::new();
            self.free.push(id);
        }
    }

    /// Makes `id`'s children match a fresh listing of it. Returns the new
    /// real folders, whose own contents still need walking.
    fn sync(&mut self, id: u32, items: Vec<Item>) -> Vec<u32> {
        let mut fresh: HashMap<String, Item> =
            items.into_iter().map(|i| (i.name.clone(), i)).collect();
        let old = std::mem::take(&mut self.node_mut(id).children);
        let mut kept = Vec::with_capacity(old.len().max(fresh.len()));
        for c in old {
            let n = self.node(c);
            let same = fresh
                .get(&*n.name)
                .is_some_and(|i| i.is_dir == n.is_dir && i.link == n.link);
            if same {
                fresh.remove(&*n.name);
                kept.push(c);
            } else {
                self.kill(c);
            }
        }
        let mut walk = Vec::new();
        for (_, item) in fresh {
            let walked = item.is_dir && item.link.is_none();
            let c = self.alloc(Node {
                parent: id,
                name: item.name.into_boxed_str(),
                children: Vec::new(),
                is_dir: item.is_dir,
                link: item.link,
                alive: true,
            });
            kept.push(c);
            if walked {
                walk.push(c);
            }
        }
        kept.shrink_to_fit();
        self.node_mut(id).children = kept;
        walk
    }
}

impl NameIndex {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Indexes `root` (canonical) from scratch on a background thread,
    /// replacing any earlier index or build. Returns at once.
    pub fn start_build(&self, root: PathBuf) {
        let (generation, old) = self.lock().fresh(Some(root.clone()));
        let me = self.clone();
        let spawned = std::thread::Builder::new()
            .name("library-index".into())
            .spawn(move || {
                // The old tree is freed here, off the caller's thread.
                drop(old);
                let mut queue = VecDeque::from([(ROOT, root.clone())]);
                me.walk(generation, &root, &mut queue);
                me.lock().finish(generation);
            });
        if spawned.is_err() {
            // No thread: an empty index beats "Searching…" forever.
            self.lock().finish(generation);
        }
    }

    /// Rebuilds the index if `root` is still the one indexed (after a
    /// watcher error, when changes may have been lost).
    pub fn rebuild(&self, root: &Path) {
        if self.root().as_deref() == Some(root) {
            self.start_build(root.to_path_buf());
        }
    }

    /// Rebuilds the index of the current root if its build started longer
    /// than `age` ago. Windows drops watcher events silently when its buffer
    /// overflows, so the UI asks for this when the window regains focus.
    /// Returns whether a rebuild started.
    pub fn rebuild_if_older(&self, age: Duration) -> bool {
        let (root, started) = {
            let s = self.lock();
            (s.root.clone(), s.started)
        };
        let stale = started.is_none_or(|t| t.elapsed() >= age);
        match root {
            Some(root) if stale => {
                self.start_build(root);
                true
            }
            _ => false,
        }
    }

    /// Forgets everything and stops any build (there is no Library root).
    pub fn clear(&self) {
        let (_, old) = self.lock().fresh(None);
        drop(old);
    }

    pub fn root(&self) -> Option<PathBuf> {
        self.lock().root.clone()
    }

    /// Lists each queued folder and syncs it in, breadth first, until the
    /// queue is empty or a newer (re)start takes over.
    fn walk(&self, generation: u64, root: &Path, queue: &mut VecDeque<(u32, PathBuf)>) {
        while let Some((id, dir)) = queue.pop_front() {
            // Unreadable (or gone): keep what the index has.
            let Some(items) = read_listing(&dir, root) else {
                continue;
            };
            let mut s = self.lock();
            if s.generation != generation {
                return;
            }
            // Removed, or renamed, while it was being read.
            if !s.node(id).alive || s.path_of(id).as_deref() != Some(dir.as_path()) {
                continue;
            }
            for c in s.sync(id, items) {
                queue.push_back((c, dir.join(&*s.node(c).name)));
            }
        }
    }

    /// Re-reads each folder in `dirs` (canonical paths whose listing may have
    /// changed) and walks any folder that appeared. A folder the index
    /// doesn't have (not built yet, or outside the root) is skipped; one
    /// that is gone is dropped by its parent's resync.
    pub fn apply(&self, dirs: &[PathBuf]) {
        let (generation, root) = {
            let s = self.lock();
            match &s.root {
                Some(root) => (s.generation, root.clone()),
                None => return,
            }
        };
        let mut queue = VecDeque::new();
        for dir in dirs {
            let Some(items) = read_listing(dir, &root) else {
                continue;
            };
            let mut s = self.lock();
            if s.generation != generation {
                return;
            }
            let Some(id) = s.resolve(dir) else {
                continue;
            };
            let Some(path) = s.path_of(id) else {
                continue;
            };
            for c in s.sync(id, items) {
                queue.push_back((c, path.join(&*s.node(c).name)));
            }
        }
        self.walk(generation, &root, &mut queue);
    }

    /// Up to `limit` entries whose name contains `query`, ignoring case,
    /// shallowest first (the order they were found). An empty query matches
    /// nothing. While a build runs the matches so far come with
    /// `ready: false`.
    pub fn search(&self, query: &str, limit: usize) -> SearchResult {
        let query = query.trim().to_lowercase();
        let s = self.lock();
        let ready = s.ready || s.root.is_none();
        let mut entries = Vec::new();
        if query.is_empty() {
            return SearchResult { entries, ready };
        }
        for (id, n) in s.nodes.iter().enumerate().skip(1) {
            if entries.len() >= limit {
                break;
            }
            if !n.alive || !matches(&n.name, &query) {
                continue;
            }
            let Some(path) = s.path_of(id as u32) else {
                continue;
            };
            let Some(path) = path.to_str() else {
                continue;
            };
            entries.push(Entry {
                name: n.name.to_string(),
                path: path.to_owned(),
                is_dir: n.is_dir,
                link: n.link,
            });
        }
        SearchResult { entries, ready }
    }

    /// Roughly the heap the index holds, for the size notes in tests.
    #[cfg(test)]
    pub fn approx_bytes(&self) -> usize {
        let s = self.lock();
        s.nodes.capacity() * std::mem::size_of::<Node>()
            + s.nodes
                .iter()
                .map(|n| n.name.len() + n.children.capacity() * 4)
                .sum::<usize>()
            + s.free.capacity() * 4
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::library::tests::library;
    use std::fs;
    use std::time::{Duration, Instant};

    /// Polls until the index is ready, at most 30 s.
    pub fn wait_ready(index: &NameIndex) {
        let start = Instant::now();
        while !index.search("", 1).ready {
            assert!(
                start.elapsed() < Duration::from_secs(30),
                "index not ready within 30 s"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn names(r: &SearchResult) -> Vec<&str> {
        let mut v: Vec<&str> = r.entries.iter().map(|e| e.name.as_str()).collect();
        v.sort_unstable();
        v
    }

    #[test]
    fn rebuild_if_older_only_rebuilds_a_stale_index() {
        let (_tmp, _g, root, _outside) = library();
        let index = NameIndex::default();
        assert!(!index.rebuild_if_older(Duration::ZERO), "no root, no build");
        index.start_build(root.clone());
        wait_ready(&index);
        fs::write(root.join("late.md"), "").unwrap();
        assert!(!index.rebuild_if_older(Duration::from_secs(30)));
        assert!(index.search("late", 10).entries.is_empty());
        assert!(index.rebuild_if_older(Duration::ZERO));
        wait_ready(&index);
        assert_eq!(names(&index.search("late", 10)), ["late.md"]);
    }

    #[test]
    fn index_build_runs_in_background_and_search_reports_partial() {
        let (_tmp, _g, root, _outside) = library();
        // 100 folders of 200 files: 20,000 files.
        for d in 0..100 {
            let dir = root.join(format!("dir{d:03}"));
            fs::create_dir(&dir).unwrap();
            for f in 0..200 {
                fs::write(dir.join(format!("file{d:03}-{f:03}.md")), "").unwrap();
            }
        }
        let index = NameIndex::default();

        let t = Instant::now();
        index.start_build(root.clone());
        let started = t.elapsed();
        assert!(
            started < Duration::from_millis(50),
            "start_build took {started:?}"
        );

        let t = Instant::now();
        let early = index.search("file099-", 10);
        let searched = t.elapsed();
        assert!(!early.ready, "a 20,000-file build can't be done already");
        assert!(
            searched < Duration::from_millis(500),
            "search took {searched:?}"
        );
        assert!(early.entries.len() <= 10);

        let t = Instant::now();
        wait_ready(&index);
        let built = t.elapsed();
        let done = index.search("FILE099-", 1000);
        assert!(done.ready);
        assert_eq!(done.entries.len(), 200);
        let e = done
            .entries
            .iter()
            .find(|e| e.name == "file099-007.md")
            .unwrap();
        let expect = root.join("dir099").join("file099-007.md");
        assert_eq!(e.path, expect.to_str().unwrap());
        assert!(!e.is_dir);
        assert_eq!(e.link, None);
        let dir = index.search("dir042", 10);
        assert_eq!(dir.entries.len(), 1);
        assert!(dir.entries[0].is_dir);

        let t = Instant::now();
        let all = index.search("file", usize::MAX);
        let full_scan = t.elapsed();
        assert_eq!(all.entries.len(), 20_000);
        eprintln!(
            "20,000 files: start_build {started:?}, early search {searched:?}, \
             build {built:?}, full search {full_scan:?}, ~{} KiB",
            index.approx_bytes() / 1024
        );
    }

    #[test]
    fn search_is_case_insensitive_and_limited() {
        let (_tmp, _g, root, outside) = library();
        fs::write(root.join("Notes.md"), "").unwrap();
        fs::write(root.join("my-NOTES.MD"), "").unwrap();
        fs::write(root.join("other.md"), "").unwrap();
        fs::create_dir_all(root.join("sub").join("Release Notes")).unwrap();
        fs::write(root.join("sub").join("Release Notes").join("x.md"), "").unwrap();
        fs::write(root.join("Ünïcode nötes.md"), "").unwrap();
        // Dotfiles and everything in dot-folders stay out.
        fs::write(root.join(".notes.md"), "").unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::write(root.join(".git").join("notes"), "").unwrap();
        // Links are indexed by name but never followed.
        fs::write(outside.join("notes-secret.md"), "").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("notes-link")).unwrap();
        #[cfg(windows)]
        crate::library::tests::junction(&root.join("notes-link"), &outside);

        let index = NameIndex::default();
        index.start_build(root.clone());
        wait_ready(&index);

        let r = index.search("nOtEs", 100);
        assert!(r.ready);
        assert_eq!(
            names(&r),
            ["Notes.md", "Release Notes", "my-NOTES.MD", "notes-link"]
        );
        let link = r.entries.iter().find(|e| e.name == "notes-link").unwrap();
        assert_eq!(link.link, Some(LinkKind::Outside));
        assert!(index.search("secret", 100).entries.is_empty());

        // Non-ASCII queries fold case too.
        assert_eq!(names(&index.search("ÜNÏCODE NÖ", 10)), ["Ünïcode nötes.md"]);
        // `limit` caps the matches; an empty query matches nothing.
        assert_eq!(index.search("notes", 2).entries.len(), 2);
        assert!(index.search("", 100).entries.is_empty());
        assert!(index.search("zzz", 100).entries.is_empty());
    }

    #[test]
    fn restart_replaces_the_previous_build() {
        let (_tmp, _g, root, outside) = library();
        fs::write(root.join("in-root.md"), "").unwrap();
        fs::write(outside.join("in-outside.md"), "").unwrap();
        let index = NameIndex::default();
        index.start_build(root.clone());
        index.start_build(outside.clone());
        wait_ready(&index);
        assert_eq!(index.root(), Some(outside.clone()));
        assert!(index.search("in-root", 10).entries.is_empty());
        assert_eq!(index.search("in-", 10).entries.len(), 1);
        // A rebuild for a root that is no longer current does nothing.
        index.rebuild(&root);
        assert_eq!(index.root(), Some(outside));
        index.clear();
        assert_eq!(index.root(), None);
        assert!(index.search("in-", 10).entries.is_empty());
    }

    #[test]
    fn apply_resyncs_the_named_folders() {
        let (_tmp, _g, root, _outside) = library();
        let sub = root.join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("old.md"), "").unwrap();
        let index = NameIndex::default();
        index.start_build(root.clone());
        wait_ready(&index);

        fs::rename(sub.join("old.md"), sub.join("New.md")).unwrap();
        fs::create_dir_all(root.join("added").join("deep")).unwrap();
        fs::write(root.join("added").join("deep").join("needle.md"), "").unwrap();
        index.apply(&[sub.clone(), root.clone()]);
        assert!(index.search("old", 10).entries.is_empty());
        assert_eq!(names(&index.search("new", 10)), ["New.md"]);
        assert_eq!(names(&index.search("needle", 10)), ["needle.md"]);

        fs::remove_dir_all(root.join("added")).unwrap();
        // A folder that is gone is skipped; its parent's resync drops it.
        index.apply(&[root.join("added").join("deep"), root.clone()]);
        assert!(index.search("needle", 10).entries.is_empty());
        assert!(index.search("deep", 10).entries.is_empty());
        // Folders outside the root are ignored.
        index.apply(&[root.parent().unwrap().to_path_buf()]);
        assert_eq!(index.search("", 1).entries.len(), 0);
        assert_eq!(names(&index.search("sub", 10)), ["sub"]);
    }
}
