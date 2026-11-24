//! Vetting a remote URL before it reaches git.

use super::{GitError, GitKind};

/// Refuses URLs that git would treat as an option or run as a command.
pub fn check_url(url: &str) -> Result<(), GitError> {
    let u = url.trim();
    let lower = u.to_ascii_lowercase();
    let why = if u.is_empty() {
        "the URL is empty"
    } else if u.starts_with('-') {
        "the URL looks like an option"
    } else if lower.starts_with("ext::") {
        "ext:: URLs run commands"
    } else if lower.starts_with("file:") {
        "file: URLs are not allowed"
    } else {
        return Ok(());
    };
    Err(GitError::new(GitKind::BadUrl, why))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_url_refuses_hostile() {
        for u in [
            "--upload-pack=touch x",
            "ext::sh -c id",
            "EXT::x",
            "file:///etc",
            "",
            "   ",
        ] {
            assert_eq!(check_url(u).unwrap_err().kind, GitKind::BadUrl, "{u:?}");
        }
        for u in ["git@github.com:a/b.git", "https://h/a.git"] {
            assert!(check_url(u).is_ok(), "{u}");
        }
    }
}
