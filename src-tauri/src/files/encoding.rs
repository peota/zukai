//! Encoding and line-ending detection and re-encoding.
//!
//! Decides how a file's bytes become editor text and back without silently
//! changing bytes the user didn't touch (ADR 0009).

use encoding_rs::Encoding;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileFormat {
    /// Lowercased WHATWG label: "utf-8", "utf-16le", "utf-16be", "windows-1252", ...
    pub encoding: String,
    pub bom: bool,
    pub line_ending: LineEnding,
    pub mixed: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
}

pub struct Decoded {
    /// Always uses `\n` line breaks.
    pub text: String,
    pub format: FileFormat,
    pub readable: bool,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Unencodable {
    pub ch: String,
    pub line: u32,
    pub col: u32,
}

pub fn platform_line_ending() -> LineEnding {
    if cfg!(windows) {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    }
}

/// Maps a Windows ANSI code page to its encoding; Windows-1252 is the fallback.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn encoding_for_codepage(cp: u32) -> &'static Encoding {
    use encoding_rs::*;
    match cp {
        874 => WINDOWS_874,
        932 => SHIFT_JIS,
        936 => GBK,
        949 => EUC_KR,
        950 => BIG5,
        1250 => WINDOWS_1250,
        1251 => WINDOWS_1251,
        1252 => WINDOWS_1252,
        1253 => WINDOWS_1253,
        1254 => WINDOWS_1254,
        1255 => WINDOWS_1255,
        1256 => WINDOWS_1256,
        1257 => WINDOWS_1257,
        1258 => WINDOWS_1258,
        _ => WINDOWS_1252,
    }
}

#[cfg(windows)]
unsafe extern "system" {
    fn GetACP() -> u32;
}

/// The encoding used for files that are neither BOM-marked nor valid UTF-8.
pub fn legacy_encoding() -> &'static Encoding {
    #[cfg(windows)]
    {
        // SAFETY: GetACP takes no arguments and has no preconditions.
        encoding_for_codepage(unsafe { GetACP() })
    }
    #[cfg(not(windows))]
    {
        encoding_rs::WINDOWS_1252
    }
}

fn label_of(enc: &'static Encoding) -> String {
    enc.name().to_lowercase()
}

fn sniff_bom(bytes: &[u8]) -> Option<(&'static Encoding, usize)> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        Some((encoding_rs::UTF_8, 3))
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        Some((encoding_rs::UTF_16LE, 2))
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        Some((encoding_rs::UTF_16BE, 2))
    } else {
        None
    }
}

fn is_utf16(enc: &'static Encoding) -> bool {
    enc == encoding_rs::UTF_16LE || enc == encoding_rs::UTF_16BE
}

/// Decodes `body` (BOM already removed) and works out line endings.
fn finish(body: &[u8], enc: &'static Encoding, bom: bool) -> Decoded {
    let (cow, had_errors) = enc.decode_without_bom_handling(body);
    let raw: &str = &cow;
    let nul_unreadable = !is_utf16(enc) && raw.contains('\0');

    let crlf = raw.matches("\r\n").count();
    let lf = raw.matches('\n').count() - crlf;
    let text = raw.replace("\r\n", "\n").replace('\r', "\n");

    let line_ending = if crlf > lf {
        LineEnding::Crlf
    } else if lf > crlf {
        LineEnding::Lf
    } else {
        platform_line_ending()
    };

    Decoded {
        text,
        format: FileFormat {
            encoding: label_of(enc),
            bom,
            line_ending,
            mixed: crlf > 0 && lf > 0,
        },
        readable: !had_errors && !nul_unreadable,
    }
}

pub fn detect_and_decode(bytes: &[u8]) -> Decoded {
    if let Some((enc, skip)) = sniff_bom(bytes) {
        return finish(&bytes[skip..], enc, true);
    }
    if std::str::from_utf8(bytes).is_ok() {
        return finish(bytes, encoding_rs::UTF_8, false);
    }
    finish(bytes, legacy_encoding(), false)
}

pub fn decode_as(bytes: &[u8], label: &str) -> Option<Decoded> {
    let enc = Encoding::for_label(label.as_bytes())?;
    match sniff_bom(bytes) {
        Some((bom_enc, skip)) if bom_enc == enc => Some(finish(&bytes[skip..], enc, true)),
        _ => Some(finish(bytes, enc, false)),
    }
}

/// 1-based line and column of the character that starts at byte `at` in `text`.
fn position_at(text: &str, at: usize) -> (u32, u32) {
    let before = &text[..at];
    let line = before.matches('\n').count() as u32 + 1;
    let line_start = before.rfind('\n').map_or(0, |i| i + 1);
    let col = before[line_start..].chars().count() as u32 + 1;
    (line, col)
}

pub fn encode(text: &str, format: &FileFormat) -> Result<Vec<u8>, Unencodable> {
    let normalised = text.replace("\r\n", "\n").replace('\r', "\n");
    let body = match format.line_ending {
        LineEnding::Lf => normalised,
        LineEnding::Crlf => normalised.replace('\n', "\r\n"),
    };

    // An unknown label can't occur for formats we produced; treat it as UTF-8.
    let enc = Encoding::for_label(format.encoding.as_bytes()).unwrap_or(encoding_rs::UTF_8);
    let mut out: Vec<u8> = Vec::with_capacity(body.len() + 3);

    if enc == encoding_rs::UTF_8 {
        if format.bom {
            out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        }
        out.extend_from_slice(body.as_bytes());
    } else if is_utf16(enc) {
        let le = enc == encoding_rs::UTF_16LE;
        if format.bom {
            out.extend_from_slice(if le { &[0xFF, 0xFE] } else { &[0xFE, 0xFF] });
        }
        for u in body.encode_utf16() {
            out.extend_from_slice(&if le { u.to_le_bytes() } else { u.to_be_bytes() });
        }
    } else {
        let mut encoder = enc.new_encoder();
        let mut buf = vec![0u8; 4096];
        let mut consumed = 0usize;
        loop {
            let (result, read, written) =
                encoder.encode_from_utf8_without_replacement(&body[consumed..], &mut buf, true);
            out.extend_from_slice(&buf[..written]);
            match result {
                encoding_rs::EncoderResult::InputEmpty => break,
                encoding_rs::EncoderResult::OutputFull => consumed += read,
                encoding_rs::EncoderResult::Unmappable(ch) => {
                    let at = consumed + read - ch.len_utf8();
                    let (line, col) = position_at(&body, at);
                    return Err(Unencodable {
                        ch: ch.to_string(),
                        line,
                        col,
                    });
                }
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fmt(enc: &str, bom: bool, le: LineEnding) -> FileFormat {
        FileFormat {
            encoding: enc.into(),
            bom,
            line_ending: le,
            mixed: false,
        }
    }

    const TEXT: &str = "h\u{e9}llo\nw\u{f6}rld";

    fn round_trip(bytes: &[u8], enc: &str, bom: bool) {
        let d = detect_and_decode(bytes);
        assert!(d.readable);
        assert_eq!(d.format.encoding, enc);
        assert_eq!(d.format.bom, bom);
        assert_eq!(d.text, TEXT);
        assert_eq!(encode(&d.text, &d.format).unwrap(), bytes);
    }

    #[test]
    fn utf8_no_bom_round_trips() {
        round_trip(TEXT.as_bytes(), "utf-8", false);
    }

    #[test]
    fn utf8_bom_round_trips() {
        let mut b = vec![0xEF, 0xBB, 0xBF];
        b.extend_from_slice(TEXT.as_bytes());
        round_trip(&b, "utf-8", true);
    }

    #[test]
    fn utf8_bom_with_crlf_round_trips() {
        let mut b = vec![0xEF, 0xBB, 0xBF];
        b.extend_from_slice("a\r\nb".as_bytes());
        let d = detect_and_decode(&b);
        assert_eq!(d.format.line_ending, LineEnding::Crlf);
        assert_eq!(d.text, "a\nb");
        assert_eq!(encode(&d.text, &d.format).unwrap(), b);
    }

    #[test]
    fn utf16le_bom_round_trips() {
        let mut b = vec![0xFF, 0xFE];
        for u in TEXT.encode_utf16() {
            b.extend_from_slice(&u.to_le_bytes());
        }
        round_trip(&b, "utf-16le", true);
    }

    #[test]
    fn utf16be_bom_round_trips() {
        let mut b = vec![0xFE, 0xFF];
        for u in TEXT.encode_utf16() {
            b.extend_from_slice(&u.to_be_bytes());
        }
        round_trip(&b, "utf-16be", true);
    }

    #[test]
    fn windows1252_detected_when_not_utf8() {
        let d = detect_and_decode(b"M\xfcller");
        if legacy_encoding() == encoding_rs::WINDOWS_1252 {
            assert_eq!(d.text, "M\u{fc}ller");
            assert_eq!(d.format.encoding, "windows-1252");
            assert!(d.readable && !d.format.bom);
        } else {
            assert_eq!(d.format.encoding, legacy_encoding().name().to_lowercase());
        }
    }

    #[test]
    fn crlf_detected() {
        let d = detect_and_decode(b"a\r\nb\r\n");
        assert_eq!(d.format.line_ending, LineEnding::Crlf);
        assert!(!d.format.mixed);
        assert_eq!(d.text, "a\nb\n");
    }

    #[test]
    fn lf_detected() {
        let d = detect_and_decode(b"a\nb\n");
        assert_eq!(d.format.line_ending, LineEnding::Lf);
        assert!(!d.format.mixed);
    }

    #[test]
    fn no_line_breaks_uses_platform_default() {
        let d = detect_and_decode(b"abc");
        assert_eq!(d.format.line_ending, platform_line_ending());
        assert!(!d.format.mixed);
    }

    #[test]
    fn mixed_majority_wins() {
        let d = detect_and_decode(b"a\r\nb\r\nc\nd");
        assert_eq!(d.format.line_ending, LineEnding::Crlf);
        assert!(d.format.mixed);
        assert_eq!(d.text, "a\nb\nc\nd");
        let d = detect_and_decode(b"a\nb\nc\r\nd");
        assert_eq!(d.format.line_ending, LineEnding::Lf);
        assert!(d.format.mixed);
    }

    #[test]
    fn mixed_tie_goes_to_platform_default() {
        let d = detect_and_decode(b"a\r\nb\nc");
        assert_eq!(d.format.line_ending, platform_line_ending());
        assert!(d.format.mixed);
    }

    #[test]
    fn nul_byte_is_unreadable() {
        assert!(!detect_and_decode(b"PNG\x00\x01").readable);
    }

    #[test]
    fn utf16_nul_bytes_are_readable() {
        let d = detect_and_decode(&[0xFF, 0xFE, b'a', 0x00]);
        assert!(d.readable);
        assert_eq!(d.text, "a");
    }

    #[test]
    fn invalid_in_label_is_unreadable() {
        let d = decode_as(b"\xff\xfe\xfd", "utf-8").unwrap();
        assert!(!d.readable);
    }

    #[test]
    fn decode_as_unknown_label_is_none() {
        assert!(decode_as(b"abc", "no-such-encoding").is_none());
    }

    #[test]
    fn decode_as_legacy_label() {
        let d = decode_as(b"M\xfcller", "windows-1252").unwrap();
        assert_eq!(d.text, "M\u{fc}ller");
        assert_eq!(d.format.encoding, "windows-1252");
        assert!(d.readable);
    }

    #[test]
    fn encode_never_doubles_cr() {
        let f = fmt("utf-8", false, LineEnding::Crlf);
        assert_eq!(encode("a\r\nb\rc\n", &f).unwrap(), b"a\r\nb\r\nc\r\n");
    }

    #[test]
    fn encode_reports_unmappable() {
        let f = fmt("windows-1252", false, LineEnding::Lf);
        assert_eq!(
            encode("ok\n\u{1F600}", &f),
            Err(Unencodable {
                ch: "\u{1F600}".into(),
                line: 2,
                col: 1
            })
        );
    }

    #[test]
    fn encode_unmappable_position_on_crlf_file() {
        let f = fmt("windows-1252", false, LineEnding::Crlf);
        let e = encode("a\n\u{e9}b\u{1F600}", &f).unwrap_err();
        assert_eq!((e.line, e.col), (2, 3));
    }

    #[test]
    fn encode_legacy_maps_chars() {
        let f = fmt("windows-1252", false, LineEnding::Lf);
        assert_eq!(encode("M\u{fc}ller", &f).unwrap(), b"M\xfcller");
    }

    #[test]
    fn codepage_mapping() {
        assert_eq!(encoding_for_codepage(1251), encoding_rs::WINDOWS_1251);
        assert_eq!(encoding_for_codepage(932), encoding_rs::SHIFT_JIS);
        assert_eq!(encoding_for_codepage(936), encoding_rs::GBK);
        assert_eq!(encoding_for_codepage(949), encoding_rs::EUC_KR);
        assert_eq!(encoding_for_codepage(950), encoding_rs::BIG5);
        assert_eq!(encoding_for_codepage(874), encoding_rs::WINDOWS_874);
        assert_eq!(encoding_for_codepage(65001), encoding_rs::WINDOWS_1252);
        assert_eq!(encoding_for_codepage(1), encoding_rs::WINDOWS_1252);
    }
}
