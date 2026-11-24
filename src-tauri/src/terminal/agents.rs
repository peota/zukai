//! The coding-agent CLIs Zukai can start, and how a shell starts one.
//!
//! Everything here is pure: the host's `PATH` and file system arrive as
//! arguments, so every branch is testable on any OS.

use crate::terminal::shell::ShellSpec;
use serde::Serialize;
use std::ffi::OsStr;
use std::path::Path;
#[cfg(unix)]
use std::time::Duration;

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

/// Printed before each installed command, so a login shell's own chatter
/// (motd, framework banners) can't be mistaken for one.
pub const MARKER: &str = "__ZUKAI_AGENT__";

/// A script for a shell of `kind` that prints `MARKER` and the name of each of
/// `commands` that the shell can resolve. Only Posix-style shells and fish are
/// asked; the Windows shells are searched without running anything.
pub fn detect_script(kind: ShellKind, commands: &[&str]) -> String {
    let list = commands.join(" ");
    match kind {
        ShellKind::Fish => {
            format!("for c in {list}; if type -q $c; printf '%s%s\\n' {MARKER} $c; end; end")
        }
        _ => format!(
            "for c in {list}; do command -v \"$c\" >/dev/null 2>&1 && printf '%s%s\\n' {MARKER} \"$c\"; done"
        ),
    }
}

/// The commands a detect script reported: what follows `MARKER` on lines that
/// start with it (CRLF line ends are fine). Every other line is ignored.
pub fn parse_detected(output: &str) -> Vec<String> {
    output
        .lines()
        .filter_map(|line| line.strip_prefix(MARKER))
        .map(str::to_string)
        .collect()
}

/// Runs `program` with `args`, stdin and stderr discarded, and returns what it
/// printed. `None` if it can't start, fails, or is still running after
/// `timeout` (it is killed then). A grandchild that keeps the output pipe open
/// can't hold this up past `timeout` either: the output is read on its own
/// thread and abandoned on a timeout.
#[cfg(unix)]
fn run_detect(program: &Path, args: &[String], timeout: Duration) -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Instant;

    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        let _ = tx.send(bytes);
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    if !status.success() {
        return None;
    }
    let left = deadline.saturating_duration_since(Instant::now());
    let bytes = rx.recv_timeout(left).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// Whether `path` is a file with an execute bit set.
#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

/// `command` found by a plain walk of `path_var`.
#[cfg(unix)]
fn find_unix(path_var: Option<&OsStr>, command: &str) -> bool {
    path_var.is_some_and(|p| std::env::split_paths(p).any(|dir| is_executable(&dir.join(command))))
}

/// The commands among [`AGENTS`] that are installed. On Windows, a search of
/// Zukai's `PATH`. Elsewhere, the user's own shell is asked (a GUI app's `PATH`
/// is not the one their terminal has), and if that fails or takes over 5 s,
/// Zukai's `PATH` is searched instead.
pub fn installed_commands() -> Vec<String> {
    let commands: Vec<&str> = AGENTS.iter().map(|a| a.command).collect();
    let path_var = std::env::var_os("PATH");

    #[cfg(windows)]
    {
        commands
            .into_iter()
            .filter(|c| find_windows(path_var.as_deref(), c, &|p| p.is_file()).is_some())
            .map(str::to_string)
            .collect()
    }

    #[cfg(unix)]
    {
        let shell = crate::terminal::shell::current_shell();
        let kind = shell_kind(&shell.program);
        let asked = matches!(kind, ShellKind::Posix | ShellKind::Fish)
            .then(|| {
                let args = [
                    "-l".to_string(),
                    "-i".to_string(),
                    "-c".to_string(),
                    detect_script(kind, &commands),
                ];
                run_detect(&shell.program, &args, Duration::from_secs(5))
            })
            .flatten();
        match asked {
            Some(out) => parse_detected(&out),
            None => commands
                .into_iter()
                .filter(|c| find_unix(path_var.as_deref(), c))
                .map(str::to_string)
                .collect(),
        }
    }
}

/// An agent as the menu shows it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub installed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::shell::ShellSpec;
    use std::path::{Path, PathBuf};
    #[cfg(unix)]
    use std::time::Duration;

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
        assert_eq!(
            ids,
            ["claude-code", "codex", "gemini", "opencode", "cursor"]
        );
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

    #[test]
    fn parse_detected_keeps_only_marker_lines() {
        let out = "Welcome to oh-my-zsh\n__ZUKAI_AGENT__claude\r\nnoise __ZUKAI_AGENT__codex\n__ZUKAI_AGENT__gemini\n";
        assert_eq!(parse_detected(out), ["claude", "gemini"]);
    }

    #[test]
    fn detect_script_per_shell() {
        let s = detect_script(ShellKind::Posix, &["claude", "cursor-agent"]);
        assert!(s.contains("for c in claude cursor-agent; do"));
        assert!(s.contains(MARKER));
        let f = detect_script(ShellKind::Fish, &["claude"]);
        assert!(f.contains("type -q $c"));
        assert!(f.contains(MARKER));
    }

    #[cfg(unix)]
    #[test]
    fn run_detect_finds_commands_through_a_shell() {
        let script = detect_script(ShellKind::Posix, &["sh", "zukai-no-such-agent"]);
        let out = run_detect(
            Path::new("/bin/sh"),
            &["-c".to_string(), script],
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(parse_detected(&out), ["sh"]);
    }

    #[cfg(unix)]
    #[test]
    fn run_detect_gives_up_on_a_hung_shell() {
        let start = std::time::Instant::now();
        let out = run_detect(
            Path::new("/bin/sh"),
            &["-c".to_string(), "sleep 10".to_string()],
            Duration::from_millis(200),
        );
        assert_eq!(out, None);
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}
