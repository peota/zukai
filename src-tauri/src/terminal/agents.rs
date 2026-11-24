//! The coding-agent CLIs Zukai can start, and how a shell starts one.
//!
//! Everything here is pure: the host's `PATH` and file system arrive as
//! arguments, so every branch is testable on any OS.

use crate::terminal::shell::ShellSpec;
use std::ffi::OsStr;
use std::path::Path;

/// A known agent CLI.
pub struct Agent {
    pub id: &'static str,
    pub name: &'static str,
    pub command: &'static str,
}

pub const AGENTS: [Agent; 5] = [
    Agent {
        id: "claude-code",
        name: "Claude Code",
        command: "claude",
    },
    Agent {
        id: "codex",
        name: "Codex",
        command: "codex",
    },
    Agent {
        id: "gemini",
        name: "Gemini",
        command: "gemini",
    },
    Agent {
        id: "opencode",
        name: "OpenCode",
        command: "opencode",
    },
    Agent {
        id: "cursor",
        name: "Cursor",
        command: "cursor-agent",
    },
];

/// The agent with this id.
pub fn agent(id: &str) -> Option<&'static Agent> {
    AGENTS.iter().find(|a| a.id == id)
}

/// The file name (with extension) of `command` on a Windows `PATH`: `.exe`,
/// then `.cmd`, then `.bat`, directory by directory. `.ps1` is not launchable
/// by name from every shell, so it never counts.
pub fn find_windows(
    path_var: Option<&OsStr>,
    command: &str,
    exists: &dyn Fn(&Path) -> bool,
) -> Option<String> {
    std::env::split_paths(path_var?).find_map(|dir| {
        ["exe", "cmd", "bat"].iter().find_map(|ext| {
            let name = format!("{command}.{ext}");
            exists(&dir.join(&name)).then_some(name)
        })
    })
}

/// The family of a shell, which decides how it takes a command to run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    Pwsh,
    Cmd,
    Posix,
    Fish,
}

/// The kind of shell `program` is, by its lower-cased file stem. Splits on both
/// `/` and `\` so a Windows path classifies the same on any OS.
pub fn shell_kind(program: &Path) -> ShellKind {
    let text = program.to_string_lossy();
    let name = text.rsplit(['/', '\\']).next().unwrap_or_default();
    let stem = name.rsplit_once('.').map_or(name, |(s, _)| s);
    match stem.to_lowercase().as_str() {
        "pwsh" | "powershell" => ShellKind::Pwsh,
        "cmd" => ShellKind::Cmd,
        "fish" => ShellKind::Fish,
        _ => ShellKind::Posix,
    }
}

/// `shell` started so that it runs `command` and then stays at a prompt.
pub fn agent_spec(shell: &ShellSpec, command: &str) -> ShellSpec {
    let args = match shell_kind(&shell.program) {
        ShellKind::Pwsh => vec!["-NoExit".into(), "-Command".into(), command.into()],
        ShellKind::Cmd => vec!["/K".into(), command.into()],
        ShellKind::Posix | ShellKind::Fish => vec![
            "-l".into(),
            "-i".into(),
            "-c".into(),
            format!("{command}; exec '{}' -l", shell.program.display()),
        ],
    };
    ShellSpec {
        program: shell.program.clone(),
        args,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::shell::ShellSpec;
    use std::path::{Path, PathBuf};

    fn find(dirs: &[&str], existing: &[PathBuf]) -> Option<String> {
        let path = std::env::join_paths(dirs).unwrap();
        let exists = |p: &Path| existing.iter().any(|e| e == p);
        find_windows(Some(path.as_os_str()), "claude", &exists)
    }

    #[test]
    fn agent_lookup_and_order() {
        assert_eq!(agent("claude-code").unwrap().command, "claude");
        assert!(agent("nope").is_none());
        let ids: Vec<_> = AGENTS.iter().map(|a| a.id).collect();
        assert_eq!(ids, ["claude-code", "codex", "gemini", "opencode", "cursor"]);
    }

    #[test]
    fn find_windows_ignores_ps1() {
        let existing = [PathBuf::from("/fake/n").join("claude.ps1")];
        assert_eq!(find(&["/fake/n"], &existing), None);
        assert_eq!(find_windows(None, "claude", &|_| true), None);
    }

    #[test]
    fn find_windows_prefers_cmd_over_ps1() {
        let existing = [
            PathBuf::from("/fake/n").join("claude.ps1"),
            PathBuf::from("/fake/n").join("claude.cmd"),
        ];
        assert_eq!(find(&["/fake/n"], &existing), Some("claude.cmd".into()));
    }

    #[test]
    fn find_windows_goes_dir_by_dir() {
        let existing = [
            PathBuf::from("/fake/a").join("claude.cmd"),
            PathBuf::from("/fake/b").join("claude.exe"),
        ];
        assert_eq!(
            find(&["/fake/a", "/fake/b"], &existing),
            Some("claude.cmd".into())
        );
    }

    #[test]
    fn find_windows_prefers_exe_in_one_dir() {
        let existing = [
            PathBuf::from("/fake/a").join("claude.bat"),
            PathBuf::from("/fake/a").join("claude.cmd"),
            PathBuf::from("/fake/a").join("claude.exe"),
        ];
        assert_eq!(find(&["/fake/a"], &existing), Some("claude.exe".into()));
    }

    #[test]
    fn shell_kind_by_file_stem() {
        let kind = |p: &str| shell_kind(Path::new(p));
        assert_eq!(kind("C:\\x\\pwsh.exe"), ShellKind::Pwsh);
        assert_eq!(kind("powershell.exe"), ShellKind::Pwsh);
        assert_eq!(kind("C:\\Windows\\System32\\CMD.EXE"), ShellKind::Cmd);
        assert_eq!(kind("cmd.exe"), ShellKind::Cmd);
        assert_eq!(kind("/usr/bin/fish"), ShellKind::Fish);
        assert_eq!(kind("/bin/zsh"), ShellKind::Posix);
    }

    fn spec(program: &str) -> ShellSpec {
        ShellSpec {
            program: PathBuf::from(program),
            args: vec!["-l".to_string()],
        }
    }

    #[test]
    fn agent_spec_per_shell() {
        let s = agent_spec(&spec("/bin/zsh"), "claude");
        assert_eq!(s.program, PathBuf::from("/bin/zsh"));
        assert_eq!(s.args, ["-l", "-i", "-c", "claude; exec '/bin/zsh' -l"]);

        let s = agent_spec(&spec("pwsh.exe"), "claude.cmd");
        assert_eq!(s.program, PathBuf::from("pwsh.exe"));
        assert_eq!(s.args, ["-NoExit", "-Command", "claude.cmd"]);

        let s = agent_spec(&spec("cmd.exe"), "claude.cmd");
        assert_eq!(s.args, ["/K", "claude.cmd"]);
    }
}
