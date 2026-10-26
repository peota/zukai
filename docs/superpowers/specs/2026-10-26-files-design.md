# Zukai — Second slice: Files

Date: 2026-10-26
Status: Draft, waiting for approval

Background: [`docs/vision.md`](../../vision.md), the glossary [`CONTEXT.md`](../../../CONTEXT.md), the ADRs in [`docs/adr/`](../../adr/) (especially [0001](../../adr/0001-files-autosave-to-disk.md), [0005](../../adr/0005-scratchpads-as-plain-files.md), [0006](../../adr/0006-v1-ships-on-all-three-platforms.md), [0009](../../adr/0009-preserve-text-encoding-and-line-endings.md) and [0010](../../adr/0010-v1-milestone-order.md)), and the first slice's design [`2026-10-25-shell-design.md`](2026-10-25-shell-design.md). Capitalised terms (Tab, File, Scratchpad, Disk change, Disk conflict, Missing File, Pending edits, Encoding / Line ending, Recently Closed, Session) mean exactly what the glossary says.

## 1. Intent

The shell made Zukai a good scratchpad. This slice makes it a real **Notepad++ replacement for everyday files**. That covers the owner's daily loop:

1. **Opening.** Double-click a file, or use "Open with", and it opens in Zukai.
2. **JSON.** Paste a JSON blob, beautify it, read it, fold away what isn't needed, copy a section, and fix a value with find and replace.
3. **Tabs.** Keep a few Tabs open across restarts.

Files autosave to disk ([ADR 0001](../../adr/0001-files-autosave-to-disk.md)). So the heart of this slice is **never writing over something Zukai didn't make**, and **never losing what the user typed**.

This completes milestone M1 ("Daily-driver text") from [ADR 0010](../../adr/0010-v1-milestone-order.md).

## 2. Goals

1. Open Files from double-click / Open with, from `zukai <path>…`, from Mod+O (multi-select) and from drag and drop. All of them open in the one running window.
2. Autosave Files to disk, watch them for Disk changes, and handle Disk conflicts and Missing Files exactly as the glossary defines them.
3. Detect each File's Encoding, BOM and Line ending, write them back unchanged, show them in the status bar, and change them only by explicit actions.
4. Open files that aren't readable as text **read-only**.
5. Ctrl+S / Save As behave as decided in section 5.6, and renaming a File's Tab renames it on disk.
6. Provide a Recently Closed menu that lists closed Scratchpads and closed Files.
7. Add JSON **Beautify / Minify** and **code folding**.
8. Have CI build **installers** on all three platforms. They register Zukai under "Open with" and are unsigned for now.
9. Fix the two data-safety gaps the shell's final review left open (section 5.12).

## 3. Non-goals for this slice

These are all planned for later; leave room for them, don't build them:

- **Compare** (M5). The Disk conflict bar has only Keep mine / Load disk version for now.
- **Snapshots and persistent Undo history** (M2).
- **Huge Files** (M6). See section 5.13 for what happens with a large file meanwhile.
- **Table** (CSV) and **Canvas** (Excalidraw).
  - `.csv`, `.tsv` and `.excalidraw` files open as plain Text Files for now.
  - They aren't registered with the operating system yet.
- **Settings UI**, including the "Make Zukai the default for…" button.
- **Code signing, notarization, auto-update**, and publishing releases to GitHub. CI produces unsigned installer artifacts only.
- **Command palette**, Find in Files, and the rest of the M2 editing set.
- **Choosing an open-source license.** The owner will decide that when publishing.

## 4. Anti-goals

These count as failure even if everything else works:

- **Overwriting a change Zukai didn't make.** If another program changed a File and Zukai saves over it without the user choosing to, that's a failure.
- **Silently changing bytes the user didn't touch.** This includes a File's encoding, BOM or line endings, and also the formatting of a JSON value (see 5.10).
- **Losing typed text.** That includes text typed while a File is in conflict, is missing, or is being closed, and text typed just before a crash beyond the existing ~300 ms autosave window.
- **Clutter.** Dialogs, pop-ups or confirmations for things a bar or the status bar can say.

## 5. Behavior

### 5.1 The File model

- A Tab now holds either a **Scratchpad** (as today) or a **File**: a Document backed by an absolute path.
  - The Session stores each File Tab's path, plus its last known Encoding, BOM and Line ending.
  - It also stores the File's last known on-disk fingerprint: modified time, size, and a content hash of what Zukai last read or wrote.
- **Kind** is still Text for every File in this slice, regardless of extension.
- **Paths are compared canonically**, so the same file is never open in two Tabs. That means resolving `..` and symlinks, and comparing case-insensitively on Windows and macOS.
- **A File Tab shows a small `FILE` badge** next to its Title, as in the approved mockup. Its Title is the filename, as the glossary's Title rule says. Hovering shows the full path. Two open Files with the same name show their parent folder to tell them apart.
- **The Session version goes to 2.**
  - A version 1 `session.json` is migrated automatically. Every v1 Tab is a Scratchpad.
  - The existing "unreadable or future version → back up and rebuild" behavior stays as it is.

### 5.2 Opening Files

- **Ways to open:**
  - `zukai <path>…` on the command line.
  - The operating system's double-click or Open with. The installers register this (5.11).
  - **Mod+O**, the native open dialog, with multi-select.
  - **Dragging files** onto the window.
- **Every way goes to the one running instance.** The single-instance plugin passes paths from a second launch to the first. The window comes to the front, and each File opens as a new Tab after the active one. The last File opened becomes active.
- **A File that's already open** switches to its existing Tab instead of opening a duplicate.
- **Folders aren't opened.** Dropping or passing a folder shows a short notice in the status bar: "Open files, not folders".
- **Launch with a path when Zukai isn't running:** the Session is restored first, then the File opens on top of it.
- **A path that doesn't exist** shows a status-bar notice ("Can't find <name>"), and no Tab is created. A path that can't be read (permissions) shows "Can't open <name>: <reason>".

### 5.3 Reading a File: Encoding, Line ending, readability

This follows [ADR 0009](../../adr/0009-preserve-text-encoding-and-line-endings.md). All decoding and encoding happens in Rust, for example with `encoding_rs`.

1. **Encoding detection:**
   - A BOM decides it: UTF-8, UTF-16 LE or UTF-16 BE.
   - Otherwise, if the bytes are valid UTF-8, it's UTF-8 with no BOM.
   - Otherwise, use the legacy code page: the system ANSI code page on Windows, and Windows-1252 on macOS and Linux.
2. **Unreadable as text:** the File opens **read-only** if decoding in the chosen encoding produces replacement characters, or if the bytes look binary (for example NUL bytes in a UTF-8 or legacy-decoded file).
   - The grey info bar from mockup 4 says so, with **Reopen with encoding…**.
   - A read-only File is never autosaved.
   - Picking an encoding that decodes cleanly unlocks it.
3. **Line ending detection:** count CRLF and LF line breaks.
   - Only one kind present: that's the Line ending.
   - Both present: the File's Line ending is whichever is more common, and the status bar shows `Mixed` until the first edit. The whole File is then written with that one ending, as ADR 0009 accepts.
   - No line breaks at all: use the platform default (CRLF on Windows, LF elsewhere).
   - CodeMirror holds text with `\n`. Conversion to the File's ending happens on write.
4. **Size guard until M6:** a File larger than **50 MB** isn't opened. A status-bar notice says "Too large to open yet" (Huge Files come later). This keeps the app from freezing. _(My call; the threshold is a code constant.)_

### 5.4 Saving a File: autosave with fingerprints

- **Autosave cadence:** Files autosave exactly like Scratchpads, through the same per-id Saver, with the same debounce and flush-on-blur, close and quit. Every write is atomic: a temp file in the same folder, then flush, then rename.
- **What gets written:** the File's Encoding, BOM and Line ending, not UTF-8 and LF.
- **Fingerprint check before every write:**
  - Rust compares the file's current modified time and size with the fingerprint Zukai holds. If they differ, it re-hashes the content to rule out a touch that changed only the time.
  - If the content really changed, **the write is refused** and the Tab goes into Disk conflict (5.5).
  - This catches changes the file watcher missed, for example on network drives or while Zukai was asleep.
- **After a successful write:** the new fingerprint is recorded, so the watcher event caused by Zukai's own write is recognised and ignored.
- **Permissions:** the atomic rename replaces the file, so Zukai keeps the original file's permissions where the platform allows (Unix mode bits). _(Builder: verify on all three OSes.)_
- **Write failure** (permission denied, disk full, file locked): the same as Scratchpads today. The status bar shows "Not saved", the text stays, and saving retries on the next change.
- **Text the File's encoding can't represent** (an emoji typed into a Windows-1252 file, for example):
  - Encoding is checked before the temp file is written. Characters are never replaced with `?` or `&#NNNN;`.
  - The write is refused, and an amber bar says "Can't save: some characters can't be written in <encoding>". It offers **Convert to UTF-8**, which is an undoable step and then saves, or the user can remove the characters.
  - Until then the Tab is **held** (below).
  - "Convert to…" a narrower encoding is disabled when the current text contains characters that encoding can't represent, with the reason shown in the menu. _(My call.)_
- **Held Tabs** _(my call)_. A File Tab is **held** while it is in a Disk conflict, is a Missing File, is read-only, or has text its encoding can't represent.
  - For a held Tab, Zukai never writes the File. The Tab's text goes to its shadow file (5.5) instead.
  - The Saver treats a successful shadow-file write as a successful flush, so closing the Tab and quitting work normally. A held Tab is not a "failed flush" under 5.12.
  - Only a failure writing the shadow file itself counts as a failed flush.

### 5.5 Disk changes and Disk conflicts

- **Watching:** Zukai watches every open File, for example with the `notify` crate. It also re-checks the fingerprint of every open File **when the window regains focus**, as a backstop for missed events.
- **The Tab has no Pending edits:** Zukai reloads the File silently and keeps the cursor and scroll position, clamped to the new length. The reload is one undoable step, so Ctrl+Z brings back the previous text.
- **The Tab has Pending edits:** this is a **Disk conflict**, shown as mockup 1.
  - **The bar:** a yellow bar under the tab bar says "<name> was changed by another program while you were editing. Autosave is paused." It offers **Load disk version** and **Keep mine**.
  - **While the bar is up:** autosave is paused for that Tab, and the user can keep typing.
  - **Keep mine** writes the Tab's text over the disk version, then resumes autosave.
  - **Load disk version** replaces the text with the disk version as one undoable transaction, so Ctrl+Z gets the user's text back, then resumes.
- **Nothing typed is lost while a conflict or Missing File is open:**
  - The Tab's unsaved text is kept in a **shadow file** in the app data folder, `pending/<tab id>.txt`, written atomically on the usual debounce.
  - After a crash or quit, the Tab comes back with that text, still in the conflict or Missing state.
  - The shadow file is deleted once the state is resolved.
- **Changes caused by Zukai itself** (its own writes, Save As, rename) never raise a conflict.

### 5.6 Ctrl+S and Save As

The owner decided:

- **Ctrl+S in a Scratchpad** opens the native **Save As dialog**, like Notepad.
  - On confirm: the text is written to the chosen path (UTF-8, no BOM, platform Line ending), and the Tab becomes a File there. Its Scratchpad file is deleted.
  - Cursor, scroll and undo history stay. The Title becomes the filename, as the glossary's Title rule says.
  - Unless the user picked the Language by hand, it is re-derived from the new extension. _(My call.)_
- **Save As to a path open in another Tab** is refused. A status-bar notice says "<name> is open in another tab", and nothing is written. This keeps one path per Tab and never overwrites a File Zukai has open. _(My call.)_
  - If the user cancels: nothing changes, and the Scratchpad stays autosaved as before.
- **Ctrl+S in a File** saves immediately with no dialog and no indicator. It's a flush, since autosave already runs.
- **Mod+Shift+S** always opens the Save As dialog.
  - From a File, the Tab moves to the new path, keeping that File's Encoding, BOM and Line ending. The old file stays on disk exactly as last saved.
  - Overwriting an existing file is confirmed by the operating system's own dialog. Zukai adds no dialog of its own.
- **Missing File bar:** **Save to original path** recreates the file at its old path. If the folder is gone too, it says so and offers Save as…. **Save as…** works as above.

### 5.7 Missing File

- **When a File becomes Missing:** the watcher reports it removed, or a fingerprint check finds it gone.
  - Autosave stops for it.
  - The Tab title is struck through.
  - The red bar from mockup 2 appears: "<name> was moved or deleted. Your text is still here, and nothing is saved until you choose." It offers **Save as…** and **Save to original path**.
- **Renames by other programs:** a File renamed or moved outside Zukai is simply treated as Missing. Zukai doesn't follow renames. _(My call.)_
- **The file comes back:** if it reappears at the same path while the Tab is Missing, this is handled like a Disk change. It reloads if there are no Pending edits, and otherwise it's a Disk conflict.

### 5.8 Renaming a File's Tab

- **Double-click to rename:** as today, double-clicking a File's Tab edits its name. It renames the file on disk in the same folder.
- **The extension is locked:** only the part before the last `.` is editable. The extension is shown but can't be changed.
- **The new name already exists:** an inline error, and nothing happens. This must hold on Windows too, where a plain `rename` replaces the target. Use a rename that refuses to replace.
- **Invalid names and permission errors:** an inline error, and the Tab keeps its old name.
- **Scratchpads:** renaming still changes only the Title.

### 5.9 Recently Closed menu

- **Opening the menu:** right-click any Tab, or the empty part of the tab bar. A small menu opens with **Close tab**, **Close other tabs**, **Reopen closed tab (Mod+Shift+T)**, and a **Recently closed ▸** list of the last 20 entries, newest first.
  - These are Zukai's own menus in the Paper style.
  - The native webview menu stays disabled there, as it is today.
- **How closed Files work:**
  - Closing a File Tab flushes it, then adds a Recently Closed entry holding its path and Tab state (Language, cursor, scroll).
  - The File's text stays on disk, so **closed File entries never expire**.
  - Closing the same path again replaces its older entry.
- **Reopening a File:** it is re-read from disk. If its path is gone, it opens as a Missing File, with no text. Its text was on disk.
- **Closing a File in conflict or Missing:**
  - Its shadow text moves to `closed/`, and the entry remembers the state.
  - Reopening restores the Tab with that text and the same bar.
  - Like Scratchpads, these entries expire after 30 days.
- **Scratchpads behave as today**, including the 30-day expiry.

### 5.10 JSON tools

These work in any Tab whose Language is JSON, Scratchpad or File:

- **The `{ } Format` chip:** it appears in the status bar only for JSON Tabs. Its menu holds **Beautify** and **Minify**.
- **Beautify** has the shortcut **Shift+Alt+F**, as in VS Code. It formats the selection if there is one, and otherwise the whole document, as **one undoable edit** that autosave treats like typing.
- **Indent:** 2 spaces.
- **Minify** removes all whitespace outside strings, under the same rules.
- **Never change values or order:**
  - Formatting re-indents the existing tokens. It must not parse to objects and back out with `JSON.stringify`, because that would reorder nothing but change numbers (`1.0` → `1`, `1e3` → `1000`, big integers losing precision) and escapes.
  - Keys keep their order. String escapes and number text are untouched.
  - Comments in `.jsonc` survive Beautify. Minify of JSON with comments keeps the comments. _(My call: dropping them would lose text.)_
- **Invalid JSON:** nothing changes. The status bar shows "Invalid JSON at line X, col Y" for a few seconds, and the cursor jumps there.
- **Folding:** a quiet fold gutter for languages CodeMirror can fold, which covers JSON at minimum.
  - **Mod+Shift+[** folds and **Mod+Shift+]** unfolds, as in VS Code.
  - Clicking a fold marker toggles it.
  - Copying a selection that spans folded regions copies the hidden text too.

### 5.11 Installers and "Open with"

- **CI builds unsigned installers** on all three platforms. Use a separate workflow, run manually or on a `v*` tag, to keep the normal CI fast. The installers are uploaded as workflow artifacts:
  - Windows: an NSIS installer, per-user, so no admin rights are needed.
  - macOS: a `.dmg`.
  - Linux: a `.deb` and an AppImage.
- **File associations** use Tauri's stock bundler support for now (the owner's decision).
  - Tauri's Windows installer may make Zukai the default for an extension that has no default app yet. That's accepted for this slice.
  - Guaranteeing "never the default" (a custom NSIS template, `LSHandlerRank = Alternate` on macOS) is deferred until before publishing.
  - Associated extensions: `.txt .md .markdown .json .jsonc .log .xml .yaml .yml .ini .toml .conf .cfg .env .sql .js .mjs .cjs .ts .tsx .jsx .css .html .htm .sh .bash .zsh .py .bat .cmd .ps1`.
  - `.csv`, `.tsv` and `.excalidraw` aren't registered until Table and Canvas exist.
- **Opening this way** passes the path to Zukai (5.2).

### 5.12 Safety fixes carried over from the shell

1. **Recovered closed Scratchpads** (a `closed/` file found with no Session entry) get `closedAt = now`, not the file's modified time, so recovery never purges them in the same launch.
2. **A failed flush at quit:** when the frontend reports that the flush failed, the Rust 5-second exit watchdog is cancelled, so the app stays open with the text visible ("Not saved"), as the first slice intended. A second quit still exits.

### 5.13 Status bar, in order from the right

`{ } Format` (JSON only) · **Language** · **Encoding** (e.g. `UTF-8`, `UTF-8 BOM`, `UTF-16 LE`, `Windows-1252`) · **Line ending** (`LF`, `CRLF`, `Mixed`)

- **Scratchpads** show `UTF-8` and the platform Line ending, and can't be converted. They're always UTF-8.
- **Clicking Encoding** opens the small menu from mockup 3:
  - **Reopen with encoding…**: re-decode from disk. Available only while the Tab has no Pending edits.
  - **Convert to UTF-8**, **Convert to UTF-8 with BOM**, **Convert to…**: these change how the File is written. Each is an undoable step (a CodeMirror state effect recorded in history).
  - A Convert counts as a Pending edit, so autosave writes the File in its new form right away. Undoing it writes the old form back. _(My call: the user explicitly asked for the change.)_
- **Clicking Line ending:** **Convert to LF** / **Convert to CRLF**, which are also undoable and written right away.
- **Read-only Files** show `Read-only` in place of the cursor position.

## 6. Look

- The four approved mockups (`.superpowers/brainstorm/*/content/file-states.html`) are the reference.
- **Bars:**
  - They sit between the tab bar and the editor, full width.
  - They use small text, with the Paper button style. The primary action is solid and the secondary one is quiet.
  - Colors come from new tokens added to the palette: warm amber for conflict, soft red for missing, chrome-grey for info. Each has light and dark values.
  - Bars appear with the same ≤120 ms fade as other floating surfaces.
- **Menus** (encoding, line ending, tab context, Recently Closed, Format) use the floating-surface style: `--z-surface`, `--z-radius-float`, `--z-shadow-float`.
- **No new toolbars.**

## 7. Keyboard shortcuts added in this slice

`Mod` = Ctrl on Windows and Linux, Cmd on macOS. Letters match by typed key, as in the shell's fix.

| Action | Shortcut |
|---|---|
| Open File(s) | Mod+O |
| Save (Scratchpad → Save As dialog; File → save now) | Mod+S |
| Save As | Mod+Shift+S |
| Beautify JSON | Shift+Alt+F |
| Fold / Unfold | Mod+Shift+[ / Mod+Shift+] |

## 8. Constraints

- The stack and every constraint from the shell slice still apply:
  - Tauri 2, React and TypeScript, CodeMirror 6, Tailwind v4.
  - All file I/O happens in Rust.
  - Atomic writes.
  - CI on all three OSes.
  - Bundle identifier `io.github.peota.zukai`.
  - The data folder `<data_dir>/Zukai/`.
- **Rust holds an allowlist of granted paths** _(my call)_. The webview can only touch Files the user actually opened.
  - **Paths are granted only by Rust-side sources:**
    - the open and save dialogs (shown by Rust)
    - drag and drop
    - the command line and single-instance arguments
    - File paths listed in the `session.json` that Rust reads at startup, before handing the Session to the UI
    - the Recently Closed entries in that same Session
  - **Commands on a path that isn't granted are refused.** That covers read, write, rename, watch and anything else that takes a File path.
  - **Granted paths are also checked:** absolute, and not a folder.
  - A rename or Save As grants the new path.
  - `session_write` checks that every File path in the JSON it receives is already granted, and refuses the write if not. Otherwise the webview could grant itself paths through the next launch.
  - This keeps a compromised or buggy webview from reading or writing arbitrary files.
- **Speed:**
  - Opening a typical File (≤1 MB) shows its Tab within about 100 ms of the request.
  - Watching 50 open Files must not cost noticeable CPU when idle.
- **`session.json` migration** from v1 to v2 is covered by tests.

## 9. Glossary and ADR updates (part of this slice)

- **`CONTEXT.md`:** add **Fingerprint**, **Shadow file**, **Format (Beautify / Minify)** and **Folding**.
- **`CONTEXT.md`:** update **Recently Closed**. Closed Files never expire unless they carry shadow text.
- **ADR 0001:** note the fingerprint check before writes and the shadow file.

## 10. Left to the builder

- **Code structure**, the shape of the Rust command API, and the exact events between Rust and the UI.
- **Libraries:** which crates to use for watching and encodings, and the hash function.
- **Detection details:**
  - The exact "looks binary" heuristic, within 5.3's rules.
  - How Mixed line endings are counted.
- **The JSON formatter's implementation**, within 5.10's "re-indent tokens, never re-serialise values" rule.
- **The `session.json` v2 schema**, within 5.1.
- **The test strategy.** It must at least cover:
  - the fingerprint check refusing a write
  - silent reload versus conflict
  - shadow text surviving a restart
  - Encoding, BOM and Line ending round-trips: UTF-8, UTF-8 BOM, UTF-16 LE/BE, Windows-1252, CRLF, LF, Mixed
  - read-only on undecodable bytes
  - rename refusing to overwrite on every OS
  - Save As from a Scratchpad and from a File
  - Beautify / Minify preserving numbers, escapes, key order and comments
  - Session v1 → v2 migration
  - the two safety fixes
