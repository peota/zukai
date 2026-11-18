//! Library file operations (spec §5.3). None of them ever replaces an
//! existing item or deletes anything permanently: names that clash get a
//! free variant, renames refuse, and deletes go to the OS trash or fail.
//!
//! Callers check every path against the folder grant first (`commands.rs`).

use crate::files::FileError;
use crate::files::grants::key;
use crate::files::io::{rename_path_no_replace, validate_stem};
use serde::Serialize;
use std::cmp::Ordering;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

/// How many names `… (n)` / `… n` are tried before giving up with `Exists`.
const MAX_SUFFIX: u32 = 10_000;

/// Longest file name the usual file systems take, in bytes.
const MAX_NAME: usize = 255;

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LinkKind {
    /// A symlink or junction whose target is inside the Library root.
    Inside,
    /// One that resolves outside the root, or dangles: shown, never opened.
    Outside,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// `null` when the entry isn't a link.
    pub link: Option<LinkKind>,
}

/// What a folder listing shows of `item`: its name, whether it is a folder
/// (for a link, whether its target is) and its link kind. `None` for
/// dotfiles, names that aren't UTF-8 (they can't cross to the webview and
/// back) and entries whose type can't be read. Links are classified against
/// `root` (canonical), never descended into.
pub(crate) fn visible(
    item: &fs::DirEntry,
    root: &Path,
) -> Option<(String, bool, Option<LinkKind>)> {
    let name = item.file_name().into_string().ok()?;
    if name.starts_with('.') {
        return None;
    }
    let kind = item.file_type().ok()?;
    if !kind.is_symlink() {
        return Some((name, kind.is_dir(), None));
    }
    let target = dunce::canonicalize(item.path()).ok();
    let inside = target.as_ref().is_some_and(|t| t.starts_with(root));
    let is_dir = target.is_some_and(|t| t.is_dir());
    let link = if inside {
        LinkKind::Inside
    } else {
        LinkKind::Outside
    };
    Some((name, is_dir, Some(link)))
}

/// The visible entries of `dir` (no dotfiles), folders first, each group in
/// natural, case-insensitive order (`a2` before `a10`). Links are not
/// followed, only classified against `root` (canonical).
pub fn list_dir(dir: &Path, root: &Path) -> io::Result<Vec<Entry>> {
    let mut entries = Vec::new();
    for item in fs::read_dir(dir)? {
        // One unreadable entry doesn't hide the rest of the folder.
        let Ok(item) = item else {
            continue;
        };
        let Some((name, is_dir, link)) = visible(&item, root) else {
            continue;
        };
        let Some(path) = item.path().to_str().map(str::to_owned) else {
            continue;
        };
        entries.push(Entry {
            name,
            path,
            is_dir,
            link,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| natural_cmp(&a.name, &b.name))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

/// The run of ASCII digits at the front of `it`, consumed.
fn digits(it: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut run = String::new();
    while let Some(c) = it.next_if(char::is_ascii_digit) {
        run.push(c);
    }
    run
}

/// Case-insensitive order in which runs of digits compare as numbers.
fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        let (c, d) = match (x.peek(), y.peek()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(&c), Some(&d)) => (c, d),
        };
        let ord = if c.is_ascii_digit() && d.is_ascii_digit() {
            let (m, n) = (digits(&mut x), digits(&mut y));
            let (mt, nt) = (m.trim_start_matches('0'), n.trim_start_matches('0'));
            mt.len()
                .cmp(&nt.len())
                .then_with(|| mt.cmp(nt))
                .then_with(|| m.len().cmp(&n.len()))
        } else {
            x.next();
            y.next();
            c.to_lowercase().cmp(d.to_lowercase())
        };
        if ord != Ordering::Equal {
            return ord;
        }
    }
}

fn file_name(stem: &str, ext: &str) -> String {
    if ext.is_empty() {
        stem.to_owned()
    } else {
        format!("{stem}.{ext}")
    }
}

/// Name `n` (from 1) in a series: `paren` gives `stem (2).ext`, otherwise
/// `stem 2.ext` (new items, spec §5.3).
fn nth_name(stem: &str, ext: &str, n: u32, paren: bool) -> String {
    match (n, paren) {
        (1, _) => file_name(stem, ext),
        (n, true) => file_name(&format!("{stem} ({n})"), ext),
        (n, false) => file_name(&format!("{stem} {n}"), ext),
    }
}

/// True if anything (a dangling link included) has this path.
fn taken(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok()
}

/// Tries `place` on each free name of the series, moving on when a name
/// was taken by the time it ran (`Exists`); any other error stops.
fn first_free<T>(
    dir: &Path,
    stem: &str,
    ext: &str,
    paren: bool,
    mut place: impl FnMut(&Path) -> Result<T, FileError>,
) -> Result<T, FileError> {
    for n in 1..=MAX_SUFFIX {
        let candidate = dir.join(nth_name(stem, ext, n, paren));
        if taken(&candidate) {
            continue;
        }
        match place(&candidate) {
            Err(FileError::Exists) => continue,
            other => return other,
        }
    }
    Err(FileError::Exists)
}

fn exists_err(e: io::Error) -> FileError {
    if e.kind() == io::ErrorKind::AlreadyExists {
        FileError::Exists
    } else {
        FileError::Io(e)
    }
}

/// A new folder name or file stem: valid on every OS (like a renamed stem),
/// with room left for a ` 10000` suffix and an extension.
fn validate_name(name: &str) -> Result<(), FileError> {
    validate_stem(name)?;
    if name == "." || name == ".." || name.len() > MAX_NAME - 32 {
        return Err(FileError::InvalidName);
    }
    Ok(())
}

/// Splits an item's name for a ` (2)` suffix: folders keep their whole name.
fn stem_and_ext(path: &Path, is_dir: bool) -> Result<(String, String), FileError> {
    let name = path.file_name().ok_or(FileError::InvalidName)?;
    let name = name.to_str().ok_or(FileError::InvalidName)?;
    if is_dir {
        return Ok((name.to_owned(), String::new()));
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    Ok((stem.to_owned(), ext.to_owned()))
}

/// The first free `stem.ext`, `stem (2).ext`, `stem (3).ext`… in `dir`, for
/// moves and copies. An empty `ext` means no extension (folders).
pub fn unique_name(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    (1..=MAX_SUFFIX)
        .map(|n| dir.join(nth_name(stem, ext, n, true)))
        .find(|p| !taken(p))
        .unwrap_or_else(|| dir.join(nth_name(stem, ext, MAX_SUFFIX + 1, true)))
}

/// A new, empty folder named `name`, `name 2`, `name 3`… in `parent`.
pub fn create_folder(parent: &Path, name: &str) -> Result<PathBuf, FileError> {
    validate_name(name)?;
    first_free(parent, name, "", false, |p| {
        fs::create_dir(p).map_err(exists_err)?;
        Ok(p.to_path_buf())
    })
}

/// A new file `stem.ext`, `stem 2.ext`… in `parent` holding `contents`.
pub fn create_file(
    parent: &Path,
    stem: &str,
    ext: &str,
    contents: &[u8],
) -> Result<PathBuf, FileError> {
    validate_name(stem)?;
    let ext_ok =
        !ext.is_empty() && ext.len() <= 16 && ext.chars().all(|c| c.is_ascii_alphanumeric());
    if !ext_ok {
        return Err(FileError::InvalidName);
    }
    first_free(parent, stem, ext, false, |p| new_file(p, contents))
}

/// Writes `contents` to a file that must not exist yet. If writing fails,
/// the file this call just made is removed again.
fn new_file(path: &Path, contents: &[u8]) -> Result<PathBuf, FileError> {
    use std::io::Write;
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(exists_err)?;
    if let Err(e) = f.write_all(contents).and_then(|()| f.sync_all()) {
        drop(f);
        let _ = fs::remove_file(path);
        return Err(e.into());
    }
    Ok(path.to_path_buf())
}

/// Renames in place without replacing anything. For a file `new_name` is
/// the new stem and the extension is kept; for a folder it is the new name.
pub fn rename_entry(path: &Path, new_name: &str) -> Result<PathBuf, FileError> {
    let meta = fs::symlink_metadata(path)?;
    // A link to a folder renames like a folder.
    let is_dir = meta.is_dir()
        || (meta.file_type().is_symlink() && fs::metadata(path).is_ok_and(|m| m.is_dir()));
    if !is_dir {
        return crate::files::io::rename_no_replace(path, new_name);
    }
    validate_stem(new_name)?;
    if new_name.len() > MAX_NAME {
        return Err(FileError::InvalidName);
    }
    if path.file_name().and_then(|n| n.to_str()) == Some(new_name) {
        return Ok(path.to_path_buf());
    }
    let to = path.with_file_name(new_name);
    rename_path_no_replace(path, &to)?;
    Ok(to)
}

/// Moves `path` into `dest_dir`, taking ` (2)`… on a clash. A folder can't
/// move into itself or a descendant.
pub fn move_entry(path: &Path, dest_dir: &Path) -> Result<PathBuf, FileError> {
    let meta = fs::symlink_metadata(path)?;
    if dest_dir.starts_with(path) {
        return Err(FileError::IntoSelf);
    }
    if path.parent() == Some(dest_dir) {
        return Ok(path.to_path_buf());
    }
    let (stem, ext) = stem_and_ext(path, meta.is_dir())?;
    first_free(dest_dir, &stem, &ext, true, |to| {
        rename_path_no_replace(path, to)?;
        Ok(to.to_path_buf())
    })
}

/// Copies each of `srcs` (files or folders) into `dest_dir`, taking ` (2)`…
/// on a clash. One result per source, in order.
pub fn copy_into(srcs: &[PathBuf], dest_dir: &Path) -> Vec<Result<PathBuf, FileError>> {
    srcs.iter().map(|src| copy_one(src, dest_dir)).collect()
}

/// A top-level source is followed if it's a link (as a file manager does);
/// links inside a copied folder are skipped, never followed.
fn copy_one(src: &Path, dest_dir: &Path) -> Result<PathBuf, FileError> {
    let meta = fs::metadata(src)?;
    if meta.is_dir() {
        let real = dunce::canonicalize(src)?;
        let dest_real = dunce::canonicalize(dest_dir)?;
        // By key, so another case spelling of a descendant counts too.
        if Path::new(&key(&dest_real)).starts_with(Path::new(&key(&real))) {
            return Err(FileError::IntoSelf);
        }
    }
    let (stem, ext) = stem_and_ext(src, meta.is_dir())?;
    first_free(dest_dir, &stem, &ext, true, |to| {
        if meta.is_dir() {
            fs::create_dir(to).map_err(exists_err)?;
            // Only the new folder's own name may move on to ` (n)`; a clash
            // inside it is a plain failure.
            copy_tree(src, to).map_err(|e| match e {
                FileError::Exists => FileError::Io(io::ErrorKind::AlreadyExists.into()),
                e => e,
            })?;
        } else {
            copy_file_new(src, to)?;
        }
        Ok(to.to_path_buf())
    })
}

/// Copies the contents of folder `src` into the new, empty folder `to`.
fn copy_tree(src: &Path, to: &Path) -> Result<(), FileError> {
    for item in fs::read_dir(src)? {
        let item = item?;
        let kind = item.file_type()?;
        let target = to.join(item.file_name());
        if kind.is_symlink() {
            continue;
        } else if kind.is_dir() {
            fs::create_dir(&target)?;
            copy_tree(&item.path(), &target)?;
        } else {
            copy_file_new(&item.path(), &target)?;
        }
    }
    Ok(())
}

/// Copies file `src` to `to`, which must not exist yet (never replaces). A
/// partial copy this call made is removed again.
fn copy_file_new(src: &Path, to: &Path) -> Result<(), FileError> {
    let mut from = File::open(src)?;
    let perms = from.metadata()?.permissions();
    let mut out = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)
        .map_err(exists_err)?;
    if let Err(e) = io::copy(&mut from, &mut out).and_then(|_| out.sync_all()) {
        drop(out);
        let _ = fs::remove_file(to);
        return Err(e.into());
    }
    drop(out);
    let _ = fs::set_permissions(to, perms);
    Ok(())
}

/// Moves `path` to the OS trash. If the trash refuses, so do we: the item
/// stays where it is (`TrashUnavailable`).
pub fn trash_entry(path: &Path) -> Result<(), FileError> {
    trash_with(path, recycle_bin_available, |p| {
        trash::delete(p).map_err(|e| e.to_string())
    })
}

/// `trash_entry` with the recycle-bin check and the trash call injected, so
/// both refusals are testable. The trash is only tried where the volume has
/// a bin: on Windows the shell might otherwise delete for good.
pub(crate) fn trash_with(
    path: &Path,
    bin_available: impl FnOnce(&Path) -> bool,
    trash: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), FileError> {
    fs::symlink_metadata(path)?;
    if !bin_available(path) {
        return Err(FileError::TrashUnavailable(
            "this drive has no recycle bin".into(),
        ));
    }
    trash(path).map_err(FileError::TrashUnavailable)
}

/// Whether the volume holding `path` has a Recycle Bin (`SHQueryRecycleBinW`
/// on its volume root). Network shares and some removable drives don't.
#[cfg(windows)]
pub(crate) fn recycle_bin_available(path: &Path) -> bool {
    volume_root(path).is_some_and(|root| bin::query(&root))
}

/// Elsewhere the `trash` crate moves items into a trash folder or fails; it
/// never deletes.
#[cfg(not(windows))]
pub(crate) fn recycle_bin_available(_path: &Path) -> bool {
    true
}

/// The root of the volume holding `path` (`C:\`, `\\server\share\`, or a
/// mounted folder).
#[cfg(windows)]
pub(crate) fn volume_root(path: &Path) -> Option<PathBuf> {
    bin::volume_path(path)
}

#[cfg(windows)]
mod bin {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::{Path, PathBuf};

    /// `SHQUERYRBINFO`; shellapi.h packs it to 1 byte on 32-bit Windows.
    #[repr(C)]
    #[cfg_attr(target_pointer_width = "32", repr(packed))]
    #[allow(dead_code)] // filled in by the shell, never read
    struct ShQueryRbInfo {
        cb_size: u32,
        size: i64,
        items: i64,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetVolumePathNameW(file: *const u16, volume: *mut u16, len: u32) -> i32;
    }

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SHQueryRecycleBinW(root: *const u16, info: *mut ShQueryRbInfo) -> i32;
    }

    fn wide(p: &Path) -> Vec<u16> {
        p.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    pub fn volume_path(path: &Path) -> Option<PathBuf> {
        const LEN: usize = 32 * 1024;
        let file = wide(path);
        let mut buf = vec![0u16; LEN];
        // SAFETY: `file` is NUL-terminated and `buf` holds `LEN` u16s.
        let ok = unsafe { GetVolumePathNameW(file.as_ptr(), buf.as_mut_ptr(), LEN as u32) };
        if ok == 0 {
            return None;
        }
        let end = buf.iter().position(|&c| c == 0)?;
        Some(PathBuf::from(OsString::from_wide(&buf[..end])))
    }

    /// `S_OK` means the volume has a Recycle Bin.
    pub fn query(root: &Path) -> bool {
        let root = wide(root);
        let mut info = ShQueryRbInfo {
            cb_size: std::mem::size_of::<ShQueryRbInfo>() as u32,
            size: 0,
            items: 0,
        };
        // SAFETY: `root` is NUL-terminated; `info` is a valid SHQUERYRBINFO
        // with its size set, living for the call.
        let hr = unsafe { SHQueryRecycleBinW(root.as_ptr(), &mut info) };
        hr == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn names(entries: &[Entry]) -> Vec<&str> {
        entries.iter().map(|e| e.name.as_str()).collect()
    }

    fn canon(p: &Path) -> PathBuf {
        dunce::canonicalize(p).unwrap()
    }

    #[test]
    fn list_dir_hides_dotfiles_sorts_dirs_first_natural() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = canon(tmp.path());
        for f in ["a10.md", "B.md", "a2.md", ".hidden", "c.txt"] {
            fs::write(dir.join(f), "x").unwrap();
        }
        for d in ["zeta", "Alpha", ".git", "beta 10", "beta 9"] {
            fs::create_dir(dir.join(d)).unwrap();
        }
        let entries = list_dir(&dir, &dir).unwrap();
        assert_eq!(
            names(&entries),
            [
                "Alpha", "beta 9", "beta 10", "zeta", "a2.md", "a10.md", "B.md", "c.txt"
            ]
        );
        let alpha = &entries[0];
        assert!(alpha.is_dir);
        assert_eq!(alpha.link, None);
        assert_eq!(Path::new(&alpha.path), dir.join("Alpha"));
        assert!(!entries[4].is_dir);

        let v = serde_json::to_value(alpha).unwrap();
        assert_eq!(v["isDir"], true);
        assert!(v["link"].is_null());
    }

    #[cfg(unix)]
    #[test]
    fn list_dir_marks_links_inside_and_outside() {
        use std::os::unix::fs::symlink;
        let tmp = tempfile::tempdir().unwrap();
        let base = canon(tmp.path());
        let root = base.join("root");
        let outside = base.join("outside");
        fs::create_dir_all(root.join("real")).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(root.join("note.md"), "x").unwrap();
        symlink(root.join("real"), root.join("in-dir")).unwrap();
        symlink(root.join("note.md"), root.join("in-file")).unwrap();
        symlink(&outside, root.join("out-dir")).unwrap();
        symlink(base.join("missing"), root.join("dangling")).unwrap();

        let entries = list_dir(&root, &root).unwrap();
        let get = |n: &str| entries.iter().find(|e| e.name == n).unwrap();
        assert_eq!(get("in-dir").link, Some(LinkKind::Inside));
        assert!(get("in-dir").is_dir);
        assert_eq!(get("in-file").link, Some(LinkKind::Inside));
        assert!(!get("in-file").is_dir);
        assert_eq!(get("out-dir").link, Some(LinkKind::Outside));
        assert_eq!(get("dangling").link, Some(LinkKind::Outside));
        assert_eq!(get("real").link, None);
        assert_eq!(
            serde_json::to_value(get("out-dir")).unwrap()["link"],
            "outside"
        );
        assert_eq!(
            serde_json::to_value(get("in-dir")).unwrap()["link"],
            "inside"
        );
    }

    #[cfg(windows)]
    #[test]
    fn list_dir_marks_junctions_inside_and_outside() {
        let tmp = tempfile::tempdir().unwrap();
        let base = canon(tmp.path());
        let root = base.join("root");
        let outside = base.join("outside");
        fs::create_dir_all(root.join("real")).unwrap();
        fs::create_dir(&outside).unwrap();
        crate::library::tests::junction(&root.join("in-dir"), &root.join("real"));
        crate::library::tests::junction(&root.join("out-dir"), &outside);

        let entries = list_dir(&root, &root).unwrap();
        let get = |n: &str| entries.iter().find(|e| e.name == n).unwrap();
        assert_eq!(get("in-dir").link, Some(LinkKind::Inside));
        assert!(get("in-dir").is_dir);
        assert_eq!(get("out-dir").link, Some(LinkKind::Outside));
        assert_eq!(get("real").link, None);
    }

    #[cfg(windows)]
    #[test]
    fn volume_root_of_a_local_path_is_its_drive() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = canon(tmp.path());
        let vol = volume_root(&dir).unwrap();
        assert!(dir.starts_with(&vol), "{vol:?} vs {dir:?}");
        assert!(vol.parent().is_none() || vol.to_string_lossy().ends_with('\\'));
        // The local system drive has a recycle bin.
        assert!(recycle_bin_available(&dir));
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn copy_into_own_descendant_refused_in_another_case() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = canon(tmp.path());
        let proj = dir.join("Proj");
        fs::create_dir_all(proj.join("inner")).unwrap();
        let other_case = dir.join("PROJ").join("INNER");
        let res = copy_into(std::slice::from_ref(&dir.join("proj")), &other_case);
        assert!(matches!(res[0], Err(FileError::IntoSelf)), "{res:?}");
    }

    #[cfg(unix)]
    #[test]
    fn rename_link_to_folder_takes_whole_name() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = canon(tmp.path());
        fs::create_dir(dir.join("real")).unwrap();
        std::os::unix::fs::symlink(dir.join("real"), dir.join("link.v1")).unwrap();
        let renamed = rename_entry(&dir.join("link.v1"), "link.v2").unwrap();
        assert_eq!(renamed, dir.join("link.v2"));
        assert!(
            fs::symlink_metadata(&renamed)
                .unwrap()
                .file_type()
                .is_symlink()
        );
    }

    #[cfg(windows)]
    #[test]
    fn rename_junction_takes_whole_name() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = canon(tmp.path());
        fs::create_dir(dir.join("real")).unwrap();
        crate::library::tests::junction(&dir.join("link.v1"), &dir.join("real"));
        let renamed = rename_entry(&dir.join("link.v1"), "link.v2").unwrap();
        assert_eq!(renamed, dir.join("link.v2"));
        assert!(dir.join("real").is_dir());
    }

    #[test]
    fn unique_name_suffixes_with_parens() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        assert_eq!(unique_name(dir, "a", "png"), dir.join("a.png"));
        fs::write(dir.join("a.png"), "x").unwrap();
        assert_eq!(unique_name(dir, "a", "png"), dir.join("a (2).png"));
        fs::write(dir.join("a (2).png"), "x").unwrap();
        assert_eq!(unique_name(dir, "a", "png"), dir.join("a (3).png"));
        fs::create_dir(dir.join("proj")).unwrap();
        assert_eq!(unique_name(dir, "proj", ""), dir.join("proj (2)"));
    }

    #[test]
    fn create_file_picks_unique_name() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let first = create_file(dir, "Untitled", "md", b"").unwrap();
        assert_eq!(first, dir.join("Untitled.md"));
        let second = create_file(dir, "Untitled", "md", b"hello").unwrap();
        assert_eq!(second, dir.join("Untitled 2.md"));
        assert_eq!(fs::read(&second).unwrap(), b"hello");
        assert_eq!(fs::read(&first).unwrap(), b"");
        // A folder of that name counts as taken too.
        fs::create_dir(dir.join("Untitled 3.md")).unwrap();
        assert_eq!(
            create_file(dir, "Untitled", "md", b"").unwrap(),
            dir.join("Untitled 4.md")
        );
        assert!(matches!(
            create_file(dir, "a/b", "md", b""),
            Err(FileError::InvalidName)
        ));
        assert!(matches!(
            create_file(dir, "ok", "m/d", b""),
            Err(FileError::InvalidName)
        ));
    }

    #[test]
    fn create_folder_picks_unique_name() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let first = create_folder(dir, "New folder").unwrap();
        assert_eq!(first, dir.join("New folder"));
        assert!(first.is_dir());
        fs::write(first.join("keep.md"), "keep").unwrap();
        assert_eq!(
            create_folder(dir, "New folder").unwrap(),
            dir.join("New folder 2")
        );
        assert_eq!(fs::read(first.join("keep.md")).unwrap(), b"keep");
        assert!(matches!(
            create_folder(dir, ".."),
            Err(FileError::InvalidName)
        ));
    }

    #[test]
    fn rename_entry_keeps_extension_and_refuses_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let a = dir.join("a.md");
        fs::write(&a, "a").unwrap();
        fs::write(dir.join("b.md"), "b").unwrap();

        let renamed = rename_entry(&a, "notes").unwrap();
        assert_eq!(renamed, dir.join("notes.md"));
        assert!(!a.exists());

        assert!(matches!(
            rename_entry(&renamed, "b"),
            Err(FileError::Exists)
        ));
        assert_eq!(fs::read(dir.join("b.md")).unwrap(), b"b");
        assert_eq!(fs::read(&renamed).unwrap(), b"a");

        // Folders take the whole name, and never replace another folder.
        let proj = dir.join("proj.v1");
        fs::create_dir(&proj).unwrap();
        fs::write(proj.join("x.md"), "x").unwrap();
        fs::create_dir(dir.join("taken")).unwrap();
        let moved = rename_entry(&proj, "proj.v2").unwrap();
        assert_eq!(moved, dir.join("proj.v2"));
        assert_eq!(fs::read(moved.join("x.md")).unwrap(), b"x");
        assert!(matches!(
            rename_entry(&moved, "taken"),
            Err(FileError::Exists)
        ));
        assert!(matches!(
            rename_entry(&moved, "a/b"),
            Err(FileError::InvalidName)
        ));
        assert!(moved.join("x.md").exists());
    }

    #[test]
    fn move_entry_suffixes_on_clash() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = canon(tmp.path());
        let dest = dir.join("dest");
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("a.png"), "old").unwrap();
        let a = dir.join("a.png");
        fs::write(&a, "new").unwrap();

        let moved = move_entry(&a, &dest).unwrap();
        assert_eq!(moved, dest.join("a (2).png"));
        assert_eq!(fs::read(dest.join("a.png")).unwrap(), b"old");
        assert_eq!(fs::read(&moved).unwrap(), b"new");
        assert!(!a.exists());

        // Folders move too, and clash the same way.
        let proj = dir.join("proj");
        fs::create_dir(&proj).unwrap();
        fs::write(proj.join("n.md"), "n").unwrap();
        fs::create_dir(dest.join("proj")).unwrap();
        let moved = move_entry(&proj, &dest).unwrap();
        assert_eq!(moved, dest.join("proj (2)"));
        assert_eq!(fs::read(moved.join("n.md")).unwrap(), b"n");

        // Moving into the folder it's already in changes nothing.
        assert_eq!(move_entry(&moved, &dest).unwrap(), moved);
    }

    #[test]
    fn move_into_own_descendant_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = canon(tmp.path());
        let proj = dir.join("proj");
        let inner = proj.join("inner");
        fs::create_dir_all(&inner).unwrap();
        assert!(matches!(
            move_entry(&proj, &inner),
            Err(FileError::IntoSelf)
        ));
        assert!(matches!(move_entry(&proj, &proj), Err(FileError::IntoSelf)));
        assert!(inner.is_dir());
        // A sibling whose name merely starts the same is fine.
        let proj2 = dir.join("proj2");
        fs::create_dir(&proj2).unwrap();
        assert_eq!(move_entry(&proj, &proj2).unwrap(), proj2.join("proj"));
    }

    #[test]
    fn copy_into_names_clashes_uniquely() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = canon(tmp.path());
        let dest = dir.join("dest");
        fs::create_dir(&dest).unwrap();
        let srcs: Vec<PathBuf> = ["one", "two", "three"]
            .iter()
            .map(|d| {
                let sub = dir.join(d);
                fs::create_dir(&sub).unwrap();
                let f = sub.join("a.png");
                fs::write(&f, d).unwrap();
                f
            })
            .collect();

        let out: Vec<PathBuf> = copy_into(&srcs, &dest)
            .into_iter()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            out,
            [
                dest.join("a.png"),
                dest.join("a (2).png"),
                dest.join("a (3).png")
            ]
        );
        assert_eq!(fs::read(&out[2]).unwrap(), b"three");
        // The sources are untouched.
        assert!(srcs.iter().all(|s| s.exists()));

        // A folder is copied whole; a missing source fails alone.
        let folder = dir.join("one");
        let res = copy_into(&[dir.join("missing.png"), folder.clone()], &dest);
        assert!(res[0].is_err());
        let copied = res[1].as_ref().unwrap();
        assert_eq!(copied, &dest.join("one"));
        assert_eq!(fs::read(copied.join("a.png")).unwrap(), b"one");
        // Into itself would never end.
        let res = copy_into(std::slice::from_ref(&folder), &folder);
        assert!(matches!(res[0], Err(FileError::IntoSelf)));
    }

    #[test]
    fn trash_failure_is_refused_not_deleted() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("keep.md");
        fs::write(&f, "keep").unwrap();
        let res = trash_with(&f, |_| true, |_| Err("no trash on this drive".into()));
        let Err(FileError::TrashUnavailable(why)) = res else {
            panic!("expected TrashUnavailable, got {res:?}");
        };
        assert!(why.contains("no trash on this drive"));
        assert_eq!(fs::read(&f).unwrap(), b"keep");

        // A volume without a recycle bin is refused before the trash is tried.
        let mut tried = false;
        let res = trash_with(
            &f,
            |_| false,
            |_| {
                tried = true;
                Ok(())
            },
        );
        assert!(matches!(res, Err(FileError::TrashUnavailable(_))));
        assert!(!tried);
        assert!(f.exists());

        let mut called = false;
        trash_with(
            &f,
            |_| true,
            |p| {
                called = p == f;
                Ok(())
            },
        )
        .unwrap();
        assert!(called);
        // A missing item never reaches the trash.
        let missing = tmp.path().join("gone.md");
        assert!(matches!(
            trash_with(&missing, |_| true, |_| Ok(())),
            Err(FileError::Io(_))
        ));
    }
}
