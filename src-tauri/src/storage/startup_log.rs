//! A tiny diagnostic log of each launch (`startup.log` in the data folder), so
//! a launch that never shows the window can be diagnosed afterwards.

use super::{Result, atomic::atomic_write};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub const FILE_NAME: &str = "startup.log";
/// Only the most recent lines are kept.
pub const MAX_LINES: usize = 50;
const MAX_MESSAGE: usize = 120;

/// Append `<unix ms> <message>` and keep only the last `MAX_LINES` lines.
pub fn append(base: &Path, message: &str) -> Result<()> {
    let path = base.join(FILE_NAME);
    let old = match fs::read(&path) {
        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
        Err(e) if e.kind() == ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.into()),
    };
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let clean: String = message
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(MAX_MESSAGE)
        .collect();
    let line = format!("{ms} {clean}");
    let mut lines: Vec<&str> = old.lines().collect();
    lines.push(&line);
    let start = lines.len().saturating_sub(MAX_LINES);
    let mut out = lines[start..].join("\n");
    out.push('\n');
    Ok(atomic_write(&path, out.as_bytes())?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_timestamped_lines() {
        let d = tempfile::tempdir().unwrap();
        append(d.path(), "launch").unwrap();
        append(d.path(), "js: shown\nx").unwrap();
        let s = fs::read_to_string(d.path().join(FILE_NAME)).unwrap();
        let lines: Vec<&str> = s.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with(" launch"));
        assert!(lines[1].ends_with(" js: shown x"));
        assert!(lines[0].split(' ').next().unwrap().parse::<u128>().is_ok());
    }

    #[test]
    fn keeps_only_the_last_lines() {
        let d = tempfile::tempdir().unwrap();
        for i in 0..(MAX_LINES + 7) {
            append(d.path(), &format!("n{i}")).unwrap();
        }
        let s = fs::read_to_string(d.path().join(FILE_NAME)).unwrap();
        let lines: Vec<&str> = s.lines().collect();
        assert_eq!(lines.len(), MAX_LINES);
        assert!(lines[0].ends_with(" n7"));
        assert!(lines[MAX_LINES - 1].ends_with(&format!(" n{}", MAX_LINES + 6)));
    }
}
