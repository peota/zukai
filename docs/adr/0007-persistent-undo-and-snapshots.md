# 7. Persistent undo history and Snapshots

Date: 2026-10-25
Status: Accepted

## Context

Files autosave to disk (ADR 0001), so there's no Ctrl+S safety net. Ordinary undo only lasts while a Tab is open, so a mistake noticed after closing the Tab or restarting couldn't be recovered.

## Decision

Two layers of recovery:

1. **Persistent undo history.** A Text Tab's undo history (exported from CodeMirror) is saved with the Session and restored after a restart. It's dropped if the File changed on disk since Zukai last saw it. Canvas undo stays within the session, because Excalidraw doesn't expose its history to save.
2. **Snapshots.** The first time Zukai changes a Document in a session, and again after a long pause in editing, it copies the version that was on disk before the change into the app data folder (`history/`). Zukai keeps the last 10 Snapshots per Document, deletes them after 30 days, and enforces a total size limit. A "Restore previous version…" command on the Tab lists them, and restoring is an ordinary edit that can be undone. This covers both Files and Scratchpads.

## Consequences

- A mistaken edit can be recovered after closing a Tab, restarting, or days later. This is similar to VS Code's Local History.
- Snapshots use extra disk space, which the retention rules and size limit keep bounded. Very large Files may be skipped when the size limit applies.
- Snapshots of Files store copies of user data outside the File's own folder, so the app data folder now holds sensitive content too.
