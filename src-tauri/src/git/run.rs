//! Running git with a deadline, and finding the git to run.

use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use super::error::{GitError, GitKind, classify, first_line};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A located git executable.
#[derive(Debug, Clone)]
pub struct Git {
    bin: PathBuf,
}

/// Captured output of a git call that exited 0.
#[derive(Debug, Clone)]
pub struct Done {
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug)]
pub enum RunFail {
    Spawn(io::Error),
    Timeout,
}

/// Spawns `cmd` with no stdin and no console window, waits up to `timeout`,
/// and kills its process tree if it overruns.
pub(crate) fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<Output, RunFail> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(RunFail::Spawn)?;
    let tree = crate::terminal::tree::guard(child.id()).ok();

    // Drain both pipes on threads so a full pipe can't stall the child.
    fn drain<R: Read + Send + 'static>(r: Option<R>) -> std::thread::JoinHandle<Vec<u8>> {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut r) = r {
                let _ = r.read_to_end(&mut buf);
            }
            buf
        })
    }
    let out = drain(child.stdout.take());
    let err = drain(child.stderr.take());

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() >= deadline => break None,
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(e) => {
                kill(&mut child, tree.as_ref());
                return Err(RunFail::Spawn(e));
            }
        }
    };
    let Some(status) = status else {
        kill(&mut child, tree.as_ref());
        return Err(RunFail::Timeout);
    };
    Ok(Output {
        status,
        stdout: out.join().unwrap_or_default(),
        stderr: err.join().unwrap_or_default(),
    })
}

fn kill(child: &mut std::process::Child, tree: Option<&crate::terminal::tree::TreeGuard>) {
    if let Some(tree) = tree {
        tree.kill();
    }
    let _ = child.kill();
    let _ = child.wait();
}

impl Git {
    /// Runs `git args` in `cwd`. Success is the exit code alone; stderr is
    /// only read to explain a failure.
    pub fn run(&self, cwd: &Path, args: &[&str], timeout: Duration) -> Result<Done, GitError> {
        let mut cmd = Command::new(&self.bin);
        cmd.args(args)
            .current_dir(cwd)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "never");
        let out = match run_with_timeout(cmd, timeout) {
            Ok(out) => out,
            Err(RunFail::Timeout) => {
                return Err(GitError::new(GitKind::Timeout, "git timed out"));
            }
            Err(RunFail::Spawn(e)) => {
                return Err(GitError::new(GitKind::Failed, e.to_string()));
            }
        };
        let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        if out.status.success() {
            Ok(Done { stdout, stderr })
        } else {
            Err(GitError::new(classify(&stderr), first_line(&stderr)))
        }
    }

    /// `(major, minor)` of this git, or `(0, 0)` if it can't be read.
    pub fn git_version(&self) -> (u32, u32) {
        let Ok(done) = self.run(Path::new("."), &["--version"], Duration::from_secs(10)) else {
            return (0, 0);
        };
        // "git version 2.43.0.windows.1"
        let mut nums = done
            .stdout
            .split_whitespace()
            .nth(2)
            .unwrap_or("")
            .split('.')
            .map(|p| p.parse::<u32>().unwrap_or(0));
        (nums.next().unwrap_or(0), nums.next().unwrap_or(0))
    }

    /// True when `git --version` exits 0.
    fn works(bin: PathBuf) -> Option<Git> {
        let git = Git { bin };
        git.run(Path::new("."), &["--version"], Duration::from_secs(10))
            .ok()
            .map(|_| git)
    }
}

/// Finds a usable git: `PATH` on Windows; on unix the login shell's `PATH`,
/// then well-known locations (macOS `/usr/bin/git` only once the developer
/// tools are installed, since otherwise it is a prompting stub).
pub fn find_git() -> Option<Git> {
    #[cfg(windows)]
    {
        Git::works(PathBuf::from("git"))
    }
    #[cfg(unix)]
    {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Ok(shell) = std::env::var("SHELL") {
            let mut cmd = Command::new(shell);
            cmd.args(["-lc", "command -v git"]);
            if let Ok(out) = run_with_timeout(cmd, Duration::from_secs(10))
                && out.status.success()
            {
                let line = String::from_utf8_lossy(&out.stdout);
                if let Some(path) = line.lines().map(str::trim).rfind(|l| !l.is_empty()) {
                    candidates.push(PathBuf::from(path));
                }
            }
        }
        candidates.push("/opt/homebrew/bin/git".into());
        candidates.push("/usr/local/bin/git".into());
        if cfg!(not(target_os = "macos")) || xcode_tools_installed() {
            candidates.push("/usr/bin/git".into());
        }
        candidates.into_iter().find_map(Git::works)
    }
}

#[cfg(target_os = "macos")]
fn xcode_tools_installed() -> bool {
    run_with_timeout(
        Command::new("xcode-select").arg("-p"),
        Duration::from_secs(10),
    )
    .map(|o| o.status.success())
    .unwrap_or(false)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn xcode_tools_installed() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::time::{Duration, Instant};

    #[test]
    fn runner_times_out_and_kills() {
        #[cfg(windows)]
        let cmd = {
            let mut c = Command::new("cmd");
            c.args(["/C", "ping", "-n", "30", "127.0.0.1"]);
            c
        };
        #[cfg(unix)]
        let cmd = {
            let mut c = Command::new("sleep");
            c.arg("30");
            c
        };
        let start = Instant::now();
        let r = run_with_timeout(cmd, Duration::from_millis(300));
        assert!(matches!(r, Err(RunFail::Timeout)));
        assert!(start.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn stderr_on_success_is_not_an_error() {
        let git = find_git().expect("git");
        let dir = tempfile::tempdir().unwrap();
        let t = Duration::from_secs(30);
        git.run(dir.path(), &["init"], t).unwrap();
        let done = git
            .run(dir.path(), &["checkout", "-b", "other"], t)
            .expect("exit 0 is success");
        assert!(!done.stderr.is_empty());
    }

    #[test]
    fn find_git_finds_git() {
        let git = find_git().expect("git on PATH");
        assert!(git.git_version().0 >= 2);
    }
}
