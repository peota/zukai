# 1. Files autosave to disk

Date: 2026-10-25
Status: Accepted

## Context

Zukai has two kinds of Document: Scratchpads, which live in Zukai's own storage, and Files, which are backed by a path on disk. The vision asks for saving to be "nearly invisible" and also to "avoid silently overwriting external files."

We considered the usual editor model (VS Code, Notepad++), where unsaved edits to a File are kept in the app's own storage and the file on disk only changes on Ctrl+S.

## Decision

Files autosave to disk, just as Scratchpads autosave to Zukai's storage. Users never need to press Ctrl+S, and there is no "unsaved" state for a File.

## Consequences

- Saving works the same way for every Document, which makes it simpler to understand.
- Every edit, including a stray keystroke or one CSV cell change, reaches the file on disk right away, where other tools (git, build watchers, other editors) can see it.
- "Avoid silently overwriting" has to mean "never overwrite changes Zukai didn't make." Zukai must detect when a File changes on disk while it is open and must not autosave over those changes. This is handled by Disk changes and Disk conflicts (see `CONTEXT.md`).
- Undo history becomes the main way to recover from a mistaken edit, so it has to survive autosaves.

## Consequences (added 2026-10-26)

- Before every write, Rust re-hashes the file on disk and compares it with the Tab's Fingerprint. If the content differs, the write is refused and the Tab enters a Disk conflict, so a change Zukai didn't make is never overwritten, even if the file watcher missed it.
- Tabs that can't safely write are Held (Disk conflict, Missing File, read-only, or text the encoding can't represent). A held Tab never touches the File.
- A held Tab's unsaved text goes to a Shadow file in the app data folder, written atomically and restored after a restart, so typed text is not lost. It is deleted only when the Tab is resolved.
