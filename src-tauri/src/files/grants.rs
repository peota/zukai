//! The allowlist of File paths the webview may touch (spec §8).
//!
//! Paths enter it only from Rust-side sources: the dialogs, the Session that
//! Rust reads at startup, and a rename or Save As of an already granted File.

use super::FileError;
use serde_json::Value;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct Grants {
    files: Mutex<HashMap<String, PathBuf>>,
    /// The granted roots and their hints, behind one lock so a recovery
    /// can't undo a root chosen meanwhile. Index 0 is always the Library
    /// (possibly empty); the added folders follow in the order added.
    roots: Mutex<Vec<RootSlot>>,
    /// How many times `recover` looked at the disk (tests only).
    #[cfg(test)]
    probes: std::sync::atomic::AtomicUsize,
}

#[derive(Default)]
struct RootSlot {
    /// The canonical root, set only by Rust (`library.json` or the folder
    /// dialog).
    root: Option<PathBuf>,
    /// Where the root is, even while its folder is unavailable (the stored
    /// root of an unplugged drive): paths under it are only ever granted,
    /// and used, through the root checks.
    hint: Option<PathBuf>,
    /// The stored spelling of the root, kept after loading or recovering
    /// it canonicalized it differently: grants stored under that spelling
    /// are still paths in this root, re-checked on every use.
    stored: Option<PathBuf>,
    /// When `recover` last found the hint's folder missing: a dead network
    /// share isn't asked again on every check (`RECOVER_MISS_TTL`).
    missed: Option<Instant>,
}

impl RootSlot {
    /// A granted root `canon`, loaded from `stored`.
    fn granted(canon: PathBuf, stored: &Path) -> Self {
        RootSlot {
            root: Some(canon.clone()),
            stored: (canon.as_os_str() != stored.as_os_str()).then(|| stored.to_path_buf()),
            hint: Some(canon),
            missed: None,
        }
    }

    /// A root that can't be granted now: only its stored path is known.
    fn hinted(stored: &Path) -> Self {
        RootSlot {
            hint: Some(stored.to_path_buf()),
            ..RootSlot::default()
        }
    }

    /// The root, or the hint while it has none: where the sidebar shows it.
    fn place(&self) -> Option<&PathBuf> {
        self.root.as_ref().or(self.hint.as_ref())
    }

    /// True if `p` is lexically under one of its spellings.
    fn holds(&self, p: &Path) -> bool {
        [&self.root, &self.hint, &self.stored]
            .into_iter()
            .flatten()
            .any(|base| under_by_key(p, base))
    }

    /// True if `p` names this slot (by key): its root, hint or stored path.
    fn named(&self, p: &Path) -> bool {
        [&self.root, &self.hint, &self.stored]
            .into_iter()
            .flatten()
            .any(|base| key(base) == key(p))
    }
}

/// The slot `p` lexically sits under. A granted root wins over a hint or
/// stored spelling; among the granted roots, and among the others, the
/// deepest wins, so a root (or stale hint) covering another root never
/// decides for a path in that root.
fn slot_of(slots: &[RootSlot], p: &Path) -> Option<usize> {
    if let Some((_, i)) = slots
        .iter()
        .enumerate()
        .filter_map(|(i, s)| {
            let r = s.root.as_ref().filter(|r| under_by_key(p, r))?;
            Some((r.components().count(), std::cmp::Reverse(i)))
        })
        .max()
    {
        return Some(i.0);
    }
    slots
        .iter()
        .enumerate()
        .filter_map(|(i, s)| {
            [&s.hint, &s.stored]
                .into_iter()
                .flatten()
                .filter(|base| under_by_key(p, base))
                .map(|base| base.components().count())
                .max()
                .map(|depth| (depth, std::cmp::Reverse(i)))
        })
        .max()
        .map(|(_, std::cmp::Reverse(i))| i)
}

/// Why `candidate` (canonical) may not join the added folders, judged
/// against the Library and every added slot but `except`.
fn overlap(
    slots: &[RootSlot],
    candidate: &Path,
    except: Option<usize>,
    home: Option<&Path>,
) -> Option<crate::library::added::Refusal> {
    let library = slots.first().and_then(RootSlot::place);
    let others: Vec<PathBuf> = slots
        .iter()
        .enumerate()
        .skip(1)
        .filter(|(i, _)| Some(*i) != except)
        .filter_map(|(_, s)| s.place().cloned())
        .collect();
    crate::library::added::refusal(candidate, library.map(PathBuf::as_path), &others, home)
}

/// The refusal as the error the UI shows.
fn refused(r: crate::library::added::Refusal) -> FileError {
    FileError::Io(io::Error::other(r.message()))
}

/// The error for a folder that can't be added.
fn unreadable() -> FileError {
    FileError::Io(io::Error::other("That folder can't be read."))
}

/// The user's home folder, canonical where possible.
fn home() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(dunce::canonicalize(&home).unwrap_or(home))
}

/// How long a failed root recovery is remembered.
const RECOVER_MISS_TTL: Duration = Duration::from_secs(5);

/// Where a path under the Library really leads.
enum Located {
    /// Provably inside the root, as this canonical path.
    Inside(PathBuf),
    /// Can't be decided now: the root isn't there, or an ordinary I/O
    /// error (a permission, a share dropping briefly) got in the way.
    Offline,
    /// A link that leads out of the root, or dangles, was found on its way
    /// (or it isn't a plain path).
    Escapes,
}

/// True if a link that leads out of `root`, or dangles, sits on the way
/// from `root` to `p` (`root` itself included). Only what exists is looked
/// at; an error reading a part is not a link out.
pub(crate) fn link_out_on(p: &Path, root: &Path) -> bool {
    let link_out = |at: &Path| {
        std::fs::symlink_metadata(at).is_ok_and(|m| m.file_type().is_symlink())
            && match dunce::canonicalize(at) {
                Ok(target) => !target.starts_with(root),
                Err(e) => e.kind() == io::ErrorKind::NotFound,
            }
    };
    if link_out(root) {
        return true;
    }
    let mut parts = p.components();
    for _ in root.components() {
        if parts.next().is_none() {
            return false;
        }
    }
    let mut at = root.to_path_buf();
    for c in parts {
        at.push(c);
        if std::fs::symlink_metadata(&at).is_err() {
            return false;
        }
        if link_out(&at) {
            return true;
        }
    }
    false
}

/// True if `canon`, what the stored root `stored` canonicalizes to now, is
/// somewhere else: its key differs and a link (a symlink or a junction)
/// sits at `stored` or one of its folders. A stored root is saved
/// canonical, so a link there appeared since (the folder was replaced by a
/// link to another one): it is not the Library the user chose.
fn resolves_elsewhere(stored: &Path, canon: &Path) -> bool {
    key(stored) != key(canon)
        && stored
            .ancestors()
            .any(|a| std::fs::symlink_metadata(a).is_ok_and(|m| m.file_type().is_symlink()))
}

/// True if `p` is `base` or under it, comparing each part by `key` (so
/// another case of the same folder matches where the file system ignores
/// case).
fn under_by_key(p: &Path, base: &Path) -> bool {
    let mut parts = p.components();
    base.components().all(|b| {
        parts
            .next()
            .is_some_and(|c| key(Path::new(c.as_os_str())) == key(Path::new(b.as_os_str())))
    })
}

/// The real path of `p`, without `\\?\` verbatim prefixes on Windows. A path
/// that doesn't exist yet (a Save As target) is its canonical parent joined
/// with its file name.
pub fn canonical(p: &Path) -> io::Result<PathBuf> {
    match dunce::canonicalize(p) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            let (Some(parent), Some(name)) = (p.parent(), p.file_name()) else {
                return Err(e);
            };
            if parent.as_os_str().is_empty() {
                return Err(e);
            }
            Ok(dunce::canonicalize(parent)?.join(name))
        }
        other => other,
    }
}

/// The allowlist key of an already canonical path: case-folded where the
/// usual file systems are case-insensitive, so one File has one key.
pub fn key(p: &Path) -> String {
    let s = p.to_string_lossy();
    if cfg!(any(windows, target_os = "macos")) {
        s.to_lowercase()
    } else {
        s.into_owned()
    }
}

/// True if a part of `p` ends in a dot or a space. Win32 drops those, so
/// `<root>\...` is the root itself and `<root>\sub.` is `sub`: such a path
/// is never a name the webview may use for an item in the Library. Elsewhere
/// they are ordinary names.
pub fn win32_alias(p: &Path) -> bool {
    cfg!(windows)
        && p.components().any(|c| match c {
            Component::Normal(name) => {
                let name = name.to_string_lossy();
                name.ends_with('.') || name.ends_with(' ')
            }
            _ => false,
        })
}

/// True if `p` is absolute and has no `.` or `..` parts, so it can be
/// trusted as is when it can't be canonicalized.
fn plain_absolute(p: &Path) -> bool {
    p.is_absolute()
        && p.components()
            .all(|c| !matches!(c, Component::CurDir | Component::ParentDir))
}

/// The index of the added slot `p` names (by key).
fn added_index(slots: &[RootSlot], p: &Path) -> Option<usize> {
    (1..slots.len()).find(|&i| slots[i].named(p))
}

/// `canon` (already canonical) if it is `root` or inside it. Compared by
/// components, so `/lib2` is not inside `/lib`. No root, no grant.
fn within_root(canon: PathBuf, root: Option<&Path>) -> Result<PathBuf, FileError> {
    let root = root.ok_or(FileError::NotGranted)?;
    if !canon.starts_with(root) {
        return Err(FileError::NotGranted);
    }
    // `canonical` resolves every existing link, so a link left in the
    // last place is dangling: a write there would follow it anywhere.
    if std::fs::symlink_metadata(&canon).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(FileError::NotGranted);
    }
    Ok(canon)
}

/// The deepest part of `p` that exists, and the rest, if `p` is a plain
/// absolute path with no Win32 alias names.
fn existing_part(p: &Path) -> Result<(&Path, &Path), FileError> {
    if !plain_absolute(p) || win32_alias(p) {
        return Err(FileError::NotGranted);
    }
    let mut existing = p;
    while std::fs::symlink_metadata(existing).is_err() {
        existing = existing.parent().ok_or(FileError::NotGranted)?;
    }
    let rest = p
        .strip_prefix(existing)
        .map_err(|_| FileError::NotGranted)?;
    Ok((existing, rest))
}

/// Where `p` (which may not exist, nor its folder) really is, if that is
/// provably inside the canonical root `root` (see `Grants::grant_in_root`).
fn resolve_under(p: &Path, root: &Path) -> Result<PathBuf, FileError> {
    let (existing, rest) = existing_part(p)?;
    let base = canonical(existing).map_err(|_| FileError::NotGranted)?;
    let base = within_root(base, Some(root))?;
    let path = if rest.as_os_str().is_empty() {
        base
    } else {
        base.join(rest)
    };
    // The final guard: exactly the path returned is inside the root.
    within_root(path, Some(root))
}

impl Grants {
    fn map(&self) -> MutexGuard<'_, HashMap<String, PathBuf>> {
        // The map is always consistent; a panic elsewhere doesn't poison it.
        self.files.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn slots(&self) -> MutexGuard<'_, Vec<RootSlot>> {
        // The list is always consistent; a panic elsewhere doesn't poison it.
        let mut slots = self.roots.lock().unwrap_or_else(|e| e.into_inner());
        if slots.is_empty() {
            slots.push(RootSlot::default());
        }
        slots
    }

    /// The canonical Library root, if one is granted.
    pub fn root(&self) -> Option<PathBuf> {
        self.slots()[0].root.clone()
    }

    /// Makes `root` the Library, replacing any earlier one (the added
    /// folders stay), and returns its canonical form. It must be an existing
    /// absolute folder.
    pub fn set_root(&self, root: &Path) -> Result<PathBuf, FileError> {
        let canon = Self::folder(root)?;
        self.slots()[0] = RootSlot {
            root: Some(canon.clone()),
            hint: Some(canon.clone()),
            ..RootSlot::default()
        };
        Ok(canon)
    }

    /// `root` canonical, if it is an existing absolute folder.
    fn folder(root: &Path) -> Result<PathBuf, FileError> {
        if !root.is_absolute() {
            return Err(FileError::NotGranted);
        }
        let canon = dunce::canonicalize(root)?;
        if !canon.is_dir() {
            return Err(FileError::Io(io::Error::other("not a folder")));
        }
        Ok(canon)
    }

    /// `stored` canonical, as a stored root is accepted: an existing
    /// absolute folder that doesn't now resolve somewhere else (see
    /// `resolves_elsewhere`).
    fn load(stored: &Path) -> Result<PathBuf, FileError> {
        let canon = Self::folder(stored)?;
        if resolves_elsewhere(stored, &canon) {
            return Err(FileError::NotGranted);
        }
        Ok(canon)
    }

    /// Grants the stored root `stored` (from `library.json`) like
    /// `set_root`, but refuses it if it now resolves somewhere else (see
    /// `resolves_elsewhere`), and keeps its stored spelling as a Library
    /// path when canonicalizing changed it.
    pub fn load_root(&self, stored: &Path) -> Result<PathBuf, FileError> {
        let canon = Self::load(stored)?;
        self.slots()[0] = RootSlot::granted(canon.clone(), stored);
        Ok(canon)
    }

    /// The stored root while its folder is unavailable (it can't be granted
    /// yet): paths under it are treated as Library paths, never followed.
    pub fn set_root_hint(&self, stored: &Path) {
        let slot = &mut self.slots()[0];
        slot.hint = Some(stored.to_path_buf());
        slot.missed = None;
    }

    /// Replaces every added folder with the stored list (from
    /// `library.json`), each loaded like `load_root`; one that can't be
    /// granted now (or overlaps the Library or an earlier entry) is kept as
    /// a hint only. Returns each path (canonical if available, else as
    /// stored) and whether it is available, in order.
    pub fn load_added(&self, stored: &[PathBuf]) -> Vec<(PathBuf, bool)> {
        // The disk is looked at before the lock is taken.
        let found: Vec<Option<PathBuf>> = stored.iter().map(|s| Self::load(s).ok()).collect();
        let mut slots = self.slots();
        slots.truncate(1);
        let mut out = Vec::with_capacity(stored.len());
        for (s, canon) in stored.iter().zip(found) {
            let canon = canon.filter(|c| overlap(&slots, c, None, None).is_none());
            let slot = match canon {
                Some(c) => RootSlot::granted(c, s),
                None => RootSlot::hinted(s),
            };
            out.push(match &slot.root {
                Some(c) => (c.clone(), true),
                None => (s.clone(), false),
            });
            slots.push(slot);
        }
        out
    }

    /// Adds the folder `dir` beside the Library, last, and returns its
    /// canonical form. Refused (with the message the user sees) if it
    /// overlaps the Library or an added folder, is too broad, or can't be
    /// read.
    pub fn add_root(&self, dir: &Path) -> Result<PathBuf, FileError> {
        let canon = Self::folder(dir).map_err(|_| unreadable())?;
        let home = home();
        let mut slots = self.slots();
        if let Some(r) = overlap(&slots, &canon, None, home.as_deref()) {
            return Err(refused(r));
        }
        slots.push(RootSlot::granted(canon.clone(), &canon));
        Ok(canon)
    }

    /// Puts the folder `dir` in the place of the added folder `old` (its
    /// root, hint or stored path), keeping its position, with the same
    /// checks as `add_root` against everything but `old`. On any error the
    /// list is unchanged.
    pub fn replace_root(&self, old: &Path, dir: &Path) -> Result<PathBuf, FileError> {
        if added_index(&self.slots(), old).is_none() {
            return Err(FileError::NotGranted);
        }
        let canon = Self::folder(dir).map_err(|_| unreadable())?;
        let home = home();
        let mut slots = self.slots();
        // Looked up again: the list may have changed while the lock was free.
        let i = added_index(&slots, old).ok_or(FileError::NotGranted)?;
        if let Some(r) = overlap(&slots, &canon, Some(i), home.as_deref()) {
            return Err(refused(r));
        }
        slots[i] = RootSlot::granted(canon.clone(), &canon);
        Ok(canon)
    }

    /// Forgets the added folder `path` (its root, hint or stored path). The
    /// Library is never touched. Files granted on their own stay granted.
    pub fn remove_root(&self, path: &Path) {
        let mut slots = self.slots();
        if let Some(i) = added_index(&slots, path) {
            slots.remove(i);
        }
    }

    /// The added folders in order: each one's root, or its stored path
    /// while it is unavailable.
    pub fn added(&self) -> Vec<PathBuf> {
        self.slots()
            .iter()
            .skip(1)
            .filter_map(|s| s.place().cloned())
            .collect()
    }

    /// The canonical granted root `p` lexically sits under (the Library or
    /// an added folder): `None` if none, or if that root is unavailable.
    pub fn root_of(&self, p: &Path) -> Option<PathBuf> {
        let slots = self.slots();
        slots[slot_of(&slots, p)?].root.clone()
    }

    /// True if `p` is (lexically) in a granted root: under it, its stored
    /// path, or the stored path's earlier spelling.
    fn in_library(&self, p: &Path) -> bool {
        self.slots().iter().any(|s| s.holds(p))
    }

    /// The root a path `p` (canonical `canon`) is judged by: that of the
    /// slot `p` lexically sits under, which may be unavailable (`None`).
    /// Only a path under no slot at all (another spelling: `\\?\`, an 8.3
    /// name, a link from outside) is judged by where it really leads, as
    /// before there were several roots.
    fn judge_root(&self, p: &Path, canon: &Path) -> Option<PathBuf> {
        let slots = self.slots();
        match slot_of(&slots, p) {
            Some(i) => slots[i].root.clone(),
            // The deepest, as in `slot_of`.
            None => slots
                .iter()
                .filter_map(|s| s.root.as_ref())
                .filter(|r| canon.starts_with(r))
                .max_by_key(|r| r.components().count())
                .cloned(),
        }
    }

    /// Where `p`, a path in a granted root, really leads. `recover`:
    /// whether an unavailable root may be looked for on disk (`recover`).
    fn locate(&self, p: &Path, recover: bool) -> Located {
        let found = {
            let slots = self.slots();
            slot_of(&slots, p).map(|i| (i, slots[i].root.clone()))
        };
        let root = match found {
            Some((_, Some(root))) => Some(root),
            // The list may have changed meanwhile (a slot removed shifts
            // the others): only the root of the slot `p` sits under now
            // may judge it.
            Some((i, None)) if recover => self.recover(i).filter(|r| {
                let slots = self.slots();
                slot_of(&slots, p).and_then(|j| slots[j].root.as_ref()) == Some(r)
            }),
            _ => None,
        };
        let Some(root) = root else {
            return Located::Offline;
        };
        if std::fs::symlink_metadata(&root).is_err() {
            return Located::Offline;
        }
        match resolve_under(p, &root) {
            Ok(path) => Located::Inside(path),
            // The root went away during the check.
            Err(_) if std::fs::symlink_metadata(&root).is_err() => Located::Offline,
            Err(_) if !plain_absolute(p) || win32_alias(p) || link_out_on(p, &root) => {
                Located::Escapes
            }
            // An ordinary I/O error: refuse for now, decide again later.
            Err(_) => Located::Offline,
        }
    }

    /// The stored root of slot `i` came back (a drive plugged in again):
    /// grant it again, with the same checks as at load, so its paths work
    /// without waiting for the UI to ask. A miss is remembered for
    /// `RECOVER_MISS_TTL`, so a dead network share isn't probed on every
    /// check. The disk is looked at outside the lock; the result is applied
    /// (compare-and-set) only if the slot's hint is still the one probed and
    /// no root was granted meanwhile, so a concurrent `use_root` stands. An
    /// added folder that now overlaps another root stays unavailable.
    fn recover(&self, i: usize) -> Option<PathBuf> {
        let hint = {
            let slots = self.slots();
            let slot = slots.get(i)?;
            if slot.root.is_some() {
                return slot.root.clone();
            }
            if slot.missed.is_some_and(|t| t.elapsed() < RECOVER_MISS_TTL) {
                return None;
            }
            slot.hint.clone()?
        };
        #[cfg(test)]
        self.probes
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let found = Self::load(&hint).ok();
        let mut slots = self.slots();
        let slot = slots.get(i)?;
        if slot.root.is_some() || slot.hint.as_ref() != Some(&hint) {
            return slot.root.clone();
        }
        let found = found.filter(|c| i == 0 || overlap(&slots, c, Some(i), None).is_none());
        let slot = &mut slots[i];
        let Some(canon) = found else {
            slot.missed = Some(Instant::now());
            return None;
        };
        if canon.as_os_str() != hint.as_os_str() {
            slot.stored = Some(hint);
        }
        slot.root = Some(canon.clone());
        slot.hint = Some(canon.clone());
        slot.missed = None;
        Some(canon)
    }

    /// Forgets every remembered recovery miss (tests: the drive is back now).
    #[cfg(test)]
    pub fn forget_recover_miss(&self) {
        for slot in self.slots().iter_mut() {
            slot.missed = None;
        }
    }

    /// How many times `recover` probed the disk (tests only).
    #[cfg(test)]
    pub fn recover_probes(&self) -> usize {
        self.probes.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// The canonical form of `p` if it is a granted root or inside one,
    /// else `NotGranted`. A path that doesn't exist yet is checked through
    /// its parent; a link that resolves outside the root `p` sits under (or
    /// dangles) is refused, even one into another granted root.
    pub fn in_root(&self, p: &Path) -> Result<PathBuf, FileError> {
        if !p.is_absolute() || win32_alias(p) {
            return Err(FileError::NotGranted);
        }
        let canon = canonical(p).map_err(|_| FileError::NotGranted)?;
        let root = self.judge_root(p, &canon);
        within_root(canon, root.as_deref())
    }

    /// Like `grant`, for a path that must be inside a granted root, which
    /// may not exist yet, nor its folder (a Missing File that moved with
    /// its parent). Never grants anything not provably inside the root:
    /// the deepest part that exists (a link in the last place is taken as
    /// the link) must pass `in_root`, which refuses links that resolve
    /// outside or dangle; the missing rest is plain names, which can't
    /// lead anywhere else. Win32 alias names are refused.
    pub fn grant_in_root(&self, p: &Path) -> Result<PathBuf, FileError> {
        let path = self.resolve_in_root(p)?;
        if path.is_dir() {
            return Err(FileError::NotAFile);
        }
        self.map().insert(key(&path), path.clone());
        Ok(path)
    }

    /// Where `p` (which may not exist, nor its folder) really is, if that
    /// is provably inside the root it is judged by: see `grant_in_root`.
    fn resolve_in_root(&self, p: &Path) -> Result<PathBuf, FileError> {
        let (existing, _) = existing_part(p)?;
        let canon = canonical(existing).map_err(|_| FileError::NotGranted)?;
        let root = self.judge_root(p, &canon).ok_or(FileError::NotGranted)?;
        resolve_under(p, &root)
    }

    /// A stored grant, re-checked on every use when it lies in the Library:
    /// the folders on its way may have changed since it was granted (a link
    /// to an outside folder renamed into the place of a missing one), and a
    /// write must never follow them out. One that now leads out is dropped;
    /// while the root itself is unavailable (renamed away, a drive offline)
    /// it is refused but kept, so it works again when the root is back.
    /// Grants elsewhere (Files the user opened) are returned as they are.
    ///
    /// `offline_ok`: for bookkeeping only (which Session paths to keep and
    /// save), never for I/O, a grant that can't be decided now still counts.
    fn still_granted(&self, granted: PathBuf, offline_ok: bool) -> Result<PathBuf, FileError> {
        if !self.in_library(&granted) {
            return Ok(granted);
        }
        match self.locate(&granted, true) {
            Located::Inside(_) => Ok(granted),
            Located::Offline if offline_ok => Ok(granted),
            Located::Offline => Err(FileError::NotGranted),
            Located::Escapes => {
                let mut map = self.map();
                if map.get(&key(&granted)) == Some(&granted) {
                    map.remove(&key(&granted));
                }
                Err(FileError::NotGranted)
            }
        }
    }

    /// Allows the webview to use `p` from now on, returning its canonical
    /// form. `p` must be absolute and not a folder. A File whose folder is
    /// gone (a Session entry) is granted as given if it is a plain absolute
    /// path, so the Session can still be saved with it.
    ///
    /// A path in the Library is never followed out of it: it is granted only
    /// as `grant_in_root` would, or, while the root is unavailable, as given
    /// (every use re-checks it against the root, see `still_granted`).
    pub fn grant(&self, p: &Path) -> Result<PathBuf, FileError> {
        self.grant_with(p, true)
    }

    /// `grant`; `recover` see `locate`.
    fn grant_with(&self, p: &Path, recover: bool) -> Result<PathBuf, FileError> {
        if !p.is_absolute() {
            return Err(FileError::NotGranted);
        }
        if self.in_library(p) {
            let path = match self.locate(p, recover) {
                Located::Inside(path) => path,
                Located::Offline if plain_absolute(p) && !win32_alias(p) => p.to_path_buf(),
                _ => return Err(FileError::NotGranted),
            };
            if path.is_dir() {
                return Err(FileError::NotAFile);
            }
            self.map().insert(key(&path), path.clone());
            return Ok(path);
        }
        let path = match canonical(p) {
            Ok(path) => path,
            Err(e) if e.kind() == io::ErrorKind::NotFound && plain_absolute(p) => p.to_path_buf(),
            Err(e) => return Err(e.into()),
        };
        if path.is_dir() {
            return Err(FileError::NotAFile);
        }
        self.map().insert(key(&path), path.clone());
        Ok(path)
    }

    /// The granted path `p` refers to, or `NotGranted`. `p` is either the
    /// granted path byte for byte, or canonicalizes to exactly it or to a
    /// path inside the Library root: a key
    /// match alone could be another file (`a.txt` next to `A.txt` in a
    /// case-sensitive folder). The lock is never held across file system
    /// calls.
    pub fn check(&self, p: &str) -> Result<PathBuf, FileError> {
        self.check_with(p, false)
    }

    /// `check`; `offline_ok` see `still_granted`.
    fn check_with(&self, p: &str, offline_ok: bool) -> Result<PathBuf, FileError> {
        let path = Path::new(p);
        if !path.is_absolute() {
            return Err(FileError::NotGranted);
        }
        let stored = self
            .map()
            .get(&key(path))
            .filter(|g| g.as_os_str() == path.as_os_str())
            .cloned();
        if let Some(granted) = stored {
            return self.still_granted(granted, offline_ok);
        }
        let canon = canonical(path).map_err(|_| FileError::NotGranted)?;
        let stored = self
            .map()
            .get(&key(&canon))
            .filter(|g| g.as_os_str() == canon.as_os_str())
            .cloned();
        if let Some(granted) = stored {
            return self.still_granted(granted, offline_ok);
        }
        // Anything inside the Library root is granted as a folder.
        if win32_alias(path) {
            return Err(FileError::NotGranted);
        }
        let root = self.judge_root(path, &canon);
        within_root(canon, root.as_deref())
    }

    /// Like `check`, but `p` must be spelled exactly as the granted path (for
    /// a path in the Library, exactly its canonical form).
    /// A key match alone could be a different file (another case on a
    /// case-sensitive folder, a Unicode case fold NTFS doesn't do).
    #[cfg(test)]
    pub fn check_exact(&self, p: &str) -> Result<PathBuf, FileError> {
        self.exact(p, self.check(p)?)
    }

    /// `check_exact` for bookkeeping, never I/O: a Library grant that can't
    /// be decided while the root is offline still counts, so the Session
    /// keeps (and can save) its Files. One whose path leads out doesn't.
    pub fn check_exact_stored(&self, p: &str) -> Result<PathBuf, FileError> {
        self.exact(p, self.check_with(p, true)?)
    }

    fn exact(&self, p: &str, granted: PathBuf) -> Result<PathBuf, FileError> {
        if granted.as_os_str() == OsStr::new(p) {
            Ok(granted)
        } else {
            Err(FileError::NotGranted)
        }
    }
}

/// The paths in `paths` that are granted under exactly that spelling, in
/// order: the File paths of a Session the webview may keep and save back.
pub fn filter_exact(grants: &Grants, paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| grants.check_exact_stored(p).is_ok())
        .collect()
}

/// The File path fields of a Session: `tabs[].file.path` and
/// `closed[].tab.file.path`, when they hold strings. Anything else
/// (Scratchpads, a v1 Session, unknown shapes) contributes none.
fn path_slots(v: &mut Value) -> Vec<&mut Value> {
    fn slot(tab: Option<&mut Value>) -> Option<&mut Value> {
        let path = tab?.get_mut("file")?.get_mut("path")?;
        path.is_string().then_some(path)
    }
    let (mut open, mut closed) = (Vec::new(), Vec::new());
    let Some(obj) = v.as_object_mut() else {
        return open;
    };
    // Fields are visited in map order; keep open Tabs before closed ones.
    for (field, value) in obj.iter_mut() {
        let Some(entries) = value.as_array_mut() else {
            continue;
        };
        match field.as_str() {
            "tabs" => open.extend(entries.iter_mut().filter_map(|t| slot(Some(t)))),
            "closed" => closed.extend(entries.iter_mut().filter_map(|c| slot(c.get_mut("tab")))),
            _ => {}
        }
    }
    open.append(&mut closed);
    open
}

/// The File paths in a Session JSON (see `path_slots`); none if it isn't JSON.
pub fn extract_file_paths(json: &str) -> Vec<String> {
    let Ok(mut v) = serde_json::from_str::<Value>(json) else {
        return Vec::new();
    };
    path_slots(&mut v)
        .into_iter()
        .filter_map(|p| p.as_str().map(str::to_owned))
        .collect()
}

/// Grants every File path in the Session read from disk and rewrites each to
/// its granted canonical spelling, so the UI holds exactly the strings
/// `check_session` will accept (a File renamed in case, or reached through a
/// changed symlink, would otherwise lock `session_write` out). A path that
/// can't be granted is left as is. Unchanged JSON is returned verbatim.
pub fn grant_session(grants: &Grants, json: String) -> String {
    let Ok(mut v) = serde_json::from_str::<Value>(&json) else {
        return json;
    };
    let mut changed = false;
    for slot in path_slots(&mut v) {
        let Some(path) = slot.as_str() else { continue };
        // No root recovery per path: `session_read` has just loaded the
        // root, and probing a dead network share once per path would stall
        // startup. While it is unavailable, Library paths are kept as given
        // (Offline) and re-checked on every use.
        let Ok(granted) = grants.grant_with(Path::new(path), false) else {
            continue;
        };
        if let Some(canon) = granted.to_str()
            && canon != path
        {
            *slot = Value::String(canon.to_owned());
            changed = true;
        }
    }
    if changed { v.to_string() } else { json }
}

/// Refuses a Session that names a File the user never opened: otherwise the
/// webview could grant itself paths through the next launch. Each path must
/// be byte-equal to its granted canonical path, because the next
/// `session_read` grants exactly that spelling.
pub fn check_session(grants: &Grants, json: &str) -> Result<(), FileError> {
    for path in extract_file_paths(json) {
        grants.check_exact_stored(&path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn abs(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, "x").unwrap();
        p
    }

    #[test]
    fn slot_of_prefers_a_root_then_the_deepest_hint() {
        let base = if cfg!(windows) {
            PathBuf::from(r"C:\data")
        } else {
            PathBuf::from("/data")
        };
        let (a, b) = (base.join("a"), base.join("b"));
        // A stale Library hint covering both added folders.
        let slots = vec![
            RootSlot::hinted(&base),
            RootSlot::hinted(&a),
            RootSlot::granted(b.clone(), &b),
        ];
        assert_eq!(slot_of(&slots, &a.join("x")), Some(1));
        assert_eq!(slot_of(&slots, &b.join("x")), Some(2));
        assert_eq!(slot_of(&slots, &base.join("c")), Some(0));
        assert_eq!(slot_of(&slots, &base.with_file_name("elsewhere")), None);

        // Granted roots nested (the Library re-pointed over an added
        // folder): the deepest decides.
        let nested = vec![
            RootSlot::granted(base.clone(), &base),
            RootSlot::granted(a.clone(), &a),
        ];
        assert_eq!(slot_of(&nested, &a.join("x")), Some(1));
        assert_eq!(slot_of(&nested, &base.join("c")), Some(0));
    }

    #[test]
    fn grant_rejects_relative_and_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        assert!(matches!(
            g.grant(Path::new("relative.txt")),
            Err(FileError::NotGranted)
        ));
        assert!(matches!(g.grant(dir.path()), Err(FileError::NotAFile)));

        let file = abs(dir.path(), "a.txt");
        let granted = g.grant(&file).unwrap();
        assert_eq!(granted, canonical(&file).unwrap());
        assert!(!granted.to_string_lossy().starts_with(r"\\?\"));

        // A Save As target that doesn't exist yet is granted via its parent.
        let new = dir.path().join("new.txt");
        assert_eq!(
            g.grant(&new).unwrap(),
            canonical(dir.path()).unwrap().join("new.txt")
        );
    }

    #[test]
    fn check_refuses_ungranted() {
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        let a = abs(dir.path(), "a.txt");
        let b = abs(dir.path(), "b.txt");
        let granted = g.grant(&a).unwrap();

        let a_str = a.to_str().unwrap();
        assert_eq!(g.check(a_str).unwrap(), granted);
        assert_eq!(g.check(granted.to_str().unwrap()).unwrap(), granted);
        assert!(matches!(
            g.check(b.to_str().unwrap()),
            Err(FileError::NotGranted)
        ));
        assert!(matches!(g.check("a.txt"), Err(FileError::NotGranted)));
        assert!(matches!(g.check(""), Err(FileError::NotGranted)));
        // A sibling reached through `..` is still the ungranted file.
        let sneaky = dir.path().join("sub").join("..").join("b.txt");
        assert!(matches!(
            g.check(sneaky.to_str().unwrap()),
            Err(FileError::NotGranted)
        ));
    }

    #[test]
    fn granted_file_whose_folder_vanished_stays_granted() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("gone").join("f.txt");
        let g = Grants::default();
        let granted = g.grant(&gone).unwrap();
        assert_eq!(g.check(gone.to_str().unwrap()).unwrap(), granted);
        // But a lexical path with `..` is never trusted uncanonicalized.
        let dotted = dir.path().join("gone").join("..").join("x.txt");
        let _ = g.grant(&dotted); // canonicalizes fine (parent exists) or errs
        let dotted_missing = dir
            .path()
            .join("gone")
            .join("..")
            .join("gone2")
            .join("x.txt");
        assert!(g.grant(&dotted_missing).is_err());
    }

    #[test]
    fn canonical_dedupes_case_on_windows_and_macos() {
        let upper = key(Path::new(r"X\A.json"));
        let lower = key(Path::new(r"x\a.json"));
        #[cfg(any(windows, target_os = "macos"))]
        assert_eq!(upper, lower);
        #[cfg(not(any(windows, target_os = "macos")))]
        assert_ne!(upper, lower);
    }

    #[test]
    fn session_paths_extracted() {
        let json = r#"{
            "version": 2,
            "tabs": [
                { "id": "s1", "kind": "scratchpad" },
                { "id": "f1", "file": { "path": "/home/u/open.txt" } },
                { "id": "f2", "file": { "path": 42 } },
                { "id": "f3", "file": null }
            ],
            "closed": [
                { "tab": { "id": "s2" } },
                { "tab": { "id": "f4", "file": { "path": "/home/u/closed.txt" } } },
                "junk"
            ]
        }"#;
        assert_eq!(
            extract_file_paths(json),
            ["/home/u/open.txt", "/home/u/closed.txt"]
        );
        // A v1 Session, or something unparseable, has no File paths.
        assert!(extract_file_paths(r#"{"tabs":[{"id":"a"}],"closed":[]}"#).is_empty());
        assert!(extract_file_paths("not json").is_empty());
        assert!(extract_file_paths(r#"{"tabs":{"file":{"path":"/x"}}}"#).is_empty());
    }

    #[test]
    fn check_finds_other_spellings_of_a_granted_file() {
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        let granted = g.grant(&abs(dir.path(), "a.txt")).unwrap();
        let exact = granted.to_str().unwrap();
        assert_eq!(g.check(exact).unwrap(), granted);
        #[cfg(any(windows, target_os = "macos"))]
        assert_eq!(g.check(&exact.to_uppercase()).unwrap(), granted);
        #[cfg(windows)]
        assert_eq!(g.check(&format!(r"\\?\{exact}")).unwrap(), granted);
    }

    #[test]
    fn check_never_resolves_a_key_match_to_another_file() {
        // Two files whose keys collide (as `a.txt` and `A.txt` do in a
        // case-sensitive folder on Windows or macOS): a request for one must
        // never resolve to the other.
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        let other = g.grant(&abs(dir.path(), "other.txt")).unwrap();
        let mine = canonical(&abs(dir.path(), "mine.txt")).unwrap();
        g.map().insert(key(&mine), other.clone());
        assert!(matches!(
            g.check(mine.to_str().unwrap()),
            Err(FileError::NotGranted)
        ));
        // The granted one is still reachable by its own spelling.
        assert_eq!(g.check(other.to_str().unwrap()).unwrap(), other);
    }

    #[test]
    fn check_session_requires_the_exact_granted_spelling() {
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        let granted = g.grant(&abs(dir.path(), "a.txt")).unwrap();
        let exact = granted.to_str().unwrap().to_owned();
        let session = |path: &str| {
            serde_json::json!({ "tabs": [{ "file": { "path": path } }], "closed": [] }).to_string()
        };
        assert!(check_session(&g, &session(&exact)).is_ok());
        let upper = exact.replace("a.txt", "A.TXT");
        assert!(matches!(
            check_session(&g, &session(&upper)),
            Err(FileError::NotGranted)
        ));
        #[cfg(windows)]
        assert!(matches!(
            check_session(&g, &session(&format!(r"\\?\{exact}"))),
            Err(FileError::NotGranted)
        ));
    }

    #[test]
    fn grant_session_grants_and_canonicalizes_paths() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        let a = abs(dir.path(), "a.txt");
        let b = abs(dir.path(), "b.txt");
        let roundabout = dir.path().join("sub").join("..").join("a.txt");
        let g = Grants::default();
        let canon_b = canonical(&b).unwrap();
        let json = serde_json::json!({
            "tabs": [{ "id": "s" }, { "file": { "path": roundabout } }],
            "closed": [{ "tab": { "file": { "path": canon_b } } }],
        })
        .to_string();

        let out = grant_session(&g, json);
        let canon_a = canonical(&a).unwrap();
        assert_eq!(
            extract_file_paths(&out),
            [canon_a.to_str().unwrap(), canon_b.to_str().unwrap()]
        );
        assert!(check_session(&g, &out).is_ok());

        // Nothing to rewrite: returned byte for byte.
        let v1 = r#"{ "tabs": [ {"id":"a"} ], "closed": [] }"#.to_string();
        assert_eq!(grant_session(&g, v1.clone()), v1);
        assert_eq!(grant_session(&g, "not json".into()), "not json");
    }

    #[test]
    fn filter_exact_keeps_only_exactly_granted_spellings() {
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        let a = g.grant(&abs(dir.path(), "a.txt")).unwrap();
        let b = abs(dir.path(), "b.txt");
        let exact = a.to_str().unwrap().to_owned();
        let upper = exact.replace("a.txt", "A.TXT");
        let out = filter_exact(
            &g,
            vec![
                exact.clone(),
                b.to_str().unwrap().to_owned(),
                upper,
                "relative.txt".into(),
                exact.clone(),
            ],
        );
        assert_eq!(out, [exact.clone(), exact]);
    }

    #[test]
    fn session_write_refuses_ungranted() {
        let dir = tempfile::tempdir().unwrap();
        let g = Grants::default();
        let a = abs(dir.path(), "a.txt");
        let b = abs(dir.path(), "b.txt");
        // The UI only ever stores the canonical strings Rust returns; the raw
        // temp path may not be one (8.3 names on Windows, /var -> /private/var
        // on macOS).
        let a = g.grant(&a).unwrap();

        let session = |open: &Path, closed: &Path| {
            serde_json::json!({
                "tabs": [{ "id": "s" }, { "file": { "path": open } }],
                "closed": [{ "tab": { "file": { "path": closed } } }],
            })
            .to_string()
        };
        assert!(check_session(&g, &session(&a, &a)).is_ok());
        assert!(matches!(
            check_session(&g, &session(&a, &b)),
            Err(FileError::NotGranted)
        ));
        assert!(matches!(
            check_session(&g, &session(&b, &a)),
            Err(FileError::NotGranted)
        ));
        assert!(check_session(&g, r#"{"tabs":[{"id":"s"}],"closed":[]}"#).is_ok());

        // Another spelling of the granted file passes `check` but not the
        // Session check: only the exact canonical string may be persisted.
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        let alias = canonical(dir.path())
            .unwrap()
            .join("sub")
            .join("..")
            .join("a.txt");
        assert_eq!(g.check(alias.to_str().unwrap()).unwrap(), a);
        assert!(matches!(
            check_session(&g, &session(&alias, &a)),
            Err(FileError::NotGranted)
        ));
    }
}
