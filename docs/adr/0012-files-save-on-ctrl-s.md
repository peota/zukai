# 12. Files save on Ctrl+S

Date: 2026-11-19
Status: Accepted. Supersedes [ADR 0001](0001-files-autosave-to-disk.md) in part: autosaving Files is now the "Save files automatically" setting, off by default.

## Context

ADR 0001 made every edit to a File reach the disk about 300 ms later. The owner's worry is a stray edit: they change a JSON file in an Added folder, forget to undo it, and the change is already on disk where builds, git and other tools read it. A File has readers outside Zukai, so it shouldn't change until the owner says so. A Scratchpad has no outside readers, so it keeps autosaving.

## Decision

- By default a File changes on disk only through an explicit save: Ctrl+S, Save all (in the tab bar's right-click menu, with no shortcut), Save on the close prompt, or Keep mine on a Disk conflict bar.
- Scratchpads keep saving themselves.
- A setting, **Save files automatically**, brings back the behaviour of ADR 0001 for Files. It is off by default. Turning it on does not flush Tabs that already have Unsaved changes, so a forgotten edit is never written just because the setting changed.
- The same rule applies to every File, wherever it lives.

## Consequences

- An edited File Tab has Unsaved changes: its text, or its encoding or line endings (after Convert), differ from its File. Undoing back to the saved text clears them.
- Unsaved text lives in the Tab's Shadow file, the same one a Held Tab uses. It is written atomically and survives a crash and a restart. The Session records which Tabs are unsaved, with any pending format, and restores them.
- A Tab with Unsaved changes shows a dot after its title. On an unpinned Tab the dot turns into the close button on hover.
- Closing such a Tab asks "Save changes to `<name>`?" with Save, Don't save and Cancel. Closing several asks once per unsaved Tab, and Cancel stops the rest. Closing a Held Tab never asks, because its text stays in its Shadow file and in Recently Closed.
- Convert waits for the save when the setting is off, because the new format reaches the disk only on save.
- Quitting never asks. The final flush writes Shadow files, not Files, and the next launch restores the Tabs with their dots.
- A File with Unsaved changes that changes on disk enters a Disk conflict, as pending edits did under ADR 0001. The fingerprinted write, Held Tabs and Shadow files from ADR 0001 are unchanged.
