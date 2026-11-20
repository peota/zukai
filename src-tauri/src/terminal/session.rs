//! A shell running in a pseudo-terminal, with its output batched into events.
//!
//! Three threads serve each session. The reader copies PTY output into a
//! shared buffer. The flusher sends it on in batches, holding back a split
//! UTF-8 character until the rest arrives. The waiter reaps the shell, closes
//! the PTY, lets the reader drain, has the flusher send what is left, then
//! sends `Exit`, exactly once.

use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;

use crate::files::FileError;
use crate::terminal::shell::{ShellSpec, extra_env};
use crate::terminal::tree::{self, TreeGuard};

/// How long output may wait before it is sent.
const BATCH_DELAY: Duration = Duration::from_millis(8);
/// How much waiting output sends a batch at once, and the most one batch holds.
const BATCH_BYTES: usize = 64 * 1024;
/// How much unsent output makes the reader stop reading. The PTY then fills
/// up and the shell blocks until the listener catches up.
const HIGH_WATER: usize = 1024 * 1024;
/// How long the waiter lets the reader drain after the shell exits. A
/// background process that keeps the terminal open would otherwise hold back
/// `Exit` for as long as it lives.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

/// What a session tells its listener.
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TerminalEvent {
    Data { data: String },
    Exit { code: Option<i32> },
}

/// Where a session sends its events, from its own threads.
pub type Sink = Arc<dyn Fn(TerminalEvent) + Send + Sync>;

/// The length of the longest prefix of `buf` that doesn't end inside a
/// multi-byte UTF-8 character. Invalid bytes are never held back.
pub fn utf8_split(buf: &[u8]) -> usize {
    let len = buf.len();
    // A character is at most 4 bytes, so an unfinished one has its lead byte
    // among the last 3.
    for back in 1..=len.min(3) {
        let at = len - back;
        let byte = buf[at];
        if byte & 0xC0 == 0x80 {
            continue; // continuation byte: keep looking for the lead
        }
        let width = match byte {
            0xC0..=0xDF => 2,
            0xE0..=0xEF => 3,
            0xF0..=0xF7 => 4,
            _ => 1,
        };
        return if back < width { at } else { len };
    }
    len
}

/// Output waiting to be sent.
#[derive(Default)]
struct Pending {
    buf: Vec<u8>,
    /// Set once the reader is done (or given up on): send everything, then stop.
    closed: bool,
}

#[derive(Default)]
struct Output {
    pending: Mutex<Pending>,
    wake: Condvar,
}

/// A running shell. On Windows, dropping it also ends the shell's tree.
pub struct Session {
    /// `None` once the shell has exited.
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    /// `None` once the shell has exited.
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    exited: Arc<AtomicBool>,
    tree: TreeGuard,
}

fn pty_error(err: impl std::fmt::Display) -> std::io::Error {
    std::io::Error::other(err.to_string())
}

impl Session {
    /// Starts `shell` in `cwd` on a `cols` x `rows` terminal.
    pub fn spawn(
        shell: &ShellSpec,
        cwd: &Path,
        cols: u16,
        rows: u16,
        sink: Sink,
    ) -> Result<Session, FileError> {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(pty_error)?;

        let mut cmd = CommandBuilder::new(&shell.program);
        cmd.args(&shell.args);
        cmd.cwd(cwd);
        for (key, value) in extra_env() {
            cmd.env(key, value);
        }

        let mut child = pair.slave.spawn_command(cmd).map_err(pty_error)?;
        let guarded = child
            .process_id()
            .ok_or_else(|| pty_error("the shell has no process id"))
            .and_then(tree::guard);
        let tree = match guarded {
            Ok(tree) => tree,
            Err(err) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(err.into());
            }
        };
        // The child has its own handle on the terminal; ours would keep it
        // open after the shell exits.
        drop(pair.slave);

        let session = Session {
            master: Arc::new(Mutex::new(None)),
            writer: Arc::new(Mutex::new(None)),
            exited: Arc::new(AtomicBool::new(false)),
            tree,
        };
        if let Err(err) = session.start(pair.master, child, sink) {
            session.kill();
            return Err(err.into());
        }
        Ok(session)
    }

    /// Hands the terminal to the session and starts its threads.
    fn start(
        &self,
        master: Box<dyn MasterPty + Send>,
        mut child: Box<dyn Child + Send + Sync>,
        sink: Sink,
    ) -> std::io::Result<()> {
        let reader = master.try_clone_reader().map_err(pty_error)?;
        *self.writer.lock().unwrap() = Some(master.take_writer().map_err(pty_error)?);
        *self.master.lock().unwrap() = Some(master);

        let output = Arc::new(Output::default());
        let (drained_tx, drained_rx) = mpsc::channel();
        let reader_out = Arc::clone(&output);
        thread::Builder::new()
            .name("terminal-reader".into())
            .spawn(move || {
                read_loop(reader, &reader_out);
                let _ = drained_tx.send(());
            })?;

        let flusher_out = Arc::clone(&output);
        let flusher_sink = Arc::clone(&sink);
        let flusher = thread::Builder::new()
            .name("terminal-flusher".into())
            .spawn(move || flush_loop(&flusher_out, &*flusher_sink))?;

        let master = Arc::clone(&self.master);
        let writer = Arc::clone(&self.writer);
        let exited = Arc::clone(&self.exited);
        thread::Builder::new()
            .name("terminal-waiter".into())
            .spawn(move || {
                let code = match child.wait() {
                    Ok(status) if status.signal().is_none() => Some(status.exit_code() as i32),
                    _ => None,
                };
                exited.store(true, Ordering::SeqCst);
                // Closing the terminal ends the reader. On Windows the
                // pseudoconsole only flushes its last output and closes its
                // pipe when it is closed, so the reader would wait forever.
                take(&master);
                take(&writer);
                let _ = drained_rx.recv_timeout(DRAIN_TIMEOUT);
                close(&output);
                // The flusher sends the rest before it returns, so `Exit` comes last.
                let _ = flusher.join();
                sink(TerminalEvent::Exit { code });
            })?;
        Ok(())
    }

    /// Sends `data` to the shell's input. Does nothing once the shell has exited.
    pub fn write(&self, data: &[u8]) -> std::io::Result<()> {
        let mut writer = self.writer.lock().unwrap();
        let Some(writer) = writer.as_mut() else {
            return Ok(());
        };
        match writer.write_all(data).and_then(|()| writer.flush()) {
            Err(_) if self.exited.load(Ordering::SeqCst) => Ok(()),
            result => result,
        }
    }

    /// Changes the terminal's size. Does nothing once the shell has exited.
    pub fn resize(&self, cols: u16, rows: u16) -> std::io::Result<()> {
        match self.master.lock().unwrap().as_ref() {
            Some(master) => master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(pty_error),
            None => Ok(()),
        }
    }

    /// Ends the shell and everything it started. The waiter thread then reaps
    /// the shell and sends `Exit`.
    pub fn kill(&self) {
        self.tree.kill();
    }
}

/// Empties `slot`, dropping what it held after the lock is released.
fn take<T>(slot: &Mutex<Option<T>>) {
    let held = slot.lock().unwrap().take();
    drop(held);
}

/// Copies terminal output into `output` until the terminal closes.
fn read_loop(mut reader: Box<dyn Read + Send>, output: &Output) {
    let mut chunk = vec![0u8; 16 * 1024];
    loop {
        let n = match reader.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(n) => n,
        };
        let mut pending = output.pending.lock().unwrap();
        while pending.buf.len() >= HIGH_WATER && !pending.closed {
            pending = output.wake.wait(pending).unwrap();
        }
        if pending.closed {
            return; // `Exit` is on its way; nobody wants this any more
        }
        pending.buf.extend_from_slice(&chunk[..n]);
        output.wake.notify_all();
    }
}

/// Tells the flusher to send what is left and stop, and the reader to stop.
fn close(output: &Output) {
    output.pending.lock().unwrap().closed = true;
    output.wake.notify_all();
}

/// Sends waiting output in batches of at most `BATCH_BYTES` until the
/// output is closed, then sends the rest and returns.
fn flush_loop(output: &Output, sink: &(dyn Fn(TerminalEvent) + Send + Sync)) {
    loop {
        let mut pending = output.pending.lock().unwrap();
        // Sleep until there is something whole to send.
        while utf8_split(&pending.buf) == 0 && !pending.closed {
            pending = output.wake.wait(pending).unwrap();
        }
        // Let a batch build up for a moment, unless it is already big.
        let deadline = Instant::now() + BATCH_DELAY;
        while pending.buf.len() < BATCH_BYTES && !pending.closed {
            let Some(left) = deadline.checked_duration_since(Instant::now()) else {
                break;
            };
            pending = output.wake.wait_timeout(pending, left).unwrap().0;
        }
        let len = pending.buf.len();
        let split = if pending.closed && len <= BATCH_BYTES {
            len // the very end: an unfinished character will never finish
        } else {
            utf8_split(&pending.buf[..len.min(BATCH_BYTES)])
        };
        let batch: Vec<u8> = pending.buf.drain(..split).collect();
        let done = pending.closed && pending.buf.is_empty();
        drop(pending);
        output.wake.notify_all(); // room for a reader waiting at high water
        if !batch.is_empty() {
            sink(TerminalEvent::Data {
                data: String::from_utf8_lossy(&batch).into_owned(),
            });
        }
        if done {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::shell::current_shell;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    const NL: &str = if cfg!(windows) { "\r" } else { "\n" };

    /// Kills the shell's tree if a test fails before the shell exits.
    struct Running(Session);

    impl Drop for Running {
        fn drop(&mut self) {
            self.0.kill();
        }
    }

    fn start(dir: &Path) -> (Running, mpsc::Receiver<TerminalEvent>) {
        let (tx, rx) = mpsc::channel();
        let sink: Sink = Arc::new(move |ev| {
            let _ = tx.send(ev);
        });
        let session = Session::spawn(&current_shell(), dir, 200, 30, sink).expect("spawn");
        (Running(session), rx)
    }

    /// Every event until `Exit`, or until 10 s have passed. Answers cursor
    /// position requests the way a terminal would: ConPTY waits for one
    /// before it starts the shell.
    fn collect(
        session: &Session,
        rx: &mpsc::Receiver<TerminalEvent>,
    ) -> (String, Vec<TerminalEvent>) {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut events = Vec::new();
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(ev) => {
                    if let TerminalEvent::Data { data } = &ev {
                        for _ in data.matches("\x1b[6n") {
                            session.write(b"\x1b[1;1R").unwrap();
                        }
                    }
                    let done = matches!(ev, TerminalEvent::Exit { .. });
                    events.push(ev);
                    if done {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let text = events
            .iter()
            .filter_map(|ev| match ev {
                TerminalEvent::Data { data } => Some(data.as_str()),
                TerminalEvent::Exit { .. } => None,
            })
            .collect();
        (text, events)
    }

    #[test]
    fn utf8_tail_is_carried_across_reads() {
        let bytes = "aé".as_bytes();
        assert_eq!(utf8_split(&bytes[..2]), 1);
        assert_eq!(utf8_split(bytes), bytes.len());
        assert_eq!(utf8_split("€".as_bytes()), 3);
        assert_eq!(utf8_split(&"€".as_bytes()[..2]), 0);
        assert_eq!(utf8_split(&[b'a', 0x80]), 2);
        assert_eq!(utf8_split(&[]), 0);
    }

    #[test]
    fn echo_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let (running, rx) = start(dir.path());
        running
            .0
            .write(format!("echo zukai-hi{NL}").as_bytes())
            .unwrap();
        running.0.write(format!("exit{NL}").as_bytes()).unwrap();
        let (text, events) = collect(&running.0, &rx);
        assert!(text.contains("zukai-hi"), "output: {text:?}");
        assert!(
            matches!(events.last(), Some(TerminalEvent::Exit { code: Some(0) })),
            "last event: {:?}",
            events.last()
        );
    }

    #[test]
    fn starts_in_cwd() {
        let dir = tempfile::tempdir().unwrap();
        let canonical = dunce::canonicalize(dir.path()).unwrap();
        let (running, rx) = start(dir.path());
        let ask = if cfg!(windows) {
            "(Get-Location).Path"
        } else {
            "pwd"
        };
        running
            .0
            .write(format!("{ask}{NL}exit{NL}").as_bytes())
            .unwrap();
        let (text, _) = collect(&running.0, &rx);
        let want = canonical.to_string_lossy();
        assert!(text.contains(want.as_ref()), "want {want:?} in {text:?}");
    }

    #[test]
    fn kill_sends_one_exit_then_writes_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let (running, rx) = start(dir.path());
        running.0.kill();
        let (_, events) = collect(&running.0, &rx);
        let exits = events
            .iter()
            .filter(|ev| matches!(ev, TerminalEvent::Exit { .. }))
            .count();
        assert_eq!(exits, 1, "events: {events:?}");
        assert!(matches!(events.last(), Some(TerminalEvent::Exit { .. })));
        running.0.write(b"echo late\r").unwrap();
        running.0.resize(100, 40).unwrap();
        // Nothing follows `Exit`.
        assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
    }

    /// Hands out `data` in reads of up to 16 KB, counting what it gave.
    struct Source {
        data: Vec<u8>,
        at: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl Read for Source {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            let at = self.at.load(Ordering::SeqCst);
            let n = out.len().min(16 * 1024).min(self.data.len() - at);
            out[..n].copy_from_slice(&self.data[at..at + n]);
            self.at.store(at + n, Ordering::SeqCst);
            Ok(n)
        }
    }

    #[test]
    fn flood_arrives_whole_in_capped_batches_with_backpressure() {
        // Multi-byte characters land across every read and batch boundary.
        let data = "zukai é € 😀 ".repeat(300_000).into_bytes();
        assert!(data.len() > 5_000_000);
        let read = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let reader = Source {
            data: data.clone(),
            at: Arc::clone(&read),
        };

        let output = Arc::new(Output::default());
        let batches = Arc::new(Mutex::new(Vec::<String>::new()));
        let max_ahead = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let sink = {
            let (batches, read, max_ahead) = (
                Arc::clone(&batches),
                Arc::clone(&read),
                Arc::clone(&max_ahead),
            );
            move |ev: TerminalEvent| {
                let TerminalEvent::Data { data } = ev else {
                    panic!("the flusher never sends Exit");
                };
                let mut batches = batches.lock().unwrap();
                batches.push(data);
                let sent: usize = batches.iter().map(String::len).sum();
                let ahead = read.load(Ordering::SeqCst) - sent;
                max_ahead.fetch_max(ahead, Ordering::SeqCst);
                drop(batches);
                // A slow listener: the reader must wait for it.
                thread::sleep(Duration::from_micros(500));
            }
        };

        let reader_out = Arc::clone(&output);
        let reading = thread::spawn(move || read_loop(Box::new(reader), &reader_out));
        let flusher_out = Arc::clone(&output);
        let flushing = thread::spawn(move || flush_loop(&flusher_out, &sink));
        reading.join().unwrap();
        close(&output);
        flushing.join().unwrap();

        let batches = batches.lock().unwrap();
        let joined: String = batches.concat();
        assert!(joined.as_bytes() == data, "output differs from input");
        let biggest = batches.iter().map(String::len).max().unwrap();
        assert!(biggest <= BATCH_BYTES, "a batch of {biggest} bytes");
        let ahead = max_ahead.load(Ordering::SeqCst);
        // Beyond the high-water mark: one read may top the buffer up past it,
        // one more is in the reader's hands, and one batch is on its way.
        assert!(
            ahead <= HIGH_WATER + 2 * 16 * 1024 + BATCH_BYTES,
            "the reader got {ahead} bytes ahead of the listener"
        );
    }
}
