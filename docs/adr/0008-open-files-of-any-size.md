# 8. Open files of any size

Date: 2026-10-25
Status: Accepted

## Context

"Replace Notepad" means users will open multi-hundred-MB logs and CSV exports. Several earlier decisions get expensive at that size: autosaving the whole file (ADR 0001), Snapshots and persistent Undo history (ADR 0007), CSV parsing that keeps each row's original text (ADR 0004), and a webview-based UI (ADR 0002).

We considered size tiers: full features up to 10 MB, reduced features up to 100 MB, and refusing to open anything larger in v1.

## Decision

Zukai opens files of any size in v1. Files above a size threshold are shown in a chunked viewer: the Rust back end indexes line positions and streams only the visible part of the file to the UI, rather than loading the whole file into the webview.

Huge Files are fully editable in v1. Editing uses a piece table, which records the user's edits alongside the untouched original file, the same way VS Code and other large-file editors work. Saving streams the original plus the edits out to a new file. We considered making Huge Files read-only in v1 and rejected it.

## Consequences

- This is effectively a second editor engine (piece table, streaming saves, conflict detection that doesn't load the whole file), alongside CodeMirror. It's the biggest single addition to v1 scope.

- A chunked viewer for Text, and a chunked grid for Table, are now in v1 scope, which delays the core experience.
- Searching, going to a line, and filtering for these files must run in Rust over the whole file, not in CodeMirror.
- Features that assume the whole file is in memory (syntax highlighting, Language guessing, Snapshots, persistent Undo history, sorting a Table) need explicit rules above the threshold.
- Saving a Huge File works differently from other Files:
  - Every edit is appended right away to an Edit journal in the app data folder. A crash loses nothing, and the next launch replays the journal.
  - The File itself is written in the background after about 5 seconds idle, by streaming the original plus the edits to a temporary file and renaming it into place. Progress shows in the status bar, and edits made during a write go into the next one.
  - Huge Files have no Snapshots. The first edit shows a one-time notice that undo only works within the session.
  - Disk changes are detected by file size and modified time, not by comparing content.
  - If there isn't enough free space for the temporary file, writing pauses with an explanation, and the File is never written partway.
- The threshold is a setting in the code, to be tuned by benchmarks on all three webviews, WebKitGTK especially.
