# Zukai — Files save on Ctrl+S

Date: 2026-11-19
Status: Approved 2026-11-19

Background reading: the glossary [`CONTEXT.md`](../../../CONTEXT.md) (**Scratchpad**, **File**, **Pending edits**, **Disk conflict**, **Missing File**, **Shadow file**, **Held**) and the ADRs this changes or leans on: [0001](../../adr/0001-files-autosave-to-disk.md) (Files autosave to disk), [0005](../../adr/0005-scratchpads-as-plain-files.md) (storage), [0007](../../adr/0007-persistent-undo-and-snapshots.md) (undo and Snapshots).

## 1. Intent

Today every edit to a File reaches the disk about 300 ms later. The owner's worry: they edit a JSON file in an Added folder, forget to undo it, and the stray change is now on disk where builds, git and other tools read it. A File has readers outside Zukai, so it shouldn't change until the owner says so.

A Scratchpad has no outside readers, so autosaving it stays as it is.

The owner compared it to Notepad++: new tabs are kept for you across restarts without asking, while a saved file changes only on Ctrl+S.

## 2. Goals, non-goals, anti-goals

**Goals**
- By default a File changes on disk only through an explicit save (Ctrl+S, Save all, Save on the close prompt, Keep mine on a Disk conflict bar).
- Scratchpads keep saving themselves, exactly as today.
- A setting, **Save files automatically**, brings back today's behaviour for Files.
- Unsaved changes to a File are never lost: they survive closing the window, quitting, a crash and a restart.

**Non-goals**
- Different rules per folder (Library vs Added folder vs anywhere else). The owner chose one rule for every File.
- An autosave delay or interval setting.
- Showing unsaved marks in the Sidebar tree.

**Anti-goals**
- **A forgotten edit reaching the disk without the owner asking.** This is the whole point. That includes turning the setting on (see 4.7).
- **Losing typed text.** Manual save must not make Zukai less safe than autosave was.
- **Nagging on quit.** Quitting never asks; unsaved Files come back next launch.

## 3. Approaches (decided 2026-11-19)

**Which Documents autosave** (owner's choice)
1. **Scratchpads only; every File needs Ctrl+S. Chosen.** The owner picked this: it's one rule, and it matches Notepad++.
2. Scratchpads and Library notes autosave; other Files need Ctrl+S. It keeps the notebook feel, but the rule depends on where a file lives. Rejected.

**Where unsaved text lives** (builder's approach, proposed)
1. **In the Tab's Shadow file. Chosen.** Held Tabs already keep their text in `pending/<tab id>.txt`, written atomically and restored after a restart. Unsaved Files reuse that, so they get crash safety for free.
2. In `session.json`. That would rewrite the whole Session for every keystroke and bloat it with large files. Rejected.
3. In memory only, with a prompt on quit. A crash would lose text, which breaks the reliable-saving priority. Rejected.

## 4. Behaviour

### 4.1 The setting
- `Settings.autosaveFiles: boolean`, default **false**, parsed like the other booleans.
- Settings dialog: a toggle labelled **Save files automatically**, with the hint "Scratchpads always save themselves. When off, a file changes on disk only when you save it."
- On: Files behave exactly as today (ADR 0001).

### 4.2 Unsaved changes (setting off)
- A File Tab has **Unsaved changes** when its text, or its format (encoding, line endings), differs from what Zukai last read from or wrote to its File. Undoing back to that text, or converting back to that format, clears it.
- **Convert** (encoding or line endings, from the status bar) is an unsaved change like an edit (owner's choice, 2026-11-19). The Tab gets the dot, and the new format reaches the disk only on save. The Session keeps the pending format alongside the unsaved flag, so a restart restores both the shadow text and the format. Don't save on the close prompt drops the conversion along with the text.
- Edits still go through the Saver, debounced, but for a File the write goes to its Shadow file instead of the disk. Nothing touches the File.
- The Session records which File Tabs have unsaved changes, so a restart restores their text from the shadow (as it does for a held Tab today).
- Scratchpads and Image Tabs are unaffected. Held Tabs follow 4.9.

### 4.3 Showing it
- Tab bar: a filled dot after the title of a Tab with Unsaved changes. On an unpinned Tab the dot sits where the close button is and turns into the close button on hover (as in VS Code). On a Pinned Tab it sits after the title, next to the pin.
- The Tab's tooltip and accessible name end with "(unsaved)".
- The status bar's existing **Not saved** stays reserved for failed writes.

### 4.4 Saving
- **Save (Mod+S):** writes the File through today's fingerprinted write. If it's written, the shadow is deleted and the dot clears. If the File changed on disk, the Tab goes into a Disk conflict as today. A Scratchpad's Mod+S still opens Save As.
- **Save all (the tab bar's right-click menu):** saves every File Tab with Unsaved changes. There's no shortcut: Ctrl+Alt is AltGr on Windows and Linux, and Mod+Shift+S is already Save As. (Changed while planning; it was Mod+Alt+S.)
- Snapshots (ADR 0007) aren't built yet. When they are, they're taken before a save writes.
- Save As / Move to Library on a Scratchpad writes the new File immediately, as today. From then on it follows the File rule.

### 4.5 Closing a Tab
- Closing a File Tab with Unsaved changes asks: "Save changes to `<name>`?" with **Save**, **Don't save** and **Cancel**.
  - Save: as 4.4. If it fails or ends in a Disk conflict, the Tab stays open.
  - Don't save: the shadow is dropped, and the Recently Closed entry reopens from disk.
  - Cancel: nothing happens.
- Closing several Tabs (Close others, Close all, closing a Split): one prompt per unsaved Tab, in tab order. Cancel stops the remaining closes.
- Pinned Tabs: closing one with Unsaved changes asks the same.

### 4.6 Quitting and restarting
- Quit, window close and OS shutdown never prompt. The final flush writes shadows, not Files, and the next launch restores each unsaved File Tab with its dot.

### 4.7 Turning the setting on or off
- **Off → on:** Tabs that already have Unsaved changes keep them until the owner saves or edits that Tab again. Only new edits autosave. This way a forgotten edit is never flushed just because the setting changed.
- **On → off:** nothing is written. New edits follow 4.2.

### 4.8 Disk changes, Missing Files, Library operations
- A File without Unsaved changes that changes on disk reloads silently, as today.
- A File with Unsaved changes that changes on disk enters a Disk conflict. "Pending edits" in today's rule now includes Unsaved changes. **Keep mine** writes the Tab's text to disk (an explicit save), **Load disk version** discards it, and **Compare** works as today.
- Missing File: unchanged. Save writes the content back.
- Rename, move and delete in the Library or an Added folder: an open Tab follows its File and keeps its Unsaved changes, and its shadow stays keyed by Tab id.
- Compare: both sides are their real Documents, so a File side gets a dot like any other Tab.

### 4.9 Held Tabs with Unsaved changes (designer's call)
A Held Tab (Disk conflict, Missing File, unencodable) still has Unsaved changes when its text differs from the disk, so it shows the dot. Its bar is where it gets resolved; Save never goes around the bar.
- **Disk conflict:** Mod+S writes nothing. It shows the notice "Resolve the conflict first" (the conflict bar is already on screen). Save all skips the Tab and names it in the notice. Only **Keep mine** overwrites.
- **Missing File:** Mod+S writes the content back to the path, the same as the bar's Save. Save all includes the Tab.
- **Unencodable:** Mod+S and Save all fail with today's "some characters can't be written" notice. Save all moves on to the next Tab.
- **Closing a Held Tab never prompts.** It closes as it does today: its text stays in its shadow and in Recently Closed, so nothing is lost. A prompt would only offer Don't save, which throws the text away, or Cancel, because Save can't succeed there.

## 5. Docs to update
- New **ADR 0012 — Files save on Ctrl+S by default**. It supersedes ADR 0001 in part (0001 becomes the "Save files automatically" behaviour), and 0001's status line points to 0012.
- `CONTEXT.md`: **File**, **Pending edits** and **Disk conflict** reworded, and a new term **Unsaved changes**.
- `PRODUCT.md`: replace "Saving is invisible: Scratchpads and Files autosave" with the new rule.

## 6. Calls made by the designer (not discussed with the owner)
- Building on Shadow files (3, approach 1).
- The tab dot replacing the close button until hover (4.3).
- Save all in the tab bar's right-click menu, with no shortcut (4.4).
- One prompt per Tab when closing several, and Cancel stops the rest (4.5).
- Turning the setting on doesn't flush existing unsaved Tabs (4.7).
- Everything in 4.9.

## 7. Left to the builder
- How the Document writer tells "autosave tick" apart from "explicit save" (for example a flag on the Saver's write, or a separate save path that bypasses the Saver).
- How the Session marks a File Tab as unsaved (a field on `FileInfo` or the Tab), and the migration default (absent = saved).
- The exact dialog component for the close prompt, reusing existing dialog styling.
- Whether Save all gets a status-bar affordance. Not required.
