//! What "Open with default app" must never launch: anything that would run
//! or install code. `EXEC_EXTS` in `src/model/kinds.ts` mirrors the list,
//! but only to hide the button; this is the check that counts.

use std::path::Path;

/// Every OS's list applies on every OS (a share or a USB stick moves files
/// between them). The spec's twelve are the floor.
const WINDOWS: &[&str] = &[
    "exe",
    "com",
    "msi",
    "msp",
    "msix",
    "msixbundle",
    "appx",
    "appxbundle",
    "appref-ms",
    "application",
    "bat",
    "cmd",
    "ps1",
    "psm1",
    "psd1",
    "ps1xml",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "ws",
    "wsc",
    "hta",
    "scr",
    "pif",
    "cpl",
    "msc",
    "jar",
    "jnlp",
    "reg",
    "url",
    "website",
    "lnk",
    "scf",
    "settingcontent-ms",
    "library-ms",
    "search-ms",
    "inf",
    "chm",
    "gadget",
    "xll",
    "xbap",
    "py",
    "pyw",
    "pyz",
    "pyzw",
    "pl",
    "rb",
];
const MACOS: &[&str] = &[
    "app",
    "command",
    "pkg",
    "mpkg",
    "terminal",
    "workflow",
    "action",
    "tool",
    // Location files open their URL (`file://` included) in its handler.
    "fileloc",
    "inetloc",
    "webloc",
    // A configuration profile installs settings.
    "mobileconfig",
];
const LINUX: &[&str] = &["desktop", "sh", "run", "bin", "appimage"];

/// The extension of `p`'s name as Windows sees it: trailing dots and spaces
/// are ignored, so `a.exe.` is `exe`.
fn extension(p: &Path) -> Option<String> {
    let name = p.file_name()?.to_string_lossy().into_owned();
    let name = name.trim_end_matches(['.', ' ']);
    name.rsplit_once('.').map(|(_, ext)| ext.to_owned())
}

/// True if `p`'s name has an extension the opener refuses (any case, on any
/// OS), or one Windows itself calls dangerous.
pub fn exec_name(p: &Path) -> bool {
    let Some(ext) = extension(p) else {
        return false;
    };
    [WINDOWS, MACOS, LINUX]
        .iter()
        .flat_map(|l| l.iter())
        .any(|x| x.eq_ignore_ascii_case(&ext))
        || sys::dangerous_ext(&ext)
}

/// True if the regular file `target` (already resolved) would run: by name,
/// or, on Unix, because it has an execute bit.
pub fn executable(target: &Path) -> bool {
    exec_name(target) || sys::exec_bit(target)
}

#[cfg(windows)]
mod sys {
    use std::path::Path;

    #[link(name = "shlwapi")]
    unsafe extern "system" {
        fn AssocIsDangerous(assoc: *const u16) -> i32;
    }

    /// The shell's own list of dangerous types (and what policy adds to it).
    pub fn dangerous_ext(ext: &str) -> bool {
        let wide: Vec<u16> = format!(".{ext}").encode_utf16().chain(Some(0)).collect();
        // SAFETY: `wide` is a NUL-terminated UTF-16 string that outlives the call.
        unsafe { AssocIsDangerous(wide.as_ptr()) != 0 }
    }

    pub fn exec_bit(_: &Path) -> bool {
        false
    }
}

#[cfg(unix)]
mod sys {
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    pub fn dangerous_ext(_: &str) -> bool {
        false
    }

    /// Any execute bit: the desktop may run it rather than open it. An
    /// unreadable mode counts as executable.
    pub fn exec_bit(target: &Path) -> bool {
        match std::fs::metadata(target) {
            Ok(m) => m.permissions().mode() & 0o111 != 0,
            Err(_) => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_by_extension_any_case_and_trailing_dots() {
        for name in [
            "a.exe",
            "b.COM",
            "c.Bat",
            "x.scr",
            "x.PIF",
            "x.cpl",
            "x.jar",
            "x.hta",
            "x.js",
            "x.wsf",
            "x.reg",
            "x.url",
            "x.appref-ms",
            "x.settingcontent-ms",
            "x.py",
            "x.pkg",
            "x.workflow",
            "x.fileloc",
            "x.inetloc",
            "x.WEBLOC",
            "x.mobileconfig",
            "x.AppImage",
            "x.run",
            "x.desktop",
            "a.exe.",
            "a.exe . ",
        ] {
            assert!(exec_name(Path::new(name)), "{name}");
        }
        for name in [
            "doc.pdf",
            "a.zip",
            "x.exe.txt",
            "README",
            "exe",
            ".gitignore.md",
        ] {
            assert!(!exec_name(Path::new(name)), "{name}");
        }
    }

    /// Windows' own list catches what ours doesn't name.
    #[cfg(windows)]
    #[test]
    fn windows_asks_the_shell_too() {
        assert!(sys::dangerous_ext("exe"));
        assert!(!sys::dangerous_ext("pdf"));
    }
}
