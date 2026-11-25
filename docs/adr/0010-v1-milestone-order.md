# 10. v1 milestone order

Date: 2026-10-25
Status: Accepted. This replaces the priority list in section 6 of the product vision.

## Context

The vision ranked v1 work in seven steps: shell and tabs, text editor, autosave, canvas, CSV, split view, quick capture. Since then v1 has grown to include three platforms (ADR 0006), Snapshots and persistent undo (ADR 0007), editable Huge Files (ADR 0008), encoding preservation (ADR 0009), the Notepad++ editing set, the Command palette and Compare. Autosave now writes straight to disk (ADR 0001), so the saving rules have to be solid before any other feature touches users' files.

## Decision

Build v1 in milestones, each one something you could use every day:

| # | Milestone | Done when |
|---|---|---|
| M1 | Daily-driver text | Tauri shell, Tabs, Text Scratchpads and Files, autosave, Session, Disk changes and conflicts, Encoding and Line endings, Recently Closed, on Windows, macOS and Linux with CI. |
| M2 | Safety and editing power | Persistent Undo history, Snapshots, the Notepad++ editing set, the Command palette. |
| M3 | Canvas | Excalidraw loaded on demand, Canvas Scratchpads and `.excalidraw` Files. |
| M4 | Table | The grid, Sort/Filter, minimal-diff writes, Ragged rows and Unreadable Tables. |
| M5 | Split and Compare | Splits, and Compare reachable from Snapshots and Disk conflicts. |
| M6 | Huge Files | Chunked viewer, piece table, Edit journal, background writes. |
| M7 | Quick capture | Background mode, global shortcut, `zukai --capture`. |

v1 ships when all seven are done.

## Consequences

- Saving correctness moves from third in the vision to the first milestone.
- Huge Files, the riskiest feature, comes late, so everything before it is still useful if it slips.
- CI runs on all three platforms from M1, which avoids a costly port later.

## Notes

- 2026-11-19: Canvas (M3) is delivered with the Library before M2 (ADR 0011).
- 2026-11-19: Split (M5, without Compare) is delivered early, at the owner's request.
- 2026-11-21: Ask (ADR 0013) is a milestone of its own, built ahead of the remaining v1 work, at the owner's request.
- 2026-11-24: Ask is removed; agents started from the Terminal panel replace it (ADR 0014).
