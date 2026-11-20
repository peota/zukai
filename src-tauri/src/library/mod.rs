//! The Library: a real folder of projects the sidebar shows (ADR 0011).
//!
//! Rust owns the root (`root.rs`), grants exactly that one folder
//! (`Grants::set_root` / `in_root`) and runs every operation on it
//! (`ops.rs`, `commands.rs`).

pub mod added;
pub mod commands;
pub mod fuzzy;
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

    /// `library()` plus `<tmp>/added`, granted as an added root.
    pub fn library_with_added() -> (tempfile::TempDir, Grants, PathBuf, PathBuf, PathBuf) {
        let (tmp, g, root, outside) = library();
        let added = root.with_file_name("added");
        fs::create_dir(&added).unwrap();
        assert_eq!(g.add_root(&added).unwrap(), added);
        (tmp, g, root, added, outside)
    }

    /// A link to the folder `target`: a symlink on Unix, a junction on Windows.
    pub fn dir_link(link: &Path, target: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        junction(link, target);
    }

    fn refused(r: Result<PathBuf, FileError>) -> bool {
        matches!(r, Err(FileError::NotGranted))
    }

    /// The message of an `Io` error, or `""`.
    fn message(r: Result<PathBuf, FileError>) -> String {
        match r {
            Err(FileError::Io(e)) => e.to_string(),
            _ => String::new(),
        }
    }

    #[test]
    fn in_root_accepts_inside_any_root() {
        let (_tmp, g, root, added, outside) = library_with_added();
        fs::write(root.join("a.md"), "a").unwrap();
        fs::write(added.join("b.md"), "b").unwrap();
        fs::write(outside.join("c.md"), "c").unwrap();

        assert_eq!(g.in_root(&added).unwrap(), added);
        assert_eq!(g.in_root(&added.join("b.md")).unwrap(), added.join("b.md"));
        assert_eq!(
            g.in_root(&added.join("new.md")).unwrap(),
            added.join("new.md")
        );
        assert_eq!(g.in_root(&root.join("a.md")).unwrap(), root.join("a.md"));
        assert!(refused(g.in_root(&outside.join("c.md"))));
        assert!(refused(g.in_root(&added.join("..").join("outside"))));

        let b = added.join("b.md");
        assert_eq!(g.check(b.to_str().unwrap()).unwrap(), b);
        assert_eq!(g.grant_in_root(&b).unwrap(), b);
        assert!(refused(g.check(outside.join("c.md").to_str().unwrap())));

        assert_eq!(g.root(), Some(root.clone()));
        assert_eq!(g.added(), vec![added.clone()]);
        assert_eq!(g.root_of(&b), Some(added.clone()));
        assert_eq!(g.root_of(&root.join("a.md")), Some(root.clone()));
        assert_eq!(g.root_of(&outside.join("c.md")), None);
    }

    #[test]
    fn link_from_added_into_library_refused() {
        let (_tmp, g, root, added, outside) = library_with_added();
        fs::write(root.join("x"), "x").unwrap();
        let other = outside.join("other");
        fs::create_dir(&other).unwrap();
        fs::write(other.join("y"), "y").unwrap();
        assert_eq!(g.add_root(&other).unwrap(), other);
        dir_link(&added.join("link"), &root);
        dir_link(&added.join("hop"), &other);

        let via = added.join("link").join("x");
        assert!(refused(g.in_root(&via)));
        assert!(refused(g.in_root(&added.join("link"))));
        assert!(refused(g.in_root(&added.join("link").join("new.md"))));
        assert!(refused(g.check(via.to_str().unwrap())));
        assert!(refused(g.grant_in_root(&via)));
        assert!(refused(g.grant(&via)));
        // Into another added folder: refused the same way.
        assert!(refused(g.in_root(&added.join("hop").join("y"))));
        // The Library itself is untouched.
        assert_eq!(g.in_root(&root.join("x")).unwrap(), root.join("x"));
    }

    #[test]
    fn link_in_added_inside_a_wider_library_judged_by_the_added_root() {
        // The Library re-pointed to a folder holding an added folder (before
        // `use_root` drops it): the added root, the deepest, judges its links.
        let (_tmp, g, root, added, _outside) = library_with_added();
        fs::write(root.join("x"), "x").unwrap();
        dir_link(&added.join("link"), &root);
        let base = added.parent().unwrap().to_path_buf();
        assert_eq!(g.set_root(&base).unwrap(), base);
        assert!(refused(g.in_root(&added.join("link").join("x"))));
        assert!(refused(g.in_root(&added.join("link"))));
        assert!(refused(
            g.check(added.join("link").join("x").to_str().unwrap())
        ));
        assert_eq!(g.root_of(&added.join("y")), Some(added.clone()));
        assert_eq!(g.in_root(&root.join("x")).unwrap(), root.join("x"));
    }

    #[test]
    fn link_inside_same_added_root_ok() {
        let (_tmp, g, _root, added, _outside) = library_with_added();
        fs::create_dir(added.join("real")).unwrap();
        dir_link(&added.join("inner"), &added.join("real"));
        assert_eq!(
            g.in_root(&added.join("inner").join("x.md")).unwrap(),
            added.join("real").join("x.md")
        );
    }

    #[test]
    fn stale_library_hint_does_not_widen_added_links() {
        // A Library hint left over that covers an added folder: a link in
        // the added folder must still be judged by the added root.
        let (_tmp, g, root, added, _outside) = library_with_added();
        fs::write(root.join("x"), "x").unwrap();
        dir_link(&added.join("link"), &root);
        g.set_root_hint(added.parent().unwrap());
        assert!(refused(g.in_root(&added.join("link").join("x"))));
        assert!(refused(
            g.check(added.join("link").join("x").to_str().unwrap())
        ));
    }

    #[test]
    fn add_root_refuses_overlaps_with_message() {
        use crate::library::added::Refusal;
        let (_tmp, g, root, added, outside) = library_with_added();
        fs::create_dir(root.join("sub")).unwrap();
        fs::create_dir(added.join("sub")).unwrap();
        let inner = outside.join("inner");
        fs::create_dir(&inner).unwrap();
        assert_eq!(g.add_root(&inner).unwrap(), inner);
        fs::write(outside.join("file.md"), "f").unwrap();

        let msg = |r: Refusal| r.message().to_owned();
        assert_eq!(message(g.add_root(&root)), msg(Refusal::InLibrary));
        assert_eq!(
            message(g.add_root(&root.join("sub"))),
            msg(Refusal::InLibrary)
        );
        assert_eq!(
            message(g.add_root(root.parent().unwrap())),
            msg(Refusal::ContainsLibrary)
        );
        assert_eq!(message(g.add_root(&added)), msg(Refusal::AlreadyAdded));
        assert_eq!(
            message(g.add_root(&added.join("sub"))),
            msg(Refusal::AlreadyAdded)
        );
        assert_eq!(message(g.add_root(&outside)), msg(Refusal::ContainsAdded));
        let drive = root.ancestors().last().unwrap();
        assert_eq!(message(g.add_root(drive)), msg(Refusal::TooBroad));
        if let Some(home) = dirs::home_dir() {
            assert_eq!(message(g.add_root(&home)), msg(Refusal::TooBroad));
        }
        let unreadable = "That folder can't be read.";
        assert_eq!(message(g.add_root(&outside.join("missing"))), unreadable);
        assert_eq!(message(g.add_root(&outside.join("file.md"))), unreadable);
        assert_eq!(message(g.add_root(Path::new("relative"))), unreadable);

        assert_eq!(g.added(), vec![added, inner]);
    }

    #[test]
    fn remove_root_drops_its_grants_but_not_the_library() {
        let (_tmp, g, root, added, _outside) = library_with_added();
        fs::write(root.join("a.md"), "a").unwrap();
        fs::write(added.join("b.md"), "b").unwrap();
        let b = added.join("b.md");
        assert!(g.check(b.to_str().unwrap()).is_ok());

        g.remove_root(&added);
        assert!(g.added().is_empty());
        assert!(refused(g.check(b.to_str().unwrap())));
        assert!(refused(g.in_root(&b)));
        assert_eq!(g.root_of(&b), None);
        // Never slot 0.
        g.remove_root(&root);
        assert_eq!(g.root(), Some(root.clone()));
        assert!(g.check(root.join("a.md").to_str().unwrap()).is_ok());
    }

    #[test]
    fn added_root_offline_then_back() {
        let (_tmp, g, _root, added, outside) = library_with_added();
        fs::write(added.join("b.md"), "b").unwrap();
        let away = outside.join("away");
        fs::rename(&added, &away).unwrap();
        // As at launch with the folder gone: kept as a hint only.
        assert_eq!(
            g.load_added(std::slice::from_ref(&added)),
            vec![(added.clone(), false)]
        );
        assert_eq!(g.added(), vec![added.clone()]);
        assert_eq!(g.root_of(&added.join("b.md")), None);

        let b = added.join("b.md");
        let b_str = b.to_str().unwrap();
        assert!(refused(g.check(b_str)));
        assert!(refused(g.in_root(&b)));
        // Granted as given (never canonicalized), and refused while offline.
        assert_eq!(g.grant(&b).unwrap(), b);
        assert!(refused(g.check(b_str)));

        fs::rename(&away, &added).unwrap();
        g.forget_recover_miss();
        assert_eq!(g.check(b_str).unwrap(), b);
        assert_eq!(g.root_of(&b), Some(added.clone()));
        assert_eq!(g.in_root(&b).unwrap(), b);
    }

    #[test]
    fn stored_file_grant_under_removed_root_still_works() {
        let (_tmp, g, _root, added, _outside) = library_with_added();
        let b = added.join("b.md");
        fs::write(&b, "b").unwrap();
        assert_eq!(g.grant(&b).unwrap(), b);
        g.remove_root(&added);
        assert_eq!(g.check(b.to_str().unwrap()).unwrap(), b);
        assert!(refused(g.check(added.join("other.md").to_str().unwrap())));
    }

    #[test]
    fn load_added_reports_availability() {
        let (_tmp, g, root, added, outside) = library_with_added();
        let missing = outside.with_file_name("missing");
        let got = g.load_added(&[missing.clone(), outside.clone()]);
        assert_eq!(got, vec![(missing.clone(), false), (outside.clone(), true)]);
        // Replaced, not appended.
        assert_eq!(g.added(), vec![missing.clone(), outside.clone()]);
        assert!(refused(g.in_root(&added.join("x.md"))));
        assert!(g.in_root(&outside.join("x.md")).is_ok());
        assert_eq!(g.root(), Some(root));
        assert_eq!(g.root_of(&missing.join("x.md")), None);
        assert_eq!(g.root_of(&outside.join("x.md")), Some(outside));

        // An entry overlapping the Library is never granted as a root.
        fs::create_dir(added.join("..").join("root").join("sub")).unwrap();
        let sub = g.root().unwrap().join("sub");
        assert_eq!(g.load_added(std::slice::from_ref(&sub)), vec![(sub, false)]);
    }

    #[test]
    fn replace_root_keeps_position_and_checks_others() {
        use crate::library::added::Refusal;
        let (_tmp, g, root, added, outside) = library_with_added();
        let (b, c) = (outside.join("b"), outside.join("c"));
        fs::create_dir(&b).unwrap();
        fs::create_dir(&c).unwrap();
        fs::create_dir(b.join("sub")).unwrap();
        assert_eq!(g.add_root(&b).unwrap(), b);

        assert_eq!(g.replace_root(&added, &c).unwrap(), c);
        assert_eq!(g.added(), vec![c.clone(), b.clone()]);
        assert!(refused(g.in_root(&added.join("x.md"))));
        assert!(g.in_root(&c.join("x.md")).is_ok());

        let msg = |r: Refusal| r.message().to_owned();
        assert_eq!(
            message(g.replace_root(&c, &b.join("sub"))),
            msg(Refusal::AlreadyAdded)
        );
        assert_eq!(message(g.replace_root(&c, &root)), msg(Refusal::InLibrary));
        assert_eq!(
            message(g.replace_root(&c, &outside)),
            msg(Refusal::ContainsAdded)
        );
        assert_eq!(
            message(g.replace_root(&c, &outside.join("missing"))),
            "That folder can't be read."
        );
        assert!(refused(g.replace_root(&added, &c)));
        assert!(refused(g.replace_root(&root, &added)));
        assert_eq!(g.added(), vec![c.clone(), b.clone()]);

        // Its own place (and what's inside it) doesn't count against it.
        fs::create_dir(c.join("deeper")).unwrap();
        assert_eq!(
            g.replace_root(&c, &c.join("deeper")).unwrap(),
            c.join("deeper")
        );
        assert_eq!(g.added(), vec![c.join("deeper"), b]);
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
