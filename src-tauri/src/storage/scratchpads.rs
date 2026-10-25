use super::{Result, atomic::atomic_write, validate_id};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

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

fn move_pad(base: &Path, from: &str, to: &str, id: &str) -> Result<()> {
    let src = pad_path(base, from, id)?;
    let dst = pad_path(base, to, id)?;
    fs::create_dir_all(base.join(to))?;
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

    #[test]
    fn read_missing_is_empty() {
        let d = base();
        assert_eq!(read(d.path(), "nope").unwrap(), "");
    }
}
