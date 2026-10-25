# 9. Preserve Text File encoding and line endings

Date: 2026-10-25
Status: Accepted

## Context

Files autosave to disk (ADR 0001), so the first keystroke decides whether a File's bytes quietly change. Zukai is meant to replace Notepad++, so it will open Windows-1252 configs, UTF-16 `.reg` exports, UTF-8 files with a BOM, and CRLF scripts that break if converted to LF. Writing everything back as UTF-8 with LF would break those files. This is the same reasoning as minimal-diff CSV writes (ADR 0004), applied to every Text File.

## Decision

- **Detect on open.** Check for a BOM first, then for valid UTF-8, and otherwise fall back to the system's legacy code page. Detect line endings as CRLF or LF.
- **Write back in the same encoding, BOM and line endings.** New lines use the File's existing line ending.
- **Show encoding and line ending in the status bar** (for example `UTF-8 · CRLF`). The user can **Convert to…** another encoding or line ending, which is an ordinary edit that can be undone, or **Reopen with encoding…** when the guess was wrong.
- **New Scratchpads and Save As** default to UTF-8 without a BOM, with the platform's line ending.
- A File whose bytes don't decode cleanly in the detected encoding (binary files, or a wrong guess) opens read-only with a notice. Editing unlocks once the user picks an encoding that decodes cleanly. Otherwise a lossy decode followed by autosave would corrupt the File.
- A File with mixed line endings shows "Mixed" in the status bar, and the first edit converts it to whichever style is most common. CodeMirror stores a single line-ending style, so mixed endings can't be fully preserved.

## Consequences

- Zukai needs an encoding library in Rust (such as `encoding_rs`) and does the encoding and decoding on the Rust side.
- The same rules apply to Huge Files, where the chunked viewer decodes in the File's encoding.
