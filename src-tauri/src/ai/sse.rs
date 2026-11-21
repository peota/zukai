//! Incremental Server-Sent Events parsing.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

/// The most an unfinished line or event may hold before the stream is
/// given up on, so a server that never sends a newline can't fill memory.
pub const MAX_PENDING: usize = 1024 * 1024;

#[derive(Debug, Default)]
pub struct SseParser {
    buf: Vec<u8>,
    event: Option<String>,
    data: Vec<String>,
    too_large: bool,
}

impl SseParser {
    /// Feed raw bytes; returns every event completed by them. A partial
    /// line or event stays buffered until a later chunk finishes it.
    /// Once more than `MAX_PENDING` bytes are waiting, the parser stops and
    /// `too_large` turns true; later chunks are ignored.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        if self.too_large {
            return Vec::new();
        }
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(nl) = self.buf.iter().position(|&b| b == b'\n') {
            let raw: Vec<u8> = self.buf.drain(..=nl).collect();
            let line = String::from_utf8_lossy(&raw[..raw.len() - 1]);
            let line = line.strip_suffix('\r').unwrap_or(&line);
            if line.is_empty() {
                if !self.data.is_empty() {
                    out.push(SseEvent {
                        event: self.event.take(),
                        data: self.data.join("\n"),
                    });
                }
                self.event = None;
                self.data.clear();
            } else if line.starts_with(':') {
                // comment / keepalive
            } else {
                let (field, value) = line.split_once(':').unwrap_or((line, ""));
                let value = value.strip_prefix(' ').unwrap_or(value);
                match field {
                    "event" => self.event = Some(value.to_owned()),
                    "data" => self.data.push(value.to_owned()),
                    _ => {}
                }
            }
        }
        let pending = self.buf.len() + self.data.iter().map(String::len).sum::<usize>();
        if pending > MAX_PENDING {
            self.too_large = true;
            self.buf = Vec::new();
            self.data = Vec::new();
        }
        out
    }

    pub fn too_large(&self) -> bool {
        self.too_large
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_across_chunks() {
        let mut p = SseParser::default();
        assert!(p.push(b"data: {\"a\"").is_empty());
        let evs = p.push(b":1}\n\n");
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].data, "{\"a\":1}");
        assert_eq!(evs[0].event, None);
    }

    #[test]
    fn crlf_and_event_name() {
        let mut p = SseParser::default();
        let evs = p.push(b"event: ping\r\ndata: x\r\n\r\n");
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].event.as_deref(), Some("ping"));
        assert_eq!(evs[0].data, "x");
    }

    #[test]
    fn comments_ignored() {
        let mut p = SseParser::default();
        assert!(p.push(b": keepalive\n\n").is_empty());
    }

    #[test]
    fn multiple_data_lines_join_with_newline() {
        let mut p = SseParser::default();
        let evs = p.push(b"data: a\ndata: b\n\n");
        assert_eq!(evs[0].data, "a\nb");
    }

    #[test]
    fn endless_line_is_too_large() {
        let mut p = SseParser::default();
        let chunk = vec![b'x'; 4096];
        let mut n = 0;
        while !p.too_large() {
            assert!(p.push(&chunk).is_empty());
            n += chunk.len();
            assert!(n <= MAX_PENDING + chunk.len(), "never stopped");
        }
        assert!(n > MAX_PENDING);
        assert!(
            p.push(
                b"

data: 1

"
            )
            .is_empty()
        );
    }

    #[test]
    fn a_long_but_finished_stream_is_fine() {
        let mut p = SseParser::default();
        let ev = b"data: 0123456789012345678901234567890123456789

";
        for _ in 0..(2 * MAX_PENDING / ev.len()) {
            assert_eq!(p.push(ev).len(), 1);
        }
        assert!(!p.too_large());
    }

    #[test]
    fn two_events_in_one_chunk() {
        let mut p = SseParser::default();
        assert_eq!(p.push(b"data: 1\n\ndata: 2\n\n").len(), 2);
    }
}
