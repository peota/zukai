//! Ending a terminal's whole process tree, not just the shell.
//!
//! Windows puts the shell in a Job Object that dies with its last handle, so
//! the tree ends even if Zukai crashes. Unix walks the parent links of every
//! process (an interactive shell puts each job in its own process group, so a
//! group kill would miss them). A process that double-forks away from the tree
//! survives, and on Unix a crash of Zukai leaves the tree running.

/// Ends the tree rooted at a shell. On Windows dropping it also ends the tree.
pub struct TreeGuard {
    #[cfg(windows)]
    job: win::Job,
    #[cfg(unix)]
    root: u32,
}

/// Starts tracking the tree rooted at `pid`. Call it right after spawning, before
/// the process has had time to start children of its own.
#[cfg(windows)]
pub fn guard(pid: u32) -> std::io::Result<TreeGuard> {
    Ok(TreeGuard {
        job: win::Job::containing(pid)?,
    })
}

/// Starts tracking the tree rooted at `pid`.
#[cfg(unix)]
pub fn guard(pid: u32) -> std::io::Result<TreeGuard> {
    Ok(TreeGuard { root: pid })
}

impl TreeGuard {
    /// Ends the root process and every process descended from it.
    #[cfg(windows)]
    pub fn kill(&self) {
        self.job.terminate();
    }

    /// Hangs up on the root and every descendant, then kills whatever is still
    /// alive 300 ms later.
    #[cfg(unix)]
    pub fn kill(&self) {
        let mut pids = vec![self.root];
        pids.extend(descendants(self.root, &process_pairs()));
        for &pid in &pids {
            signal(pid, libc::SIGHUP);
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
        for &pid in &pids {
            if signal(pid, 0) {
                signal(pid, libc::SIGKILL);
            }
        }
    }
}

/// Sends `sig` to `pid`; true when the process exists to receive it.
#[cfg(unix)]
fn signal(pid: u32, sig: libc::c_int) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // SAFETY: kill(2) has no memory-safety preconditions.
    unsafe { libc::kill(pid, sig) == 0 }
}

/// Every live `(pid, parent)` pair on the system right now.
#[cfg(unix)]
fn process_pairs() -> Vec<(u32, u32)> {
    use sysinfo::{ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().without_tasks(),
    );
    sys.processes()
        .values()
        // A zombie has already ended; it only waits to be reaped.
        .filter(|p| p.status() != ProcessStatus::Zombie)
        .filter_map(|p| p.parent().map(|parent| (p.pid().as_u32(), parent.as_u32())))
        .collect()
}

/// Every pid descended from `root`, given `(pid, parent)` pairs. Never
/// includes `root` itself and survives cycles in the parent links.
#[cfg(any(unix, test))]
pub fn descendants(root: u32, parents: &[(u32, u32)]) -> Vec<u32> {
    let mut found = Vec::new();
    let mut seen = std::collections::HashSet::from([root]);
    let mut frontier = vec![root];
    while let Some(parent) = frontier.pop() {
        for &(pid, _) in parents.iter().filter(|&&(_, p)| p == parent) {
            if seen.insert(pid) {
                found.push(pid);
                frontier.push(pid);
            }
        }
    }
    found
}

#[cfg(windows)]
mod win {
    use std::io;
    use std::mem::{size_of, zeroed};
    use std::ptr::null;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    /// An owned Job Object handle that kills its processes when closed.
    pub struct Job(HANDLE);

    // SAFETY: a Job Object handle is a kernel handle, usable from any thread.
    // `Job` owns it exclusively and only passes it to thread-safe Win32 calls.
    unsafe impl Send for Job {}
    // SAFETY: as above; `terminate` takes `&self` and TerminateJobObject is
    // safe to call concurrently.
    unsafe impl Sync for Job {}

    impl Job {
        /// A new kill-on-close job holding the process `pid`.
        pub fn containing(pid: u32) -> io::Result<Job> {
            // SAFETY: every handle is checked before use and owned by exactly one
            // closer; the limit struct is plain data, zeroed then filled in.
            unsafe {
                let handle = CreateJobObjectW(null(), null());
                if handle.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let job = Job(handle);

                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let set = SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    (&raw const info).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if set == 0 {
                    return Err(io::Error::last_os_error());
                }

                let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
                if process.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let assigned = AssignProcessToJobObject(job.0, process);
                let err = io::Error::last_os_error();
                CloseHandle(process);
                if assigned == 0 {
                    return Err(err);
                }
                Ok(job)
            }
        }

        pub fn terminate(&self) {
            // SAFETY: `self.0` is a live job handle owned by `self`.
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: `self.0` is a live job handle, closed only here.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    #[cfg(unix)]
    #[test]
    fn descendants_walks_all_levels() {
        let got: HashSet<u32> = descendants(1, &[(2, 1), (3, 2), (4, 3), (5, 9)])
            .into_iter()
            .collect();
        assert_eq!(got, HashSet::from([2, 3, 4]));
    }

    #[cfg(unix)]
    #[test]
    fn descendants_ignores_cycles_and_self() {
        // 1 claims itself as parent; 2 and 3 are each other's parent.
        let pairs = [(1, 1), (2, 1), (3, 2), (2, 3)];
        let got = descendants(1, &pairs);
        let set: HashSet<u32> = got.iter().copied().collect();
        assert_eq!(set, HashSet::from([2, 3]));
        assert_eq!(got.len(), 2, "no duplicates: {got:?}");
    }

    /// Every `(pid, parent)` pair on the system right now.
    #[cfg(windows)]
    fn process_pairs() -> Vec<(u32, u32)> {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
            TH32CS_SNAPPROCESS,
        };
        let mut pairs = Vec::new();
        // SAFETY: the snapshot handle is checked before use and closed once;
        // the entry is zeroed with `dwSize` set as the API requires.
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            assert!(snap != INVALID_HANDLE_VALUE, "process snapshot failed");
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut ok = Process32FirstW(snap, &mut entry);
            while ok != 0 {
                pairs.push((entry.th32ProcessID, entry.th32ParentProcessID));
                ok = Process32NextW(snap, &mut entry);
            }
            CloseHandle(snap);
        }
        pairs
    }

    fn spawn_shell_with_grandchild() -> Child {
        #[cfg(unix)]
        let mut cmd = {
            let mut c = Command::new("sh");
            c.args(["-c", "sleep 30 & sleep 30"]);
            c
        };
        #[cfg(windows)]
        let mut cmd = {
            use std::os::windows::process::CommandExt;
            let mut c = Command::new("cmd");
            c.raw_arg(r#"/c "start /b ping -n 30 127.0.0.1 >NUL & ping -n 30 127.0.0.1 >NUL""#);
            c
        };
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn shell")
    }

    #[test]
    fn kill_tree_ends_grandchild() {
        let mut child = spawn_shell_with_grandchild();
        let root = child.id();
        let tree = guard(root).expect("guard");

        // Wait for the shell to start its sleepers.
        let start = Instant::now();
        let kids = loop {
            let kids = descendants(root, &process_pairs());
            if !kids.is_empty() || start.elapsed() > Duration::from_secs(5) {
                break kids;
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        assert!(!kids.is_empty(), "shell {root} never started a child");

        tree.kill();

        let start = Instant::now();
        loop {
            let root_done = child.try_wait().expect("try_wait").is_some();
            let alive: HashSet<u32> = process_pairs().into_iter().map(|(pid, _)| pid).collect();
            let left: Vec<u32> = kids.iter().copied().filter(|k| alive.contains(k)).collect();
            if root_done && left.is_empty() {
                break;
            }
            assert!(
                start.elapsed() < Duration::from_secs(2),
                "still alive after 2 s: root done = {root_done}, descendants = {left:?}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
