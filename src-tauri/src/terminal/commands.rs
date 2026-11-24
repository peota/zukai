//! The terminals the window has open, and the Tauri commands that drive them.
//!
//! A session's `kill` and `write` can block (killing waits for the tree on
//! Unix; a big paste waits for the shell to read), so neither ever runs while
//! the map is locked: sessions are shared as `Arc`s and taken out first.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use crate::files::FileError;
use crate::files::commands::blocking;
use crate::files::grants::Grants;
use crate::library::commands::folder;
use crate::terminal::agents::{AGENTS, AgentInfo, installed_commands};
use crate::terminal::session::{Session, Sink, TerminalEvent};
use crate::terminal::shell::current_shell;

/// The open terminals, by id. Ids start at 1 and are never reused.
#[derive(Default)]
pub struct Terminals {
    sessions: Mutex<HashMap<u32, Arc<Session>>>,
    last_id: AtomicU32,
}

impl Terminals {
    /// Starts the user's shell in `cwd`, which must be a folder in a granted
    /// root, and returns the new terminal's id.
    pub fn open(
        &self,
        g: &Grants,
        cwd: &str,
        cols: u16,
        rows: u16,
        sink: Sink,
    ) -> Result<u32, FileError> {
        let dir = folder(g, cwd)?;
        let session = Session::spawn(&current_shell(), &dir, cols, rows, sink)?;
        let id = self.last_id.fetch_add(1, Ordering::SeqCst) + 1;
        self.sessions.lock().unwrap().insert(id, Arc::new(session));
        Ok(id)
    }

    fn get(&self, id: u32) -> Option<Arc<Session>> {
        self.sessions.lock().unwrap().get(&id).cloned()
    }

    /// Queues `data` for the terminal's shell without waiting for it to be
    /// written; input reaches the shell in the order it was queued. An
    /// unknown id or a shell that has exited is ignored.
    pub fn write(&self, id: u32, data: &str) {
        if let Some(session) = self.get(id) {
            session.write(data.as_bytes());
        }
    }

    /// Changes the terminal's size. An unknown id or a shell that has exited
    /// is ignored.
    pub fn resize(&self, id: u32, cols: u16, rows: u16) {
        if let Some(session) = self.get(id) {
            let _ = session.resize(cols, rows);
        }
    }

    /// The terminal's listener has handled `n` units of its output (UTF-16
    /// code units: JavaScript's string length). An unknown id is ignored.
    pub fn ack(&self, id: u32, n: usize) {
        if let Some(session) = self.get(id) {
            session.ack(n);
        }
    }

    /// Ends the terminal's shell and everything it started, and forgets it.
    /// Its `Exit` event still follows. An unknown id is ignored.
    pub fn kill(&self, id: u32) {
        let removed = self.sessions.lock().unwrap().remove(&id);
        if let Some(session) = removed {
            session.kill();
        }
    }

    /// Ends every terminal, as the app quits.
    pub fn kill_all(&self) {
        let removed: Vec<_> = self.sessions.lock().unwrap().drain().collect();
        let killing: Vec<_> = removed
            .into_iter()
            .map(|(_, session)| std::thread::spawn(move || session.kill()))
            .collect();
        for handle in killing {
            let _ = handle.join();
        }
    }
}

/// Opens a terminal in `cwd` and streams its output to `on_event`.
#[tauri::command]
pub async fn terminal_open(
    app: AppHandle,
    cwd: String,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
) -> Result<u32, FileError> {
    let handle = app.clone();
    let sink: Sink = Arc::new(move |ev| {
        let _ = on_event.send(ev);
    });
    blocking(app, move |g| {
        handle.state::<Terminals>().open(g, &cwd, cols, rows, sink)
    })
    .await
}

/// Synchronous on purpose: Tauri runs sync commands one at a time, in the
/// order they arrive, so keystrokes reach the shell in the order typed.
/// Queuing never blocks.
#[tauri::command]
pub fn terminal_write(app: AppHandle, id: u32, data: String) {
    app.state::<Terminals>().write(id, &data);
}

/// Synchronous: cheap, and it only frees the flusher to send more.
#[tauri::command]
pub fn terminal_ack(app: AppHandle, id: u32, n: usize) {
    app.state::<Terminals>().ack(id, n);
}

/// Synchronous, like `terminal_write`, so resizes during a drag apply in the
/// order they were sent; resizing the PTY never blocks for long.
#[tauri::command]
pub fn terminal_resize(app: AppHandle, id: u32, cols: u16, rows: u16) {
    app.state::<Terminals>().resize(id, cols, rows);
}

#[tauri::command]
pub async fn terminal_kill(app: AppHandle, id: u32) {
    let handle = app.clone();
    let _ = blocking(app, move |_| {
        handle.state::<Terminals>().kill(id);
        Ok(())
    })
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::{dir_link, library};
    use crate::terminal::session::tests::collect_with;
    use std::fs;
    use std::sync::mpsc;
    use std::time::Duration;

    const NL: &str = if cfg!(windows) { "\r" } else { "\n" };

    /// Kills every terminal if a test fails before its shells exit.
    struct Open(Terminals);

    impl Drop for Open {
        fn drop(&mut self) {
            self.0.kill_all();
        }
    }

    fn channel() -> (Sink, mpsc::Receiver<TerminalEvent>) {
        let (tx, rx) = mpsc::channel();
        let sink: Sink = Arc::new(move |ev| {
            let _ = tx.send(ev);
        });
        (sink, rx)
    }

    fn open(t: &Terminals, g: &Grants, cwd: &std::path::Path) -> Result<u32, FileError> {
        t.open(g, cwd.to_str().unwrap(), 200, 30, channel().0)
    }

    /// Every event until `Exit`, answering cursor position requests.
    fn collect(
        t: &Terminals,
        id: u32,
        rx: &mpsc::Receiver<TerminalEvent>,
        timeout: Duration,
    ) -> (String, Vec<TerminalEvent>) {
        collect_with(
            |reply| t.write(id, std::str::from_utf8(reply).unwrap()),
            |n| t.ack(id, n),
            rx,
            timeout,
        )
    }

    /// `text` without its escape sequences (CSI, OSC and two-byte ones).
    fn strip_ansi(text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut chars = text.chars().peekable();
        while let Some(c) = chars.next() {
            if c != '\u{1b}' {
                out.push(c);
                continue;
            }
            match chars.next() {
                Some('[') => {
                    // Parameters and intermediates, then one final byte.
                    for c in chars.by_ref() {
                        if ('\u{40}'..='\u{7e}').contains(&c) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    // Ends at BEL or ESC \.
                    while let Some(c) = chars.next() {
                        if c == '\u{7}' {
                            break;
                        }
                        if c == '\u{1b}' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                _ => {}
            }
        }
        out
    }

    #[test]
    fn open_refuses_folder_outside_root() {
        let (_tmp, g, _root, outside) = library();
        let t = Open(Terminals::default());
        assert!(matches!(
            open(&t.0, &g, &outside),
            Err(FileError::NotGranted)
        ));
        assert!(t.0.sessions.lock().unwrap().is_empty());
    }

    #[test]
    fn open_refuses_link_escaping_root() {
        let (_tmp, g, root, outside) = library();
        let link = root.join("esc");
        dir_link(&link, &outside);
        let t = Open(Terminals::default());
        assert!(matches!(open(&t.0, &g, &link), Err(FileError::NotGranted)));
        assert!(t.0.sessions.lock().unwrap().is_empty());
    }

    #[test]
    fn open_refuses_a_file() {
        let (_tmp, g, root, _outside) = library();
        let file = root.join("note.md");
        fs::write(&file, "hi").unwrap();
        let t = Open(Terminals::default());
        assert!(open(&t.0, &g, &file).is_err());
        assert!(t.0.sessions.lock().unwrap().is_empty());
    }

    #[test]
    fn open_accepts_root_and_subfolder() {
        let (_tmp, g, root, _outside) = library();
        let sub = root.join("sub");
        fs::create_dir(&sub).unwrap();
        let t = Open(Terminals::default());
        assert_eq!(open(&t.0, &g, &root).unwrap(), 1);
        assert_eq!(open(&t.0, &g, &sub).unwrap(), 2);
        assert_eq!(t.0.sessions.lock().unwrap().len(), 2);
        t.0.kill_all();
        assert!(t.0.sessions.lock().unwrap().is_empty());
    }

    #[test]
    fn burst_output_arrives_complete_and_in_order() {
        const LAST: u32 = 20_000;
        let (_tmp, g, root, _outside) = library();
        let t = Open(Terminals::default());
        let (sink, rx) = channel();
        let id = t.0.open(&g, root.to_str().unwrap(), 200, 30, sink).unwrap();
        let burst = if cfg!(windows) {
            format!("1..{LAST} | % {{ $_ }}")
        } else {
            format!("seq 1 {LAST}")
        };
        t.0.write(id, &format!("{burst}{NL}exit{NL}"));
        let (text, events) = collect(&t.0, id, &rx, Duration::from_secs(60));
        assert!(
            matches!(events.last(), Some(TerminalEvent::Exit { .. })),
            "no exit; last event: {:?}",
            events.last()
        );

        // The lines that are just a number, in the order they came.
        let text = strip_ansi(&text);
        let numbers: Vec<u32> = text
            .lines()
            .filter_map(|line| line.trim().parse().ok())
            .collect();
        let mut want = 1;
        for n in numbers {
            if n == want {
                want += 1;
            }
        }
        assert_eq!(want, LAST + 1, "line {want} missing or out of order");
    }

    #[test]
    fn rapid_single_key_writes_arrive_in_order() {
        let (_tmp, g, root, _outside) = library();
        let t = Open(Terminals::default());
        let (sink, rx) = channel();
        let id = t.0.open(&g, root.to_str().unwrap(), 200, 30, sink).unwrap();
        // 150 digits in a known order, typed one key per write, behind a
        // big write that is still being written.
        let digits: String = (0..150)
            .map(|i| char::from(b'0' + (i * 7 % 10) as u8))
            .collect();
        t.0.write(id, &format!("{}{NL}", "#".repeat(4000)));
        t.0.write(id, &format!("echo z{NL}"));
        for key in format!("echo q{digits}q{NL}exit{NL}").chars() {
            t.0.write(id, &key.to_string());
        }
        let (text, events) = collect(&t.0, id, &rx, Duration::from_secs(30));
        assert!(matches!(events.last(), Some(TerminalEvent::Exit { .. })));
        let text = strip_ansi(&text);
        let want = format!("q{digits}q");
        assert!(
            text.lines().any(|line| line.trim() == want),
            "no line {want:?} in {text:?}"
        );
    }

    #[test]
    fn write_after_exit_is_ignored() {
        let (_tmp, g, root, _outside) = library();
        let t = Open(Terminals::default());
        let (sink, rx) = channel();
        let id = t.0.open(&g, root.to_str().unwrap(), 80, 24, sink).unwrap();
        t.0.write(id, &format!("exit{NL}"));
        let (_, events) = collect(&t.0, id, &rx, Duration::from_secs(10));
        assert!(matches!(events.last(), Some(TerminalEvent::Exit { .. })));
        t.0.write(id, "echo late\r");
        t.0.resize(id, 100, 40);
        t.0.kill(id);
        // Once forgotten, the id is unknown: still a no-op.
        t.0.write(id, "echo later\r");
        t.0.resize(id, 120, 50);
        t.0.kill(id);
        t.0.kill_all();
    }
}

/// Every known agent, in menu order, and whether its CLI is installed.
#[tauri::command]
pub async fn terminal_agents() -> Vec<AgentInfo> {
    let installed = tauri::async_runtime::spawn_blocking(installed_commands)
        .await
        .unwrap_or_default();
    AGENTS
        .iter()
        .map(|a| AgentInfo {
            id: a.id.to_string(),
            name: a.name.to_string(),
            installed: installed.iter().any(|c| c == a.command),
        })
        .collect()
}
