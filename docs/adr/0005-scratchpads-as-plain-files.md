# 5. Scratchpads stored as plain files

Date: 2026-10-25
Status: Accepted

## Context

Scratchpads have no path chosen by the user, so Zukai has to store them itself. Reliable autosave and session restore are priority #3, and this storage format is where users' notes live permanently.

The options we considered:
- **One plain file per Scratchpad**, plus a session file.
- **A single SQLite database:** good transactions and easier full-text search, but notes become rows that only Zukai or a SQL tool can read, and one corrupted database puts every note at risk.

## Decision

Store everything in the app data folder (`%APPDATA%\Zukai\` on Windows):
- `scratchpads/<id>.txt` for each Text Scratchpad, containing exactly what the user typed.
- `scratchpads/<id>.excalidraw` for each Canvas Scratchpad, in standard Excalidraw JSON.
- `closed/` for Recently Closed Scratchpads, cleaned out after 30 days.
- `history/` for Snapshots (added by ADR 0007).
- `session.json` for the Session: open Tabs and their order, Splits, the active Tab, cursor and scroll positions, Sort/Filter, and Pending edit state.

Every write is atomic: Zukai writes to a temporary file in the same folder and then renames it over the real one. Autosaving Files works the same way.

## Consequences

- Notes stay readable, searchable and easy to back up without Zukai. This is local-first in the most literal sense.
- A crash or power cut during a save leaves the previous version intact. Damage to one file affects only one Scratchpad.
- Typing writes one small file plus `session.json`. Writes to `session.json` should be debounced so it isn't rewritten on every keystroke.
- Searching across Scratchpads, if added later, has to scan or index the files ourselves.
