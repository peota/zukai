//! Picks the shell a terminal session starts and the environment it gets.
//!
//! Selection is pure: everything it needs from the host arrives in
//! [`ShellEnv`], so every OS branch is testable on any machine.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// Operating system family, as far as shell selection cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Windows,
    Mac,
    Linux,
}

/// A program to spawn and its arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
}

/// Everything shell selection looks at.
pub struct ShellEnv<'a> {
    pub os: Os,
    /// The `PATH` variable.
    pub path_var: Option<&'a OsStr>,
    /// The `SHELL` variable (Unix).
    pub shell_var: Option<&'a OsStr>,
    /// The `COMSPEC` variable (Windows).
    pub comspec: Option<&'a OsStr>,
    /// The login shell from the passwd database (Unix).
    pub passwd_shell: Option<PathBuf>,
    /// Whether a file exists.
    pub exists: &'a dyn Fn(&Path) -> bool,
}

impl Os {
    /// The OS this binary was built for.
    pub fn current() -> Os {
        if cfg!(windows) {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::Mac
        } else {
            Os::Linux
        }
    }
}

/// First directory on `PATH` that contains `name`.
fn find_on_path(env: &ShellEnv, name: &str) -> Option<PathBuf> {
    std::env::split_paths(env.path_var?)
        .map(|dir| dir.join(name))
        .find(|candidate| (env.exists)(candidate))
}

/// Windows: `pwsh.exe` on PATH, then `powershell.exe`, then `%COMSPEC%`.
fn pick_windows(env: &ShellEnv) -> ShellSpec {
    let program = find_on_path(env, "pwsh.exe")
        .or_else(|| find_on_path(env, "powershell.exe"))
        .or_else(|| env.comspec.map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("cmd.exe"));
    ShellSpec {
        program,
        args: Vec::new(),
    }
}

/// Unix: `$SHELL`, then the passwd shell, then the OS default, then `/bin/sh`.
/// Always a login shell.
fn pick_unix(env: &ShellEnv) -> ShellSpec {
    let default = match env.os {
        Os::Mac => "/bin/zsh",
        _ => "/bin/bash",
    };
    let program = env
        .shell_var
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .into_iter()
        .chain(env.passwd_shell.clone())
        .chain([PathBuf::from(default)])
        .find(|p| (env.exists)(p))
        .unwrap_or_else(|| PathBuf::from("/bin/sh"));
    ShellSpec {
        program,
        args: vec!["-l".to_string()],
    }
}

/// Chooses the shell for `env`.
pub fn pick_shell(env: &ShellEnv) -> ShellSpec {
    match env.os {
        Os::Windows => pick_windows(env),
        Os::Mac | Os::Linux => pick_unix(env),
    }
}

/// The login shell recorded in the passwd database for the current user.
#[cfg(unix)]
fn passwd_shell() -> Option<PathBuf> {
    use std::ffi::CStr;
    use std::os::unix::ffi::OsStrExt;
    // SAFETY: getpwuid returns null or a pointer to a static passwd entry that
    // stays valid until the next getpw* call; the string is copied out at once.
    unsafe {
        let pw = libc::getpwuid(libc::getuid());
        if pw.is_null() || (*pw).pw_shell.is_null() {
            return None;
        }
        let shell = CStr::from_ptr((*pw).pw_shell).to_bytes();
        (!shell.is_empty()).then(|| PathBuf::from(OsStr::from_bytes(shell)))
    }
}

#[cfg(not(unix))]
fn passwd_shell() -> Option<PathBuf> {
    None
}

/// Chooses the shell from the real process environment.
pub fn current_shell() -> ShellSpec {
    let path_var = std::env::var_os("PATH");
    let shell_var = std::env::var_os("SHELL");
    let comspec = std::env::var_os("COMSPEC");
    pick_shell(&ShellEnv {
        os: Os::current(),
        path_var: path_var.as_deref(),
        shell_var: shell_var.as_deref(),
        comspec: comspec.as_deref(),
        passwd_shell: passwd_shell(),
        exists: &|p| p.is_file(),
    })
}

/// Variables added to the shell's environment so terminal apps render properly.
pub fn extra_env() -> [(&'static str, String); 4] {
    [
        ("TERM", "xterm-256color".to_string()),
        ("COLORTERM", "truecolor".to_string()),
        ("TERM_PROGRAM", "zukai".to_string()),
        (
            "TERM_PROGRAM_VERSION",
            env!("CARGO_PKG_VERSION").to_string(),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(dirs: &[&str]) -> std::ffi::OsString {
        std::env::join_paths(dirs).unwrap()
    }

    fn pick(
        os: Os,
        path_var: Option<&OsStr>,
        shell_var: Option<&str>,
        comspec: Option<&str>,
        passwd_shell: Option<&str>,
        existing: &[PathBuf],
    ) -> ShellSpec {
        let exists = |p: &Path| existing.iter().any(|e| e == p);
        pick_shell(&ShellEnv {
            os,
            path_var,
            shell_var: shell_var.map(OsStr::new),
            comspec: comspec.map(OsStr::new),
            passwd_shell: passwd_shell.map(PathBuf::from),
            exists: &exists,
        })
    }

    #[test]
    fn windows_prefers_pwsh_on_path() {
        let dirs = path(&["/fake/a", "/fake/b"]);
        let existing = [
            PathBuf::from("/fake/a").join("powershell.exe"),
            PathBuf::from("/fake/b").join("pwsh.exe"),
        ];
        let spec = pick(
            Os::Windows,
            Some(&dirs),
            None,
            Some("cmd-from-comspec"),
            None,
            &existing,
        );
        assert!(spec.program.ends_with("pwsh.exe"));
        assert!(spec.args.is_empty());
    }

    #[test]
    fn windows_falls_back_to_powershell_then_comspec() {
        let dirs = path(&["/fake/a"]);
        let ps = [PathBuf::from("/fake/a").join("powershell.exe")];
        let spec = pick(
            Os::Windows,
            Some(&dirs),
            None,
            Some("C:\\cmd.exe"),
            None,
            &ps,
        );
        assert!(spec.program.ends_with("powershell.exe"));

        let spec = pick(
            Os::Windows,
            Some(&dirs),
            None,
            Some("C:\\cmd.exe"),
            None,
            &[],
        );
        assert_eq!(spec.program, PathBuf::from("C:\\cmd.exe"));
        assert!(spec.args.is_empty());

        let spec = pick(Os::Windows, None, None, None, None, &[]);
        assert_eq!(spec.program, PathBuf::from("cmd.exe"));
    }

    #[test]
    fn unix_uses_shell_var_as_login_shell() {
        let existing = [PathBuf::from("/usr/bin/fish"), PathBuf::from("/bin/bash")];
        let spec = pick(
            Os::Linux,
            None,
            Some("/usr/bin/fish"),
            None,
            Some("/bin/bash"),
            &existing,
        );
        assert_eq!(spec.program, PathBuf::from("/usr/bin/fish"));
        assert_eq!(spec.args, ["-l"]);
    }

    #[test]
    fn unix_skips_missing_shell_var() {
        let existing = [PathBuf::from("/opt/pw/shell")];
        let spec = pick(
            Os::Linux,
            None,
            Some("/nowhere/sh"),
            None,
            Some("/opt/pw/shell"),
            &existing,
        );
        assert_eq!(spec.program, PathBuf::from("/opt/pw/shell"));
        assert_eq!(spec.args, ["-l"]);
    }

    #[test]
    fn mac_falls_back_to_zsh_linux_to_bash_then_sh() {
        let both = [PathBuf::from("/bin/zsh"), PathBuf::from("/bin/bash")];
        assert_eq!(
            pick(Os::Mac, None, None, None, None, &both).program,
            PathBuf::from("/bin/zsh")
        );
        assert_eq!(
            pick(Os::Linux, None, None, None, None, &both).program,
            PathBuf::from("/bin/bash")
        );
        let spec = pick(Os::Linux, None, None, None, None, &[]);
        assert_eq!(spec.program, PathBuf::from("/bin/sh"));
        assert_eq!(spec.args, ["-l"]);
    }

    #[test]
    fn extra_env_sets_term_vars() {
        let env = extra_env();
        let get = |k: &str| env.iter().find(|(n, _)| *n == k).map(|(_, v)| v.as_str());
        assert_eq!(get("TERM"), Some("xterm-256color"));
        assert_eq!(get("COLORTERM"), Some("truecolor"));
        assert_eq!(get("TERM_PROGRAM"), Some("zukai"));
        assert_eq!(get("TERM_PROGRAM_VERSION"), Some(env!("CARGO_PKG_VERSION")));
    }
}
