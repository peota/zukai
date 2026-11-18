use super::{Result, atomic::atomic_write, validate_id};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ASIDE_COUNTER: AtomicU32 = AtomicU32::new(0);

/// The file extension of a scratchpad: text, or a Canvas (Excalidraw JSON).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScratchExt {
    Txt,
    Excalidraw,
}

impl ScratchExt {
    const ALL: [ScratchExt; 2] = [ScratchExt::Txt, ScratchExt::Excalidraw];

    fn as_str(self) -> &'static str {
        match self {
            ScratchExt::Txt => "txt",
            ScratchExt::Excalidraw => "excalidraw",
        }
    }

    fn from_os(ext: Option<&std::ffi::OsStr>) -> Option<ScratchExt> {
        let ext = ext?;
        Self::ALL.into_iter().find(|e| ext == e.as_str())
    }
}

/// A scratchpad in `scratchpads/`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ScratchEntry {
    pub id: String,
    pub ext: ScratchExt,
}

/// A file in `closed/`, with its modified time in ms since the Unix epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedFile {
    pub id: String,
    pub ext: ScratchExt,
    pub modified_ms: u64,
}

fn pad_path(base: &Path, folder: &str, id: &str, ext: ScratchExt) -> Result<PathBuf> {
    validate_id(id)?;
    Ok(base.join(folder).join(format!("{id}.{}", ext.as_str())))
}

/// The modified time of `path`, or None if it doesn't exist.
fn modified(path: &Path) -> Result<Option<SystemTime>> {
    match fs::metadata(path) {
        Ok(m) => Ok(Some(m.modified().unwrap_or(UNIX_EPOCH))),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// The file for `id` in `folder`, whichever extension it has. One id is one
/// scratch file: `write` removes the other extension, and if both are there
/// anyway (a crash in between), the newer one is the id's file everywhere
/// (read, list, close); a tie goes to `.txt`.
fn find_pad(base: &Path, folder: &str, id: &str) -> Result<Option<(PathBuf, ScratchExt)>> {
    let mut best: Option<(PathBuf, ScratchExt, SystemTime)> = None;
    for ext in ScratchExt::ALL {
        let p = pad_path(base, folder, id, ext)?;
        if let Some(t) = modified(&p)?
            && best.as_ref().is_none_or(|(_, _, b)| t > *b)
        {
            best = Some((p, ext, t));
        }
    }
    Ok(best.map(|(p, ext, _)| (p, ext)))
}

pub fn read(base: &Path, id: &str) -> Result<String> {
    let Some((path, _)) = find_pad(base, "scratchpads", id)? else {
        return Ok(String::new());
    };
    match fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.into()),
    }
}

pub fn write(base: &Path, id: &str, content: &str, ext: ScratchExt) -> Result<()> {
    atomic_write(&pad_path(base, "scratchpads", id, ext)?, content.as_bytes())?;
    // One id, one file. The text is already safe: if the other extension's
    // file can't go, `find_pad` still picks the newer one (this), so the
    // write isn't reported as failed.
    for other in ScratchExt::ALL.into_iter().filter(|e| *e != ext) {
        if let Err(e) = remove_if_exists(&pad_path(base, "scratchpads", id, other)?) {
            eprintln!(
                "scratchpad {id}: can't remove its .{} file: {e}",
                other.as_str()
            );
        }
    }
    Ok(())
}

fn remove_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn delete(base: &Path, id: &str) -> Result<()> {
    for ext in ScratchExt::ALL {
        remove_if_exists(&pad_path(base, "scratchpads", id, ext)?)?;
    }
    Ok(())
}

/// A fresh, valid id derived from `id`, free in `folder`.
fn aside_id(base: &Path, folder: &str, id: &str) -> Result<String> {
    let stem: String = id.chars().take(40).collect();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    loop {
        let n = ASIDE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = format!("{stem}-{nanos:x}{n:x}");
        if find_pad(base, folder, &candidate)?.is_none() {
            return Ok(candidate);
        }
    }
}

/// Move `<from>/<id>.<ext>` to `<to>/<id>.<ext>`, whichever extension it has.
/// A file already at the destination under that id (either extension) is
/// never replaced: it is first renamed to a fresh id in the same folder, so
/// its text stays reachable (orphan Tab or Recently Closed). A stale file of
/// the other extension left under the id in `from` goes along under a fresh
/// id too, so nothing is left behind that would shadow the id later.
fn move_pad(base: &Path, from: &str, to: &str, id: &str) -> Result<()> {
    let Some((src, ext)) = find_pad(base, from, id)? else {
        return Err(std::io::Error::new(ErrorKind::NotFound, "scratchpad file not found").into());
    };
    fs::create_dir_all(base.join(to))?;
    for e in ScratchExt::ALL {
        let taken = pad_path(base, to, id, e)?;
        if taken.exists() {
            fs::rename(&taken, pad_path(base, to, &aside_id(base, to, id)?, e)?)?;
        }
    }
    for e in ScratchExt::ALL.into_iter().filter(|e| *e != ext) {
        let stale = pad_path(base, from, id, e)?;
        if stale.exists() {
            fs::rename(&stale, pad_path(base, to, &aside_id(base, to, id)?, e)?)?;
        }
    }
    Ok(fs::rename(src, pad_path(base, to, id, ext)?)?)
}

pub fn close(base: &Path, id: &str) -> Result<()> {
    move_pad(base, "scratchpads", "closed", id)
}

pub fn reopen(base: &Path, id: &str) -> Result<()> {
    move_pad(base, "closed", "scratchpads", id)
}

/// The ids with a scratch file in `folder`, each once, with its file.
fn ids_in(base: &Path, folder: &str) -> Result<Vec<(String, PathBuf, ScratchExt)>> {
    let entries = match fs::read_dir(base.join(folder)) {
        Ok(e) => e,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut ids = std::collections::BTreeSet::new();
    for entry in entries {
        let path = entry?.path();
        if ScratchExt::from_os(path.extension()).is_some()
            && let Some(stem) = path.file_stem().and_then(|s| s.to_str())
            && validate_id(stem).is_ok()
        {
            ids.insert(stem.to_string());
        }
    }
    let mut out = Vec::new();
    for id in ids {
        if let Some((path, ext)) = find_pad(base, folder, &id)? {
            out.push((id, path, ext));
        }
    }
    Ok(out)
}

pub fn list(base: &Path) -> Result<Vec<ScratchEntry>> {
    Ok(ids_in(base, "scratchpads")?
        .into_iter()
        .map(|(id, _, ext)| ScratchEntry { id, ext })
        .collect())
}

pub fn list_closed(base: &Path) -> Result<Vec<ClosedFile>> {
    let mut out = Vec::new();
    for (id, path, ext) in ids_in(base, "closed")? {
        let modified_ms = modified(&path)?
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(ClosedFile {
            id,
            ext,
            modified_ms,
        });
    }
    Ok(out)
}

pub fn purge_closed(base: &Path, ids: &[String]) -> Result<()> {
    for id in ids {
        for ext in ScratchExt::ALL {
            remove_if_exists(&pad_path(base, "closed", id, ext)?)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("scratchpads")).unwrap();
        fs::create_dir(d.path().join("closed")).unwrap();
        d
    }

    fn put(base: &Path, id: &str, text: &str) {
        write(base, id, text, ScratchExt::Txt).unwrap();
    }

    #[test]
    fn close_then_reopen_round_trips() {
        let d = base();
        put(d.path(), "a", "héllo");
        close(d.path(), "a").unwrap();
        assert!(d.path().join("closed/a.txt").exists());
        assert!(!d.path().join("scratchpads/a.txt").exists());
        reopen(d.path(), "a").unwrap();
        assert!(!d.path().join("closed/a.txt").exists());
        assert_eq!(read(d.path(), "a").unwrap(), "héllo");
    }

    #[test]
    fn list_returns_only_known_extensions() {
        let d = base();
        for n in ["a.txt", "b.txt", "c.tmp", "d.excalidraw"] {
            fs::write(d.path().join("scratchpads").join(n), "").unwrap();
        }
        let mut got = list(d.path()).unwrap();
        got.sort_by(|x, y| x.id.cmp(&y.id));
        let pairs: Vec<(&str, ScratchExt)> = got.iter().map(|e| (e.id.as_str(), e.ext)).collect();
        assert_eq!(
            pairs,
            vec![
                ("a", ScratchExt::Txt),
                ("b", ScratchExt::Txt),
                ("d", ScratchExt::Excalidraw)
            ]
        );
    }

    fn closed_contents(base: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(base.join("closed"))
            .unwrap()
            .map(|e| fs::read_to_string(e.unwrap().path()).unwrap())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn close_never_overwrites_a_closed_file() {
        let d = base();
        put(d.path(), "a", "old");
        close(d.path(), "a").unwrap();
        put(d.path(), "a", "new");
        close(d.path(), "a").unwrap();
        assert_eq!(closed_contents(d.path()), vec!["new", "old"]);
        assert_eq!(
            fs::read_to_string(d.path().join("closed/a.txt")).unwrap(),
            "new"
        );
        // The older text is kept under a fresh, valid id.
        let ids: Vec<String> = list_closed(d.path())
            .unwrap()
            .into_iter()
            .map(|c| c.id)
            .collect();
        assert_eq!(ids.len(), 2);
        for id in &ids {
            assert!(validate_id(id).is_ok(), "{id}");
        }
    }

    #[test]
    fn reopen_never_overwrites_an_open_file() {
        let d = base();
        put(d.path(), "a", "closed text");
        close(d.path(), "a").unwrap();
        put(d.path(), "a", "open text");
        reopen(d.path(), "a").unwrap();
        assert_eq!(read(d.path(), "a").unwrap(), "closed text");
        let mut texts: Vec<String> = list(d.path())
            .unwrap()
            .iter()
            .map(|e| read(d.path(), &e.id).unwrap())
            .collect();
        texts.sort();
        assert_eq!(texts, vec!["closed text", "open text"]);
    }

    #[test]
    fn list_closed_returns_ids_and_mtimes() {
        let d = base();
        put(d.path(), "a", "x");
        close(d.path(), "a").unwrap();
        fs::write(d.path().join("closed/junk.tmp"), "").unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let got = list_closed(d.path()).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, "a");
        assert_eq!(got[0].ext, ScratchExt::Txt);
        assert!(got[0].modified_ms > 0 && got[0].modified_ms <= now + 1000);
    }

    #[test]
    fn list_closed_missing_folder_is_empty() {
        let d = tempfile::tempdir().unwrap();
        assert!(list_closed(d.path()).unwrap().is_empty());
    }

    #[test]
    fn read_missing_is_empty() {
        let d = base();
        assert_eq!(read(d.path(), "nope").unwrap(), "");
    }

    #[test]
    fn excalidraw_scratchpad_round_trips_and_lists_with_ext() {
        let d = base();
        write(d.path(), "c", "{\"elements\":[]}", ScratchExt::Excalidraw).unwrap();
        put(d.path(), "t", "text");
        assert!(d.path().join("scratchpads/c.excalidraw").exists());
        assert_eq!(read(d.path(), "c").unwrap(), "{\"elements\":[]}");
        let mut got = list(d.path()).unwrap();
        got.sort_by(|x, y| x.id.cmp(&y.id));
        assert_eq!(
            got,
            vec![
                ScratchEntry {
                    id: "c".into(),
                    ext: ScratchExt::Excalidraw
                },
                ScratchEntry {
                    id: "t".into(),
                    ext: ScratchExt::Txt
                },
            ]
        );
        delete(d.path(), "c").unwrap();
        assert!(!d.path().join("scratchpads/c.excalidraw").exists());
    }

    #[test]
    fn close_reopen_canvas_scratchpad() {
        let d = base();
        write(d.path(), "c", "{}", ScratchExt::Excalidraw).unwrap();
        close(d.path(), "c").unwrap();
        assert!(d.path().join("closed/c.excalidraw").exists());
        assert!(!d.path().join("scratchpads/c.excalidraw").exists());
        let closed = list_closed(d.path()).unwrap();
        assert_eq!(closed.len(), 1);
        assert_eq!(closed[0].ext, ScratchExt::Excalidraw);
        reopen(d.path(), "c").unwrap();
        assert!(d.path().join("scratchpads/c.excalidraw").exists());
        assert_eq!(read(d.path(), "c").unwrap(), "{}");
        close(d.path(), "c").unwrap();
        purge_closed(d.path(), &["c".to_string()]).unwrap();
        assert!(list_closed(d.path()).unwrap().is_empty());
    }

    /// Make `path` look `secs_ago` seconds old.
    fn age(path: &Path, secs_ago: u64) {
        let t = SystemTime::now() - std::time::Duration::from_secs(secs_ago);
        fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(t)
            .unwrap();
    }

    #[test]
    fn one_id_is_one_scratch_file() {
        let d = base();
        let pads = d.path().join("scratchpads");
        fs::write(pads.join("a.txt"), "old text").unwrap();
        fs::write(pads.join("a.excalidraw"), "{\"new\":1}").unwrap();
        age(&pads.join("a.txt"), 60);
        // List, read and the Kind agree on the newer file, once.
        let got = list(d.path()).unwrap();
        assert_eq!(
            got,
            vec![ScratchEntry {
                id: "a".into(),
                ext: ScratchExt::Excalidraw
            }]
        );
        assert_eq!(read(d.path(), "a").unwrap(), "{\"new\":1}");
        // A write leaves exactly one file for the id.
        write(d.path(), "a", "text", ScratchExt::Txt).unwrap();
        assert!(pads.join("a.txt").exists());
        assert!(!pads.join("a.excalidraw").exists());
        assert_eq!(list(d.path()).unwrap().len(), 1);
    }

    #[test]
    fn list_closed_never_repeats_an_id() {
        let d = base();
        let closed = d.path().join("closed");
        fs::write(closed.join("a.txt"), "x").unwrap();
        fs::write(closed.join("a.excalidraw"), "{}").unwrap();
        age(&closed.join("a.excalidraw"), 60);
        let got = list_closed(d.path()).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!((got[0].id.as_str(), got[0].ext), ("a", ScratchExt::Txt));
    }

    #[test]
    fn close_and_reopen_set_aside_files_of_either_extension() {
        let d = base();
        // A closed canvas with the same id as an open text scratchpad.
        write(d.path(), "a", "{}", ScratchExt::Excalidraw).unwrap();
        close(d.path(), "a").unwrap();
        put(d.path(), "a", "text");
        close(d.path(), "a").unwrap();
        assert_eq!(read_closed(d.path(), "a"), "text");
        let closed = list_closed(d.path()).unwrap();
        assert_eq!(closed.len(), 2, "{closed:?}");
        assert_eq!(closed_contents(d.path()), vec!["text", "{}"]);
        // And back: an open canvas with that id is set aside, not shadowed.
        write(d.path(), "a", "{\"open\":1}", ScratchExt::Excalidraw).unwrap();
        reopen(d.path(), "a").unwrap();
        assert_eq!(read(d.path(), "a").unwrap(), "text");
        let open = list(d.path()).unwrap();
        assert_eq!(open.len(), 2, "{open:?}");
        assert!(!d.path().join("scratchpads/a.excalidraw").exists());
    }

    #[test]
    fn close_takes_a_stale_duplicate_along() {
        let d = base();
        let pads = d.path().join("scratchpads");
        fs::write(pads.join("a.txt"), "new").unwrap();
        fs::write(pads.join("a.excalidraw"), "{}").unwrap();
        age(&pads.join("a.excalidraw"), 60);
        close(d.path(), "a").unwrap();
        // Nothing is left behind under the id, and nothing is lost.
        assert!(list(d.path()).unwrap().is_empty());
        assert_eq!(read_closed(d.path(), "a"), "new");
        assert_eq!(closed_contents(d.path()), vec!["new", "{}"]);
    }

    fn read_closed(base: &Path, id: &str) -> String {
        let (p, _) = find_pad(base, "closed", id).unwrap().unwrap();
        fs::read_to_string(p).unwrap()
    }

    #[test]
    fn ext_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&ScratchExt::Excalidraw).unwrap(),
            "\"excalidraw\""
        );
        assert_eq!(
            serde_json::from_str::<ScratchExt>("\"txt\"").unwrap(),
            ScratchExt::Txt
        );
    }
}
