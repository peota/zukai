//! Streaming an answer from the provider, and cancelling it.

use super::config::Provider;
use super::provider::{Delta, HttpRequest, error_message, parse_event};
use super::sse::SseParser;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AskEvent {
    Text { text: String },
    Done,
    Error { message: String },
}

/// What the network thread tells the loop in `stream_answer`.
enum Net {
    Data(Vec<u8>),
    /// A non-2xx response: its status and (capped) body.
    Http(u16, String),
    End,
    Fail(String),
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const READ_TIMEOUT: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_millis(50);
const ERROR_BODY_CAP: u64 = 64 * 1024;

fn network(req: HttpRequest, label: &str, read_timeout: Duration, tx: mpsc::Sender<Net>) {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        // A redirect is answered as an error, so a request (and its key)
        // never goes anywhere but the URL that was set.
        .max_redirects(0)
        .timeout_connect(Some(CONNECT_TIMEOUT))
        .timeout_per_read(Some(read_timeout))
        .build()
        .into();
    let mut r = agent.post(&req.url);
    for (k, v) in &req.headers {
        r = r.header(k, v);
    }
    // ureq's error text doesn't include the request headers, so the key
    // stays out of it.
    let resp = match r.send_json(&req.body) {
        Ok(resp) => resp,
        Err(e) => {
            let _ = tx.send(Net::Fail(format!("{label}: {e}")));
            return;
        }
    };
    let status = resp.status().as_u16();
    let mut reader = resp.into_body().into_reader();
    if !(200..300).contains(&status) {
        let mut body = String::new();
        let _ = (&mut reader).take(ERROR_BODY_CAP).read_to_string(&mut body);
        let _ = tx.send(Net::Http(status, body));
        return;
    }
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => {
                let _ = tx.send(Net::End);
                return;
            }
            Ok(n) => {
                if tx.send(Net::Data(buf[..n].to_vec())).is_err() {
                    return;
                }
            }
            Err(e) => {
                let _ = tx.send(Net::Fail(format!("{label}: {e}")));
                return;
            }
        }
    }
}

/// Runs the request and reports events to `sink`. Ends with exactly one
/// `Done` or `Error`, or with nothing when `cancel` is set. The network read
/// runs on its own thread so a stalled server can't hold up a cancel.
pub fn stream_answer(
    req: HttpRequest,
    provider: Provider,
    label: &str,
    cancel: &AtomicBool,
    sink: &mut dyn FnMut(AskEvent),
) {
    stream_answer_with(req, provider, label, READ_TIMEOUT, cancel, sink)
}

/// `read_timeout` limits each wait on the server (headers or a body read),
/// not the whole answer.
fn stream_answer_with(
    req: HttpRequest,
    provider: Provider,
    label: &str,
    read_timeout: Duration,
    cancel: &AtomicBool,
    sink: &mut dyn FnMut(AskEvent),
) {
    // A cancel that came before the request started: nothing is sent.
    if cancel.load(Ordering::SeqCst) {
        return;
    }
    let (tx, rx) = mpsc::channel();
    let owned = label.to_owned();
    std::thread::spawn(move || network(req, &owned, read_timeout, tx));
    let mut parser = SseParser::default();
    loop {
        if cancel.load(Ordering::SeqCst) {
            return;
        }
        let received = rx.recv_timeout(POLL);
        // A cancel that landed while we waited must not be followed by an event.
        if cancel.load(Ordering::SeqCst) {
            return;
        }
        let msg = match received {
            Ok(m) => m,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                sink(AskEvent::Error {
                    message: format!("{label}: the connection ended unexpectedly"),
                });
                return;
            }
        };
        match msg {
            Net::Data(bytes) => {
                for e in parser.push(&bytes) {
                    if cancel.load(Ordering::SeqCst) {
                        return;
                    }
                    match parse_event(provider, &e) {
                        Some(Delta::Text(text)) => sink(AskEvent::Text { text }),
                        Some(Delta::Done) => {
                            sink(AskEvent::Done);
                            return;
                        }
                        Some(Delta::Error(m)) => {
                            sink(AskEvent::Error {
                                message: format!("{label}: {m}"),
                            });
                            return;
                        }
                        None => {}
                    }
                }
                if parser.too_large() {
                    sink(AskEvent::Error {
                        message: format!("{label}: the response was too large to read"),
                    });
                    return;
                }
            }
            Net::Http(status, body) => {
                sink(AskEvent::Error {
                    message: error_message(label, status, &body),
                });
                return;
            }
            // Some compatible servers close without a final [DONE].
            Net::End => {
                sink(AskEvent::Done);
                return;
            }
            Net::Fail(message) => {
                sink(AskEvent::Error { message });
                return;
            }
        }
    }
}

/// The cancel flags of the answers in flight, by id.
#[derive(Default)]
pub struct Asks(Mutex<HashMap<u32, Arc<AtomicBool>>>);

impl Asks {
    /// Registers an answer. An older answer with the same id is cancelled
    /// rather than left running unreachable.
    pub fn start(&self, id: u32) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Some(old) = self.0.lock().unwrap().insert(id, flag.clone()) {
            old.store(true, Ordering::SeqCst);
        }
        flag
    }
    pub fn cancel(&self, id: u32) {
        if let Some(f) = self.0.lock().unwrap().get(&id) {
            f.store(true, Ordering::SeqCst);
        }
    }
    pub fn cancel_all(&self) {
        for f in self.0.lock().unwrap().values() {
            f.store(true, Ordering::SeqCst);
        }
    }
    #[cfg(test)]
    pub fn running(&self, id: u32) -> bool {
        self.0.lock().unwrap().contains_key(&id)
    }
    /// Forgets the answer that owns `flag`; a newer answer with the same id
    /// stays registered.
    pub fn finish(&self, id: u32, flag: &Arc<AtomicBool>) {
        let mut m = self.0.lock().unwrap();
        if m.get(&id).is_some_and(|f| Arc::ptr_eq(f, flag)) {
            m.remove(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::time::Instant;

    /// Serves one connection: reads the request, writes `head` + `body`, then
    /// holds the socket open for `hold` before closing.
    fn serve(head: &'static str, body: &'static str, hold: Duration) -> String {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/chat/completions", l.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut len = 0usize;
            loop {
                let mut line = String::new();
                r.read_line(&mut line).unwrap();
                if line.trim().is_empty() {
                    break;
                }
                if let Some(v) = line.to_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap();
                }
            }
            let mut b = vec![0; len];
            r.read_exact(&mut b).unwrap();
            let _ = s.write_all(head.as_bytes());
            let _ = s.write_all(body.as_bytes());
            let _ = s.flush();
            std::thread::sleep(hold);
        });
        url
    }

    fn req(url: String) -> HttpRequest {
        HttpRequest {
            url,
            headers: vec![
                ("content-type".into(), "application/json".into()),
                ("authorization".into(), "Bearer sk-secret".into()),
            ],
            body: serde_json::json!({"model": "m"}),
        }
    }

    fn run(url: String, p: Provider, label: &str) -> Vec<AskEvent> {
        let mut out = Vec::new();
        stream_answer(req(url), p, label, &AtomicBool::new(false), &mut |e| {
            out.push(e)
        });
        out
    }

    const SSE: &str =
        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n";
    const CHUNK_A: &str = "data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n\n";

    fn text(t: &str) -> AskEvent {
        AskEvent::Text { text: t.into() }
    }

    #[test]
    fn streams_text_then_done() {
        let url = serve(
            SSE,
            "data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"b\"}}]}\n\ndata: [DONE]\n\n",
            Duration::ZERO,
        );
        assert_eq!(
            run(url, Provider::Openai, "OpenAI"),
            vec![text("a"), text("b"), AskEvent::Done]
        );
    }

    #[test]
    fn http_error_becomes_error_event() {
        let url = serve(
            "HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\nconnection: close\r\n\r\n",
            "{\"error\":{\"message\":\"bad key\"}}",
            Duration::ZERO,
        );
        let ev = run(url, Provider::Openai, "OpenAI");
        assert_eq!(
            ev,
            vec![AskEvent::Error {
                message: "OpenAI: bad key".into()
            }]
        );
        assert!(!serde_json::to_string(&ev).unwrap().contains("sk-secret"));
    }

    #[test]
    fn refused_connection_is_error() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/x", l.local_addr().unwrap());
        drop(l);
        let ev = run(url, Provider::Compatible, "localhost:1");
        assert_eq!(ev.len(), 1);
        match &ev[0] {
            AskEvent::Error { message } => {
                assert!(message.starts_with("localhost:1: "));
                assert!(!message.contains("sk-secret"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn dropped_mid_stream_is_one_error() {
        // Chunked, but cut off before the terminating chunk.
        let url = serve(
            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n",
            "2f\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n\n\r\n",
            Duration::ZERO,
        );
        let ev = run(url, Provider::Openai, "OpenAI");
        assert_eq!(ev[0], text("a"));
        assert_eq!(ev.len(), 2, "{ev:?}");
        assert!(matches!(ev[1], AskEvent::Error { .. }));
    }

    #[test]
    fn cancel_stops_without_done() {
        let url = serve(SSE, CHUNK_A, Duration::from_secs(5));
        let cancel = Arc::new(AtomicBool::new(false));
        let c2 = cancel.clone();
        let mut out = Vec::new();
        let start = Instant::now();
        stream_answer(req(url), Provider::Openai, "OpenAI", &cancel, &mut |e| {
            if matches!(e, AskEvent::Text { .. }) {
                c2.store(true, Ordering::SeqCst);
            }
            out.push(e);
        });
        assert!(start.elapsed() < Duration::from_secs(2));
        assert_eq!(out, vec![text("a")]);
    }

    #[test]
    fn late_events_after_cancel_are_dropped() {
        // The server closes cleanly (which would be a Done) after the cancel.
        let url = serve(SSE, CHUNK_A, Duration::from_millis(600));
        let cancel = Arc::new(AtomicBool::new(false));
        let c2 = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            c2.store(true, Ordering::SeqCst);
        });
        let mut out = Vec::new();
        stream_answer(req(url), Provider::Openai, "OpenAI", &cancel, &mut |e| {
            out.push(e)
        });
        assert_eq!(out, vec![text("a")]);
    }

    #[test]
    fn long_answer_survives_per_read_timeout() {
        // Three chunks 300 ms apart (900 ms total) with a 600 ms per-read limit.
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/x", l.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut len = 0usize;
            loop {
                let mut line = String::new();
                r.read_line(&mut line).unwrap();
                if line.trim().is_empty() {
                    break;
                }
                if let Some(v) = line.to_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap();
                }
            }
            let mut b = vec![0; len];
            r.read_exact(&mut b).unwrap();
            let _ = s.write_all(SSE.as_bytes());
            for part in [CHUNK_A, CHUNK_A, "data: [DONE]\n\n"] {
                std::thread::sleep(Duration::from_millis(300));
                let _ = s.write_all(part.as_bytes());
                let _ = s.flush();
            }
        });
        let mut out = Vec::new();
        stream_answer_with(
            req(url),
            Provider::Openai,
            "OpenAI",
            Duration::from_millis(600),
            &AtomicBool::new(false),
            &mut |e| out.push(e),
        );
        assert_eq!(out, vec![text("a"), text("a"), AskEvent::Done]);
    }

    #[test]
    fn silent_server_times_out() {
        let url = serve("", "", Duration::from_secs(3));
        let mut out = Vec::new();
        let start = Instant::now();
        stream_answer_with(
            req(url),
            Provider::Openai,
            "OpenAI",
            Duration::from_millis(300),
            &AtomicBool::new(false),
            &mut |e| out.push(e),
        );
        assert!(start.elapsed() < Duration::from_secs(2));
        assert!(
            matches!(out.as_slice(), [AskEvent::Error { .. }]),
            "{out:?}"
        );
    }

    #[test]
    fn cancelled_before_start_connects_nowhere() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        l.set_nonblocking(true).unwrap();
        let url = format!("http://{}/x", l.local_addr().unwrap());
        let mut out = Vec::new();
        stream_answer(
            req(url),
            Provider::Openai,
            "OpenAI",
            &AtomicBool::new(true),
            &mut |e| out.push(e),
        );
        std::thread::sleep(Duration::from_millis(200));
        assert!(l.accept().is_err(), "a connection was made");
        assert!(out.is_empty());
    }

    #[test]
    fn redirect_is_not_followed() {
        let url = serve(
            "HTTP/1.1 302 Found
location: http://127.0.0.1:1/elsewhere
content-length: 0
connection: close

",
            "",
            Duration::ZERO,
        );
        assert_eq!(
            run(url, Provider::Openai, "OpenAI"),
            vec![AskEvent::Error {
                message: "OpenAI: HTTP 302".into()
            }]
        );
    }

    #[test]
    fn endless_line_is_one_error() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/x", l.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut len = 0usize;
            loop {
                let mut line = String::new();
                r.read_line(&mut line).unwrap();
                if line.trim().is_empty() {
                    break;
                }
                if let Some(v) = line.to_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap();
                }
            }
            let mut b = vec![0; len];
            r.read_exact(&mut b).unwrap();
            let _ = s.write_all(SSE.as_bytes());
            let junk = vec![b'x'; 64 * 1024];
            // Stops once the client hangs up.
            for _ in 0..64 {
                if s.write_all(&junk).is_err() {
                    break;
                }
            }
        });
        assert_eq!(
            run(url, Provider::Openai, "OpenAI"),
            vec![AskEvent::Error {
                message: "OpenAI: the response was too large to read".into()
            }]
        );
    }

    #[test]
    fn asks_cancel_flags() {
        let asks = Asks::default();
        let a = asks.start(1);
        let b = asks.start(2);
        asks.cancel(1);
        assert!(a.load(Ordering::SeqCst) && !b.load(Ordering::SeqCst));
        asks.cancel_all();
        assert!(b.load(Ordering::SeqCst));
    }

    #[test]
    fn reused_id_cancels_old_and_old_finish_keeps_new() {
        let asks = Asks::default();
        let old = asks.start(7);
        let new = asks.start(7);
        assert!(old.load(Ordering::SeqCst));
        assert!(!new.load(Ordering::SeqCst));
        asks.finish(7, &old);
        asks.cancel(7);
        assert!(new.load(Ordering::SeqCst), "new entry must survive");
        asks.finish(7, &new);
        let fresh = asks.start(7);
        asks.cancel_all();
        assert!(fresh.load(Ordering::SeqCst));
    }
}
