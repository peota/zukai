# Zukai — Domain Glossary

The shared language for Zukai. When code, docs or conversation use one of these words, it means exactly what is written here.

When the vision says "replace Notepad", it means Notepad++. Notepad++ is the benchmark for what the text editor should do.

`Mod` means Ctrl on Windows and Linux and Cmd on macOS (see [ADR 0006](docs/adr/0006-v1-ships-on-all-three-platforms.md)).

## Workspace

**Tab**
A slot in the tab bar. A Tab shows exactly one Document.

**Document**
The content a Tab shows. Every Document is either a Scratchpad or a File.

**Scratchpad**
A Document that lives only in Zukai's own storage and has no path on disk. Every new Tab starts as a Scratchpad. Scratchpads are saved continuously and never ask to be saved.
_Avoid_: note, untitled, temp file.

**File**
A Document backed by a path on the user's disk. Edits to a File are autosaved to that path, just like a Scratchpad's are saved to Zukai's storage (see [ADR 0001](docs/adr/0001-files-autosave-to-disk.md)). Only paths the user has granted to Rust (by opening, dropping or saving them) can be read or written; every other path is refused.
_Avoid_: external file, document (when you mean specifically the on-disk kind).

**Kind**
What a Document shows: **Text**, **Canvas** or **Table**. A Document's Kind is fixed when it's created and never changes.
- Files get their Kind from the extension: `.csv` and `.tsv` are Table, `.excalidraw` is Canvas, everything else is Text.
- Scratchpads are Text (Mod+N, the default) or Canvas (a separate shortcut). There are no Table Scratchpads in v1.
_Avoid_: type, mode, format.

**View**
A way of displaying a Document that doesn't change what it is. A Table has two Views: the **grid** and the **raw text**. Switching View keeps the same Document and the same autosave.

**Language**
The syntax a Text Document is highlighted as (JSON, SQL, Markdown and so on). A File gets it from its extension, and a Scratchpad from a guess based on its content. The user can always override it in the status bar.

**Split**
Exactly two Tabs paired side by side. A Split appears in the single tab bar as one joined tab showing both titles. Each half keeps its own cursor, zoom and View. Unsplitting turns the pair back into two ordinary Tabs. Splits are restored with the Session. There is no grid, no nesting, and no second tab bar.
_Avoid_: pane, editor group.

**Compare**
A mode of a Split that shows a diff between its two Text Tabs, using `@codemirror/merge`. Both sides stay their real Documents, so they're editable and autosaved. Arrow buttons copy a chunk across as an ordinary edit that can be undone. F7 and Shift+F7 jump to the next and previous change, and whitespace can be ignored. Turning Compare off leaves an ordinary Split.
Compare can be started from a Split, from "Compare with…" in the Command palette, from "Compare with previous version" (against a Snapshot, which is read-only), or from the Compare button on a Disk conflict bar.
_Limits in v1:_ Tables are compared as raw text, and Canvas and Huge Files can't be compared.
_Avoid_: diff tab.

**Huge File**
A File above the size threshold (initially around 100 MB, to be tuned by benchmarks). It opens in a chunked viewer: Rust indexes line positions and streams only the visible part to the UI. Search, go to line and filtering run in Rust over the whole file. Huge Files are editable: edits are kept in a piece table alongside the untouched original, and saving streams the result to a new file. See [ADR 0008](docs/adr/0008-open-files-of-any-size.md).
Saving works differently for Huge Files: edits go to an Edit journal right away, and the File is written in the background after about 5 seconds idle. There are no Snapshots, and Disk changes are detected by size and modified time.
_Avoid_: large file (unless you mean any big file in general).

**Edit journal**
A log in the app data folder where a Huge File's edits are appended as they happen. If Zukai crashes, the next launch replays it, so nothing is lost even though the File itself is only written after a pause.

**Command palette**
A searchable list of every command, opened with Mod+Shift+P. It's the main way to reach editing commands (line operations, case changes, toggles, Convert encoding and so on) without menus or toolbars.

**Settings**
Changed through the **Settings UI**, which opens as a Tab (Mod+, or "Settings" in the Command palette).
- A search box filters settings by name, description and keywords as you type.
- Settings are grouped into Editor, Appearance, Files, Tables, Quick capture and Keybindings.
- Each setting is one row with a checkbox, dropdown or text field. Changes apply immediately. A Reset link appears only when the value differs from the default.
- Keybindings are a searchable list where you press a key combination to record it, with conflict warnings.
- The UI writes only the values you changed into `settings.json` in the app data folder. An "Open settings.json" link opens it as a normal Tab for editing by hand or keeping in dotfiles. Edits to the file update the UI live, and invalid JSON keeps the last valid settings active.
Common toggles (theme, word wrap, show whitespace) are also in the Command palette.

## v1 editing scope (Notepad++ benchmark)

In v1: column (rectangular) selection with Alt+drag; multiple cursors; line operations (sort, remove duplicates, trim trailing whitespace, join, duplicate or move a line, change case); toggles for word wrap, showing whitespace and line endings, and zoom; regex find and replace; **Compare**; the Command palette.
Deferred: Find in Files, macros, plugins, bookmarks, document map.

## Titles

**Title**
The name shown on a Tab.
- **Scratchpad:** an automatic title until the user renames it. A Text Scratchpad uses its first non-empty line, cut to about 30 characters ("Untitled" when empty). A Canvas Scratchpad is "Canvas", "Canvas 2" and so on. Once renamed, the title sticks. It's stored in `session.json`, not in the file name.
- **File:** its filename. Renaming the Tab renames the file on disk in the same folder. The extension is locked so the Kind can't change. If the new name already exists, an inline error appears and nothing is overwritten. Hovering shows the full path, and two Files with the same name show their parent folder to tell them apart.

## Tables

**File order**
The order of rows as they appear in the CSV on disk. Only cell edits change a Table File on disk. Sorting and filtering never do.

**Sort / Filter**
Settings on the grid View that change which rows are shown and in what order, without changing the File order. Clicking a header cycles through ascending, descending and back to File order. Each Tab remembers its own Sort and Filter, and the Session restores them, but they are never written into the file. Editing a cell while the grid is sorted or filtered writes to the matching row in the File order.
_"Apply sort to file" (an explicit command that can be undone) is deferred past v1._

**Delimiter**
The character that separates cells in a Table File: comma, semicolon, tab or pipe. Zukai guesses it when the file opens and shows it in the status bar, where the user can override it.

**Ragged row**
A row with more or fewer cells than the header. It still shows in the grid. Missing cells are padded on screen only and never written to the file unless the user types into one. Extra cells appear under unnamed columns.

**Unreadable Table**
A Table File whose structure can't be parsed, for example because a quote is never closed or the Delimiter can't be determined. It opens in the raw text View with a notice that names the line where reading failed, and a "Try table view" button that re-parses it. Zukai never guesses a grid for it, because autosave would write the guess back to disk.

Changes are written back with as small a diff as possible (see [ADR 0004](docs/adr/0004-minimal-diff-csv-writes.md)).

## Saving and storage

**Encoding / Line ending**
The byte encoding (UTF-8, UTF-16, Windows-1252 and so on, with or without a BOM) and line-ending style (CRLF or LF) of a Text File. Zukai detects them on open, writes the File back the same way, shows them in the status bar, and changes them only through an explicit Convert action. See [ADR 0009](docs/adr/0009-preserve-text-encoding-and-line-endings.md).

**Pending edits**
Edits in a Tab that haven't been autosaved yet. For a File, these are edits not yet written to disk.

**Disk change**
A change to an open File made by something other than Zukai (git, a formatter, another editor). Zukai watches every open File for these.
- If the Tab has no Pending edits, Zukai reloads the File without asking and keeps the cursor and scroll position.
- If the Tab has Pending edits, the result is a Disk conflict.

**Disk conflict**
A File that was changed on disk while its Tab had Pending edits. Autosave pauses for that Tab, and a bar offers **Keep mine** (overwrite the disk version) or **Load disk version** (discard the Pending edits), or **Compare** (open both versions in Compare and merge chunk by chunk). Nothing is written until the user resolves it.

**Missing File**
An open File whose path no longer exists because it was deleted or moved. The Tab keeps its content, autosave stops, and Save writes the content back.

**Session**
Everything needed to bring the workspace back after a restart: open Tabs and their order, Splits, the active Tab, cursor and scroll positions, Sort/Filter, Undo history, and Pending edit state. It is stored in `session.json` (see [ADR 0005](docs/adr/0005-scratchpads-as-plain-files.md)).
_Avoid_: workspace (when you mean the saved state).

**Fingerprint**
A File's modified time, size and xxh3-64 content hash as Zukai last read or wrote it. Before every write, Rust re-hashes the file on disk. If the content differs from the Fingerprint, the write is refused and the Tab enters a Disk conflict. An empty hash marks a file over 50 MB that wasn't read; it never matches.

**Held**
A File Tab is held while it is in a Disk conflict, is a Missing File, is read-only (not readable as text), or has text its encoding can't represent. A held Tab never writes the File; its text goes to its Shadow file instead. If a Shadow file itself can't be read, the Tab stays held, can't be edited or moved, and the read is retried on the next launch.

**Shadow file**
`pending/<tab id>.txt` in the app data folder, holding a held Tab's unsaved text. It is written atomically and restored after a restart. It is deleted only once the Tab is resolved. Shadow files that no Tab references are recovered as Scratchpads at launch.

## Recovery

**Undo history**
A Tab's list of edits that can be undone. For Text Tabs it's saved with the Session and survives restarts, unless the File changed on disk since Zukai last saw it. For Canvas Tabs it lasts only for the current session.

**Snapshot**
A copy of a Document as it was on disk before Zukai changed it. One is taken at the first change in a session and again after a long pause in editing. Zukai keeps the last 10 per Document for 30 days, within a total size limit. "Restore previous version…" on the Tab lists them. See [ADR 0007](docs/adr/0007-persistent-undo-and-snapshots.md).
_Avoid_: backup, version (unless you mean a Snapshot).

## JSON tools

**Format (Beautify / Minify)**
Commands for Tabs whose Language is JSON, from the `{ }` chip in the status bar. Beautify (Shift+Alt+F) re-indents with 2 spaces, the selection if there is one, and otherwise the whole Document. Minify removes whitespace outside strings. Both are one undoable edit that autosave treats like typing. They re-indent existing tokens and never re-serialise values, so key order, number text and string escapes are untouched, and comments survive. Invalid JSON changes nothing and the status bar names the line and column.

**Folding**
Collapsing a region of text (such as a JSON object) behind a marker in the fold gutter. Mod+Shift+[ folds, Mod+Shift+] unfolds, and clicking a marker toggles it. Copying a selection that spans folded regions copies the hidden text too.

## Closing

**Recently Closed**
A list of Tabs the user closed. Mod+Shift+T reopens the most recent one, and a small menu lists the rest. Closing a Tab never asks for confirmation.
- A Scratchpad that is empty when closed is deleted at once and never appears in Recently Closed.
- A non-empty Scratchpad is kept in Recently Closed for 30 days, then deleted for good.
- A closed File appears in Recently Closed as a reference to its path. The content stays on disk. It never expires, unless it carries Shadow file text (unsaved text from being Held); then it is kept for 30 days.

## Quick capture

**Background mode**
A setting, off by default, labeled "Run in background for quick capture." When it's off, closing the main window quits Zukai, as Notepad and VS Code do, and there's no tray icon or global shortcut. When it's on, closing the window hides it to the system tray (the menu bar on macOS), Quit is in the tray menu (or Mod+Q), and the Quick capture shortcut is active.

**Quick capture**
A small window that floats above other windows, with just a text box. It opens from a global shortcut (default Ctrl+Alt+Space, which the user can change) and only works in Background mode. Esc or clicking away saves and dismisses it, and focus returns to the previous app. The text becomes a new Text Scratchpad Tab without bringing the main window forward. An empty capture is discarded.
Running `zukai --capture` opens Quick capture in the running instance, or starts Zukai if it isn't running (via the single-instance plugin). On Wayland, where apps can't register global shortcuts, users bind this command in their desktop's keyboard settings, and the Background mode settings explain how. Where there's no tray icon (GNOME), running `zukai` again brings up the hidden window.

## Opening

**Opening Files**
Every way of opening a File goes to the one running instance: drag and drop, `zukai <path>…`, Explorer or Finder, and Mod+O (the native dialog, multi-select). A File that's already open switches to its existing Tab.
- The installer registers Zukai under "Open with" for text, code, `.csv`/`.tsv` and `.excalidraw`, and never sets itself as the default, except that it may claim `.excalidraw` when no other app handles it.
- Settings → Files has a "Make Zukai the default for…" button that opens the operating system's default-apps screen.
- Folders can't be opened, because Zukai has no project concept. Dropping a folder shows a notice.

## Relationships

- Save As turns a Scratchpad into a File.
- The tab bar is the user's active set, and Recently Closed is the archive. There is no separate notes library.
