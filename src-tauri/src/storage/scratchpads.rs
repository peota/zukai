use super::{Result, atomic::atomic_write, validate_id};
use serde::Serialize;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ASIDE_COUNTER: AtomicU32 = AtomicU32::new(0);

/// A file in `closed/`, with its modified time in ms since the Unix epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClosedFile {
    pub id: String,
    pub modified_ms: u64,
}

fn pad_path(base: &Path, folder: &str, id: &str) -> Result<PathBuf> {
    validate_id(id)?;
    Ok(base.join(folder).join(format!("{id}.txt")))
}

pub fn read(base: &Path, id: &str) -> Result<String> {
    match fs::read_to_string(pad_path(base, "scratchpads", id)?) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.into()),
    }
}

pub fn write(base: &Path, id: &str, content: &str) -> Result<()> {
    Ok(atomic_write(
        &pad_path(base, "scratchpads", id)?,
        content.as_bytes(),
    )?)
}

fn remove_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn delete(base: &Path, id: &str) -> Result<()> {
    remove_if_exists(&pad_path(base, "scratchpads", id)?)
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
        if !pad_path(base, folder, &candidate)?.exists() {
            return Ok(candidate);
        }
    }
}

/// Move `<from>/<id>.txt` to `<to>/<id>.txt`. A file already at the
/// destination is never replaced: it is first renamed to a fresh id in the
/// same folder, so its text stays reachable (orphan Tab or Recently Closed).
fn move_pad(base: &Path, from: &str, to: &str, id: &str) -> Result<()> {
    let src = pad_path(base, from, id)?;
    let dst = pad_path(base, to, id)?;
    fs::create_dir_all(base.join(to))?;
    if !src.exists() {
        return Err(std::io::Error::new(ErrorKind::NotFound, "scratchpad file not found").into());
    }
    if dst.exists() {
        let aside = pad_path(base, to, &aside_id(base, to, id)?)?;
        fs::rename(&dst, aside)?;
    }
    Ok(fs::rename(src, dst)?)
}

pub fn close(base: &Path, id: &str) -> Result<()> {
    move_pad(base, "scratchpads", "closed", id)
}

pub fn reopen(base: &Path, id: &str) -> Result<()> {
    move_pad(base, "closed", "scratchpads", id)
}

pub fn list(base: &Path) -> Result<Vec<String>> {
    let entries = match fs::read_dir(base.join("scratchpads")) {
        Ok(e) => e,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut ids = Vec::new();
    for entry in entries {
        let path = entry?.path();
        if path.extension().is_some_and(|x| x == "txt")
            && let Some(stem) = path.file_stem().and_then(|s| s.to_str())
        {
            ids.push(stem.to_string());
        }
    }
    Ok(ids)
}

pub fn list_closed(base: &Path) -> Result<Vec<ClosedFile>> {
    let entries = match fs::read_dir(base.join("closed")) {
        Ok(e) => e,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_some_and(|x| x == "txt")
            && let Some(stem) = path.file_stem().and_then(|s| s.to_str())
            && validate_id(stem).is_ok()
        {
            let modified_ms = entry
                .metadata()?
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(ClosedFile {
                id: stem.to_string(),
                modified_ms,
            });
        }
    }
    Ok(out)
}

pub fn purge_closed(base: &Path, ids: &[String]) -> Result<()> {
    for id in ids {
        remove_if_exists(&pad_path(base, "closed", id)?)?;
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

    #[test]
    fn close_then_reopen_round_trips() {
        let d = base();
        write(d.path(), "a", "héllo").unwrap();
        close(d.path(), "a").unwrap();
        assert!(d.path().join("closed/a.txt").exists());
        assert!(!d.path().join("scratchpads/a.txt").exists());
        reopen(d.path(), "a").unwrap();
        assert!(!d.path().join("closed/a.txt").exists());
        assert_eq!(read(d.path(), "a").unwrap(), "héllo");
    }

    #[test]
    fn list_returns_only_txt_ids() {
        let d = base();
        for n in ["a.txt", "b.txt", "c.tmp"] {
            fs::write(d.path().join("scratchpads").join(n), "").unwrap();
        }
        let mut ids = list(d.path()).unwrap();
        ids.sort();
        assert_eq!(ids, vec!["a", "b"]);
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
        write(d.path(), "a", "old").unwrap();
        close(d.path(), "a").unwrap();
        write(d.path(), "a", "new").unwrap();
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
        write(d.path(), "a", "closed text").unwrap();
        close(d.path(), "a").unwrap();
        write(d.path(), "a", "open text").unwrap();
        reopen(d.path(), "a").unwrap();
        assert_eq!(read(d.path(), "a").unwrap(), "closed text");
        let mut texts: Vec<String> = list(d.path())
            .unwrap()
            .iter()
            .map(|id| read(d.path(), id).unwrap())
            .collect();
        texts.sort();
        assert_eq!(texts, vec!["closed text", "open text"]);
    }

    #[test]
    fn list_closed_returns_ids_and_mtimes() {
        let d = base();
        write(d.path(), "a", "x").unwrap();
        close(d.path(), "a").unwrap();
        fs::write(d.path().join("closed/junk.tmp"), "").unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let got = list_closed(d.path()).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, "a");
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
}
