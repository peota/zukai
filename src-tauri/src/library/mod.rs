//! The Library: a real folder of projects the sidebar shows (ADR 0011).
//!
//! Rust owns the root (`root.rs`), grants exactly that one folder
//! (`Grants::set_root` / `in_root`) and runs every operation on it
//! (`ops.rs`, `commands.rs`).

pub mod added;
pub mod commands;
pub mod index;
pub mod ops;
pub mod root;
pub mod watch;

#[cfg(test)]
pub(crate) mod tests {
    use crate::files::FileError;
    use crate::files::grants::Grants;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// A directory junction (no privilege needed, unlike symlinks).
    #[cfg(windows)]
    pub fn junction(link: &Path, target: &Path) {
        let out = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .unwrap();
        assert!(out.status.success(), "mklink /J failed: {out:?}");
    }

    /// `<tmp>/root` (granted) and `<tmp>/outside`, both canonical.
    pub fn library() -> (tempfile::TempDir, Grants, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let base = dunce::canonicalize(tmp.path()).unwrap();
        let (root, outside) = (base.join("root"), base.join("outside"));
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        let g = Grants::default();
        assert_eq!(g.set_root(&root).unwrap(), root);
        (tmp, g, root, outside)
    }

    fn refused(r: Result<PathBuf, FileError>) -> bool {
        matches!(r, Err(FileError::NotGranted))
    }

    #[test]
    fn in_root_accepts_inside_refuses_outside_and_dotdot() {
        let (_tmp, g, root, outside) = library();
        fs::create_dir(root.join("proj")).unwrap();
        fs::write(root.join("proj").join("a.md"), "a").unwrap();
        fs::write(outside.join("secret.md"), "s").unwrap();

        assert_eq!(g.in_root(&root).unwrap(), root);
        let a = root.join("proj").join("a.md");
        assert_eq!(g.in_root(&a).unwrap(), a);
        // Not created yet: checked through its parent.
        let new = root.join("proj").join("new.md");
        assert_eq!(g.in_root(&new).unwrap(), new);
        // `..` is resolved before the check.
        let roundabout = root.join("proj").join("..").join("proj").join("a.md");
        assert_eq!(g.in_root(&roundabout).unwrap(), a);

        assert!(refused(g.in_root(&outside.join("secret.md"))));
        assert!(refused(g.in_root(&root.join("..").join("outside"))));
        assert!(refused(
            g.in_root(&root.join("..").join("outside").join("secret.md"))
        ));
        assert!(refused(
            g.in_root(&root.join("missing").join("..").join(".."))
        ));
        assert!(refused(g.in_root(root.parent().unwrap())));
        assert!(refused(g.in_root(Path::new("proj/a.md"))));
        // A sibling whose name merely starts like the root is outside it.
        let sibling = root.with_file_name("root2");
        fs::create_dir(&sibling).unwrap();
        assert!(refused(g.in_root(&sibling)));

        // `check` accepts files under the root; `check_exact` only in the
        // exact canonical spelling, so the Session can't smuggle aliases.
        let a_str = a.to_str().unwrap();
        assert_eq!(g.check(a_str).unwrap(), a);
        assert_eq!(g.check_exact(a_str).unwrap(), a);
        assert_eq!(g.check(roundabout.to_str().unwrap()).unwrap(), a);
        assert!(refused(g.check_exact(roundabout.to_str().unwrap())));
        // Windows canonicalizes to the on-disk case; macOS `realpath` need not.
        #[cfg(windows)]
        assert!(refused(g.check_exact(&a_str.replace("a.md", "A.MD"))));
        assert!(refused(
            g.check(outside.join("secret.md").to_str().unwrap())
        ));

        // No root, no folder grant.
        let none = Grants::default();
        assert!(refused(none.in_root(&a)));
        assert!(refused(none.check(a_str)));
    }

    #[test]
    fn set_root_replaces_the_previous_root_and_needs_a_folder() {
        let (_tmp, g, root, outside) = library();
        fs::write(root.join("a.md"), "a").unwrap();
        assert_eq!(g.set_root(&outside).unwrap(), outside);
        assert!(refused(g.in_root(&root.join("a.md"))));
        assert!(g.in_root(&outside.join("b.md")).is_ok());

        assert!(g.set_root(&root.join("a.md")).is_err());
        assert!(g.set_root(&root.join("missing")).is_err());
        assert!(g.set_root(Path::new("relative")).is_err());
        // A failed set_root leaves the previous root in place.
        assert!(g.in_root(&outside.join("b.md")).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn in_root_refuses_symlink_escape() {
        use std::os::unix::fs::symlink;
        let (_tmp, g, root, outside) = library();
        fs::write(outside.join("secret.md"), "s").unwrap();
        fs::create_dir(root.join("real")).unwrap();
        symlink(&outside, root.join("escape")).unwrap();
        symlink(outside.join("secret.md"), root.join("secret-link.md")).unwrap();
        symlink(outside.join("not-yet.md"), root.join("dangling.md")).unwrap();
        symlink(root.join("real"), root.join("inner")).unwrap();

        assert!(refused(g.in_root(&root.join("escape"))));
        assert!(refused(g.in_root(&root.join("escape").join("secret.md"))));
        assert!(refused(g.in_root(&root.join("escape").join("new.md"))));
        assert!(refused(g.in_root(&root.join("secret-link.md"))));
        // A dangling link would be followed by the next write.
        assert!(refused(g.in_root(&root.join("dangling.md"))));
        // A link that stays inside behaves like its target.
        assert_eq!(
            g.in_root(&root.join("inner").join("x.md")).unwrap(),
            root.join("real").join("x.md")
        );
    }

    #[cfg(windows)]
    #[test]
    fn in_root_refuses_junction_escape() {
        let (_tmp, g, root, outside) = library();
        fs::write(outside.join("secret.md"), "s").unwrap();
        fs::create_dir(root.join("real")).unwrap();
        junction(&root.join("escape"), &outside);
        junction(&root.join("inner"), &root.join("real"));

        assert!(refused(g.in_root(&root.join("escape"))));
        assert!(refused(g.in_root(&root.join("escape").join("secret.md"))));
        assert!(refused(g.in_root(&root.join("escape").join("new.md"))));
        assert!(refused(
            g.check(root.join("escape").join("secret.md").to_str().unwrap())
        ));
        assert_eq!(
            g.in_root(&root.join("inner").join("x.md")).unwrap(),
            root.join("real").join("x.md")
        );
    }
}
