//! A shell running in a pseudo-terminal, with its output batched into events.
//!
//! Four threads serve each session. The writer owns the PTY's input and
//! writes queued input to it in order. The reader copies PTY output into a
//! shared buffer. The flusher sends it on in batches, holding back a split
//! UTF-8 character until the rest arrives. The waiter reaps the shell (under
//! the lock `kill` takes, so a reused pid is never signalled), closes
//! the PTY, closes the input queue, lets the reader drain, has the flusher send what is left, then
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
    /// Input for the writer thread, in order. `None` once the shell has exited.
    input: Arc<Mutex<Option<mpsc::Sender<Vec<u8>>>>>,
    exited: Arc<AtomicBool>,
    /// Held by `kill` while it signals, and by the waiter while it reaps the
    /// shell and sets `exited`: once the shell's pid is free for another
    /// process to take, `kill` sees `exited` and signals nothing.
    reaping: Arc<Mutex<()>>,
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
            input: Arc::new(Mutex::new(None)),
            exited: Arc::new(AtomicBool::new(false)),
            reaping: Arc::new(Mutex::new(())),
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
        let writer = master.take_writer().map_err(pty_error)?;
        *self.master.lock().unwrap() = Some(master);

        // One thread owns the writer, so input reaches the shell in the order
        // it was sent, and a big paste never blocks the caller.
        let (input_tx, input_rx) = mpsc::channel();
        let writer_exited = Arc::clone(&self.exited);
        thread::Builder::new()
            .name("terminal-writer".into())
            .spawn(move || write_loop(&input_rx, writer, &writer_exited))?;
        *self.input.lock().unwrap() = Some(input_tx);

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
        let input = Arc::clone(&self.input);
        let exited = Arc::clone(&self.exited);
        let reaping = Arc::clone(&self.reaping);
        thread::Builder::new()
            .name("terminal-waiter".into())
            .spawn(move || {
                let code = wait_and_reap(&mut *child, &reaping, &exited);
                // Closing the terminal ends the reader. On Windows the
                // pseudoconsole only flushes its last output and closes its
                // pipe when it is closed, so the reader would wait forever.
                take(&master);
                // Ends the writer thread once it has drained its queue.
                take(&input);
                let _ = drained_rx.recv_timeout(DRAIN_TIMEOUT);
                close(&output);
                // The flusher sends the rest before it returns, so `Exit` comes last.
                let _ = flusher.join();
                sink(TerminalEvent::Exit { code });
            })?;
        Ok(())
    }

    /// Queues `data` for the shell's input without waiting for it to be
    /// written. Input arrives in the order it was queued. Does nothing once
    /// the shell has exited.
    pub fn write(&self, data: &[u8]) {
        if let Some(input) = self.input.lock().unwrap().as_ref() {
            // The writer thread only goes away after a failed write.
            let _ = input.send(data.to_vec());
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
    /// the shell and sends `Exit`. Does nothing once the shell has exited:
    /// on Unix its pid may already belong to an unrelated process.
    pub fn kill(&self) {
        let _held = self.reaping.lock().unwrap();
        if self.exited.load(Ordering::SeqCst) {
            return;
        }
        // The shell can't be reaped while this is held, so on Unix its pid
        // (a zombie at worst) can't be reused until the signals are sent.
        self.tree.kill();
    }
}

/// The code a shell exited with; `None` when a signal ended it.
fn exit_code(status: std::io::Result<portable_pty::ExitStatus>) -> Option<i32> {
    match status {
        Ok(status) if status.signal().is_none() => Some(status.exit_code() as i32),
        _ => None,
    }
}

/// Waits for the shell to exit, then reaps it and sets `exited` while holding
/// `reaping`, and returns its exit code.
#[cfg(windows)]
fn wait_and_reap(
    child: &mut (dyn Child + Send + Sync),
    reaping: &Mutex<()>,
    exited: &AtomicBool,
) -> Option<i32> {
    // The child's process handle keeps its pid from being reused, and the
    // tree is killed through its Job Object, so the order matters less here.
    let status = child.wait();
    let _held = reaping.lock().unwrap();
    exited.store(true, Ordering::SeqCst);
    exit_code(status)
}

/// Waits for the shell to exit, then reaps it and sets `exited` while holding
/// `reaping`, and returns its exit code. Until it is reaped the shell's pid
/// can't be reused, so `kill` never signals a stranger.
#[cfg(unix)]
fn wait_and_reap(
    child: &mut (dyn Child + Send + Sync),
    reaping: &Mutex<()>,
    exited: &AtomicBool,
) -> Option<i32> {
    let pid = child.process_id();
    loop {
        if let Some(pid) = pid {
            wait_unreaped(pid);
        }
        let held = reaping.lock().unwrap();
        match child.try_wait() {
            Ok(Some(status)) => {
                exited.store(true, Ordering::SeqCst);
                return exit_code(Ok(status));
            }
            Ok(None) => {
                // waitid failed or is unsupported: poll instead.
                drop(held);
                thread::sleep(Duration::from_millis(50));
            }
            Err(_) => {
                exited.store(true, Ordering::SeqCst);
                return None;
            }
        }
    }
}

/// Blocks until `pid` has exited, leaving it unreaped. Returns at once if
/// waitid fails.
#[cfg(unix)]
fn wait_unreaped(pid: u32) {
    loop {
        // SAFETY: `info` is plain data waitid fills in; no other preconditions.
        let done = unsafe {
            let mut info: libc::siginfo_t = std::mem::zeroed();
            libc::waitid(
                libc::P_PID,
                pid as libc::id_t,
                &mut info,
                libc::WEXITED | libc::WNOWAIT,
            )
        };
        if done == 0 || std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
            return;
        }
    }
}

/// Empties `slot`, dropping what it held after the lock is released.
fn take<T>(slot: &Mutex<Option<T>>) {
    let held = slot.lock().unwrap().take();
    drop(held);
}

/// Writes queued input to the shell, in order, until the queue closes or a
/// write fails. Input still queued once the shell has exited is dropped.
fn write_loop(
    input: &mpsc::Receiver<Vec<u8>>,
    mut writer: Box<dyn Write + Send>,
    exited: &AtomicBool,
) {
    for data in input {
        if exited.load(Ordering::SeqCst) {
            continue;
        }
        if writer
            .write_all(&data)
            .and_then(|()| writer.flush())
            .is_err()
        {
            return;
        }
    }
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
pub(crate) mod tests {
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
        collect_with(|reply| session.write(reply), rx, Duration::from_secs(10))
    }

    /// Every event until `Exit`, or until `timeout` has passed, with the
    /// output joined. Answers each cursor position request through `reply`.
    pub(crate) fn collect_with(
        reply: impl Fn(&[u8]),
        rx: &mpsc::Receiver<TerminalEvent>,
        timeout: Duration,
    ) -> (String, Vec<TerminalEvent>) {
        let deadline = Instant::now() + timeout;
        let mut events = Vec::new();
        while let Some(left) = deadline.checked_duration_since(Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(ev) => {
                    if let TerminalEvent::Data { data } = &ev {
                        for _ in data.matches("\x1b[6n") {
                            reply(b"\x1b[1;1R");
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
        running.0.write(format!("echo zukai-hi{NL}").as_bytes());
        running.0.write(format!("exit{NL}").as_bytes());
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
        running.0.write(format!("{ask}{NL}exit{NL}").as_bytes());
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
        assert_eq!(running.0.tree.kills(), 1);
        // The shell is gone: killing again signals nothing.
        running.0.kill();
        assert_eq!(running.0.tree.kills(), 1);
        running.0.write(b"echo late\r");
        running.0.resize(100, 40).unwrap();
        // Nothing follows `Exit`.
        assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
    }

    #[test]
    fn kill_after_the_shell_exits_signals_nothing() {
        // Its pid may already belong to an unrelated process.
        let dir = tempfile::tempdir().unwrap();
        let (running, rx) = start(dir.path());
        running.0.write(format!("exit{NL}").as_bytes());
        let (_, events) = collect(&running.0, &rx);
        assert!(matches!(events.last(), Some(TerminalEvent::Exit { .. })));
        running.0.kill();
        assert_eq!(running.0.tree.kills(), 0);
    }

    /// Records what is written, slowly, so queued input piles up behind it.
    struct Recorder(Arc<Mutex<Vec<u8>>>);

    impl Write for Recorder {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            thread::sleep(Duration::from_micros(50));
            let n = data.len().min(4096);
            self.0.lock().unwrap().extend_from_slice(&data[..n]);
            Ok(n)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn queued_input_is_written_in_order() {
        let written = Arc::new(Mutex::new(Vec::new()));
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let exited = Arc::new(AtomicBool::new(false));
        let writer = Box::new(Recorder(Arc::clone(&written)));
        let writer_exited = Arc::clone(&exited);
        let writing = thread::spawn(move || write_loop(&rx, writer, &writer_exited));

        // A big paste, then keystrokes queued from many threads in turn.
        let mut want = "paste ".repeat(50_000).into_bytes();
        tx.send(want.clone()).unwrap();
        for i in 0..500 {
            let key = format!("<{i}>").into_bytes();
            want.extend_from_slice(&key);
            let tx = tx.clone();
            thread::spawn(move || tx.send(key).unwrap()).join().unwrap();
        }
        drop(tx);
        writing.join().unwrap();
        assert!(*written.lock().unwrap() == want, "input reordered or lost");
    }

    #[test]
    fn input_queued_after_exit_is_dropped() {
        let written = Arc::new(Mutex::new(Vec::new()));
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let exited = AtomicBool::new(true);
        tx.send(b"late".to_vec()).unwrap();
        drop(tx);
        write_loop(&rx, Box::new(Recorder(Arc::clone(&written))), &exited);
        assert!(written.lock().unwrap().is_empty());
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
