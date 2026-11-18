# Zukai — Third slice: Library and Canvas

Date: 2026-11-18
Status: Draft, waiting for approval

Background reading:
- [`docs/vision.md`](../../vision.md) and the glossary [`CONTEXT.md`](../../../CONTEXT.md)
- the ADRs in [`docs/adr/`](../../adr/), especially [0001](../../adr/0001-files-autosave-to-disk.md), [0002](../../adr/0002-tauri-shell-with-embedded-excalidraw.md), [0010](../../adr/0010-v1-milestone-order.md) and the new [0011](../../adr/0011-library-sidebar.md)
- the earlier slice designs: [shell](2026-10-25-shell-design.md) and [Files](2026-10-26-files-design.md)

Capitalised terms mean what the glossary says.

## 1. Intent

The owner works idea by idea. A new idea collects Markdown notes, Excalidraw flows, photos or screenshots, and plain text or JSON files. They want all of that in one place and to jump between the pieces quickly. This slice adds two things:

- **The Library.** A sidebar showing a real folder on disk, the Zukai home folder, as a tree of project folders and their files.
- **Canvas.** Excalidraw, so that flows live in the Library next to the notes, as `.excalidraw` Files and as Canvas Scratchpads.

It also adds a simple **Image** viewer, so photos in a project open in a Tab.

This deliberately reverses two earlier decisions: "Zukai has no project concept" and "no sidebars". [ADR 0011](../../adr/0011-library-sidebar.md) records why. It also moves Canvas (M3) earlier in [ADR 0010](../../adr/0010-v1-milestone-order.md)'s order.

## 2. Goals

1. A **Library home folder** on disk. By default it is `Documents/Zukai`, under the operating system's Documents folder, and Zukai creates it on first use. The user can point Zukai at a different folder.
2. A **sidebar** (layout A, approved) with these parts, toggled with **Mod+B**:
   - a search box
   - the **Library** tree: folders and files, with an icon per file kind
   - an **Inbox** of open Scratchpads
3. **Library operations** from the sidebar:
   - new folder, new note (`.md`), new text file (`.txt`) and new canvas (`.excalidraw`)
   - rename and move, by drag and drop
   - delete to the operating system's trash
   - **Show in Explorer / Finder**
   - copying files dropped in from outside into a folder
4. The tree **stays in sync** when files are added, renamed or deleted outside Zukai.
5. **Canvas** (Excalidraw):
   - Canvas Scratchpads (**Mod+Shift+N**) and `.excalidraw` Files, both autosaved
   - Disk changes and Disk conflicts behave as they do for text
   - Excalidraw is loaded only when the first Canvas Tab opens
   - its theme follows Zukai's light and dark
6. **Image** Tabs: read-only, fit to the window, zoom and pan. The status bar shows the dimensions, the format and the size. The image reloads when the file changes on disk.
7. Moving a Scratchpad from the Inbox into the Library is Save As into a Library folder.

## 3. Non-goals for this slice

All of these are planned for later.

- **Not in the sidebar yet:**
  - searching inside file contents (search filters by name only)
  - tags
  - item counts
  - Pinned and Recent sections
  - more than one Library
- **Folders outside the Library:** opening an arbitrary folder from outside it, as VS Code does, is not supported. The Library is the one place folders appear. The command-line, drag-and-drop and Open-with rules from the Files slice are unchanged.
- **Settings UI.** Changing the Library location is a single command for now (5.1).
- **Canvas undo across restarts and Canvas Snapshots** (M2). Excalidraw's own undo works within a session.
- **Compare and merge for Canvas.** A Canvas Disk conflict has only Keep mine and Load disk version.
- **Editing images.** Images are view-only.
- **Collaboration and Excalidraw's online features:** live collaboration, sharing links, the Excalidraw+ library and online fonts.

## 4. Anti-goals

- **Losing text or drawings.** That covers crashes, quitting, moving, renaming, deleting, a Canvas Disk conflict, and the Library folder changing underneath Zukai.
- **Permanently deleting a user's file.** A delete from the sidebar always goes to the operating system's trash.
- **The sidebar getting in the way.**
  - Mod+B hides it completely.
  - With it hidden, Zukai looks and behaves exactly as it does today.
  - It must never slow down startup or typing.
- **Excalidraw slowing down startup.** A session with only text open never loads it.
- **Overwriting files on a move or copy.** A name clash gets a new name, such as `notes (2).md`. Nothing is replaced silently.

## 5. Behavior

### 5.1 The Library home folder

- **Location.** The default is `<OS Documents folder>/Zukai`. It's created the first time the sidebar is shown, or when the first project is created.
- **Changing the location.** The sidebar header menu has **Choose Library folder…**, which opens the native folder dialog. This only points Zukai at the chosen folder. It never moves or copies anything.
- **Where the root is stored.** The Library root path is stored by Rust in `library.json` (see 5.8, item 4). It is not stored in the Session.
- **Root unavailable.** If the root is missing or unreachable at launch, for example an unplugged drive, the sidebar says so and offers **Choose Library folder…** or **Create it again**. Open Tabs are unaffected.
- **Allowlist.** The allowlist from the Files slice gains a **folder grant** for the Library root. Everything inside it may be read and written. Nothing outside it is affected.
  - The grant is made only by Rust, from the stored root or from the folder dialog.
  - Paths are still checked to be inside the root after resolving symlinks and `..`.

### 5.2 Sidebar (layout A)

- **Placement.** The sidebar sits to the left of the tab bar and editor, below the native title bar. Its default width is 240 px. The width can be dragged, and both the width and whether it's open are remembered in the Session. Mod+B toggles it.
- **Search box.** It filters the tree by file and folder name as you type. Matching items are shown together with their parent folders. Esc clears the filter.
- **The Library tree.**
  - Folders come first, then files, both sorted alphabetically with natural number order (`2` before `10`).
  - Hidden files (dotfiles) are not shown.
  - Each folder can be expanded or collapsed, and that state is remembered in the Session.
  - Each file shows a small line icon for its kind: Markdown, Canvas, Image, JSON or data, plain text, or other.
- **Clicking a file** opens it in a Tab, or switches to it if it's already open. The Tab of the active File is highlighted in the tree.
- **Inbox.** It lists the open Scratchpads by Title, and clicking one activates it. Its right-click menu has **Move to Library…**, which works like Save As with the folder dialog starting in the Library. Dragging an Inbox item onto a Library folder saves it there, named after its Title (with `.md` for Text and `.excalidraw` for Canvas).
- **Keyboard.**
  - Up and Down move through the tree.
  - Left and Right collapse and expand.
  - Enter opens.
  - F2 renames.
  - Delete moves to the trash.
  - Mod+Shift+E focuses the sidebar.
  - Esc returns focus to the editor.
- **Look.** It follows Paper: a slightly tinted background, hairline separation from the editor, and no borders on the rows. The selected row is a soft fill, and hover is fainter still. Icons are monochrome.

### 5.3 Library operations (right-click menu and toolbar `+`)

- **On a folder or the root:**
  - New folder
  - New note (`.md`)
  - New text file (`.txt`)
  - New canvas (`.excalidraw`)
  - Show in Explorer / Finder
- **On a file:**
  - Open
  - Rename
  - Delete
  - Show in Explorer / Finder
  - Copy path
- **New items** are created with a free name, for example `Untitled.md` and then `Untitled 2.md`. They open at once with an inline rename field focused. A new note or canvas also opens in a Tab.
- **Rename** happens inline, just like renaming a File Tab: the extension is locked for files, it fails with an inline error if the name already exists, and it never replaces anything. Renaming a folder that holds open Files updates those Tabs' paths.
- **Move** is done by dragging within the tree, using pointer events like the tab bar. Dropping onto a folder moves the item into it, using a rename that never replaces. A name clash gets ` (2)`. Open Files that move keep their Tabs, with updated paths.
- **Delete** moves the item to the operating system's trash. There's no confirmation for a single file. A folder that isn't empty gets a short inline confirmation: "Move 'X' and its N items to the Trash?". Open Tabs for deleted Files become Missing Files, following the existing rules.
- **Files dropped from outside** (from Explorer or Finder) onto a Library folder are copied into it, with name clashes getting ` (2)`. Drops anywhere else in the window keep today's behaviour: the files open as Tabs.
- **Show in Explorer / Finder** reveals the item in the operating system's file manager.
- Every operation runs in Rust, and only inside the Library grant.

### 5.4 Keeping the tree in sync

- **Watching.** Rust watches the Library root recursively, debounced, and updates the tree when files are added, removed or renamed outside Zukai.
- **Large Libraries.** Up to tens of thousands of files must not freeze the UI. The tree lists a folder's contents only when it's expanded, and the watcher work happens in Rust.
- **Open Files** in the Library follow all the Files-slice rules (Disk changes, Disk conflicts, Missing Files). An outside rename of an open File still makes it a Missing File. Zukai doesn't follow outside renames.

### 5.5 Canvas

This follows [ADR 0002](../../adr/0002-tauri-shell-with-embedded-excalidraw.md).

- **The Canvas Kind.**
  - A `.excalidraw` File, or a Canvas Scratchpad (`scratchpads/<id>.excalidraw`), opens in an embedded Excalidraw editor.
  - Excalidraw's own toolbar and menus are kept, restyled to fit Paper as far as its theming allows.
  - Its online and collaboration features are turned off.
- **Lazy loading.** Excalidraw is loaded the first time a Canvas Tab opens. A loading state shows in that Tab only.
- **Saving.**
  - The scene (elements, appState relevant to the file, and embedded files) is serialised to the standard `.excalidraw` JSON.
  - It's saved through the same autosave, fingerprint and atomic-write path as text: UTF-8, no BOM.
  - It's saved only when the drawing actually changes, not on every pointer move or on viewport changes.
- **Disk changes.**
  - With no Pending edits, an outside change reloads the scene.
  - With Pending edits it becomes a Disk conflict, with the same bar and the same Keep mine / Load disk version buttons.
  - Text typed in Excalidraw counts as a drawing change.
- **Unreadable files.** An unreadable or invalid `.excalidraw` file opens read-only with a notice that the file isn't a valid Excalidraw drawing. It's never saved over.
- **Theme.** Excalidraw follows the app's light or dark mode live.
- **Tab state.** The viewport (scroll and zoom) is remembered per Tab in the Session.
- **Shortcuts.** Mod+Shift+N creates a Canvas Scratchpad. Excalidraw's own shortcuts work while the canvas has focus. The app shortcuts (Mod+N, Mod+W, Mod+Tab, Mod+B, Mod+S, Mod+Shift+S) still work.
- **Save and Save As.** Ctrl+S and Save As behave as they do for text. Save As of a Canvas Scratchpad defaults to `.excalidraw`.

### 5.6 Image

- **Formats.** `.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`, `.bmp` and `.svg` open as an **Image** Tab.
  - SVG is shown as an image and never as live markup, so no scripts run.
  - Image bytes are read through Rust under the same grants.
- **Viewing.** The image fits the window by default.
  - Mod+= and Mod+- zoom, and Mod+0 returns to fit.
  - Mod+wheel zooms toward the cursor, and dragging pans.
  - The background is subtly checkered for transparency.
- **Status bar.** It shows the dimensions, the format and the file size. The image is read-only.
- **Reloading.** The image reloads when the file changes on disk. If it's deleted, the Tab shows a Missing state with **Show in Explorer** disabled.

### 5.7 Opening other files

- **Text, Canvas and Image** open in Zukai as described above.
- **Other files** (PDF, zip and so on) open as read-only Tabs with an **Open with default app** button (5.8, item 2). The opener is restricted to Library paths and never runs executables or scripts.

### 5.8 Decisions from the builder check _(my calls)_

1. **Search covers the whole Library**, not just expanded folders.
   - Rust builds an in-memory index of names, walking the Library in the background on first search or sidebar open, and keeps it up to date from the watcher.
   - The tree itself still lists folders lazily.
   - A Library that's still being indexed shows "Searching…" until the index is ready.
2. **Text versus other files.** A file opens in a Tab unless it's Canvas, Image or one of the deferred Kinds. An unreadable file opens read-only, using the Files-slice rule. That read-only bar gains **Open with default app**.
   - **The opener never launches executables or scripts:** `.exe .com .msi .bat .cmd .ps1 .vbs .lnk .app .desktop .sh .command`.
   - Those files open as text if they're readable, and otherwise offer only **Show in Explorer / Finder**.
   - The opener is never triggered by a single click, only by the explicit button.
3. **Symlinks and junctions inside the Library.**
   - The tree walk and the watcher don't follow links.
   - A link whose target resolves inside the root behaves like its target.
   - A link that resolves outside the root is shown with a link icon and can't be opened.
   - A move or copy whose destination resolves outside the root is refused.
4. **Where the Library root is stored.** It lives in a Rust-owned file, `library.json` in the app data folder. Only Rust writes it, from the default location or a folder-dialog pick.
   - It is never stored in `session.json`, so the webview can't set it.
   - The Session only stores sidebar UI state: open, width, and expanded folders.
5. **Moving, renaming or deleting a folder with open Files.**
   - First, every affected Tab is flushed. If any flush fails, the operation is refused with a notice.
   - **Held Tabs.** Their Shadow files are keyed by Tab id, so they don't move. A Held Tab under a moved folder keeps its held state with the new path.
   - **After the operation**, Rust re-watches, and the UI rewrites every path reference: open Tabs, Recently Closed entries and expanded-folder state.
   - **Windows.** If a rename, move or trash fails because a watcher handle is open, Zukai drops those watchers, retries for up to 2 s while the folder is still held open, and then re-watches. `ERROR_ACCESS_DENIED` (5) is ambiguous: a real permission (ACL) refusal looks the same, so it also waits up to 2 s before the error is shown.
6. **Session version 3.**
   - v2 Sessions migrate. A File Tab whose path ends in `.excalidraw` becomes Canvas, and an image extension becomes Image.
   - An older build reading v3 falls back to the existing "future version → back up and rebuild" behaviour.
7. **Naming in Move to Library and Inbox drag.**
   - "Move to Library…" opens the native **save** dialog, starting in the Library, with a suggested name.
   - Inbox drag uses the same suggested name, with ` (2)` added on a clash.
   - The suggested name is the Title, with characters that are illegal in file names stripped and runs of whitespace collapsed. An empty Title becomes `Untitled`.
   - The extension follows the Kind and Language:
     - Canvas → `.excalidraw`
     - Markdown → `.md`
     - plain text → `.txt`
     - JSON → `.json`
     - otherwise the Language's usual extension (`.sql`, `.py`, `.yaml`…)
8. **Shortcut clashes inside a Canvas.**
   - App shortcuts win, including Mod+Shift+E (focus sidebar).
   - Excalidraw's export is still available from its own menu.

## 6. Keyboard shortcuts added in this slice

`Mod` means Ctrl on Windows and Linux, and Cmd on macOS. Letters match the typed key.

| Action | Shortcut |
|---|---|
| Show / hide sidebar | Mod+B |
| Focus sidebar | Mod+Shift+E |
| New Canvas Scratchpad | Mod+Shift+N |
| Rename in sidebar | F2 |
| Delete in sidebar (to Trash) | Delete |
| Image zoom in / out / fit | Mod+= / Mod+- / Mod+0 |

## 7. Constraints

- All the earlier constraints still apply:
  - all file I/O happens in Rust
  - the allowlist
  - atomic, fingerprint-checked writes
  - Session v2 is extended, and older Sessions migrate
  - CI on all three operating systems
  - the Paper tokens
- **Trash** uses the operating system's recycle bin or trash through a Rust crate such as `trash`. If the trash isn't available (for example on some network drives), the delete is **refused** with a notice. It never falls back to a permanent delete.
- **Excalidraw** is `@excalidraw/excalidraw` (MIT), pinned to an exact version and loaded by dynamic import. Its fonts and assets are bundled and never fetched from a CDN.
- **Speed.**
  - Toggling the sidebar is instant.
  - Expanding a folder of 1,000 items stays under 100 ms.
  - The first Canvas Tab may take a moment to load Excalidraw, but a text-only session doesn't change at all.

## 8. Glossary and ADR updates (part of this slice)

- **`CONTEXT.md`.**
  - Add: **Library**, **Library folder** (a project folder in the Library), **Sidebar**, **Inbox**, the **Image** Kind, and the Canvas details.
  - Remove: "Folders can't be opened… no project concept" and "There is no separate notes library".
  - Replace them with the Library rules.
- **New [ADR 0011](../../adr/0011-library-sidebar.md):** the Library sidebar uses real folders in a Zukai home folder. It reverses the earlier "no project concept" and "no sidebar" decisions.
- **ADR 0010:** note that Canvas (M3) moves before M2, delivered together with the Library.

## 9. Left to the builder

- The code structure, the shape of the Rust commands for the tree and operations, and the event payloads.
- The tree virtualisation approach, provided the speed targets are met.
- The exact icon set (monochrome line icons, bundled).
- How far Excalidraw's UI can be restyled toward Paper, and how its change detection is debounced. It must not save on viewport changes.
- The name-clash suffix format.
- **The test strategy.** It must at least cover:
  - the Library grant (inside allowed, outside refused, symlink and `..` escapes refused)
  - create, rename and move never replacing anything
  - delete going to the trash, and being refused when the trash is unavailable
  - moving or renaming a folder with open Files
  - the tree syncing on outside changes
  - Canvas save, reload and conflict
  - invalid `.excalidraw` opening read-only
  - Canvas not loaded in a text-only session
  - Image formats, including SVG never executing script
  - Session migration
