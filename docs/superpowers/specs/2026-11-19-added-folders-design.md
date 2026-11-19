# Zukai — Added folders

Date: 2026-11-19
Status: Approved 2026-11-19

Background reading: the glossary [`CONTEXT.md`](../../../CONTEXT.md) (**Library**, **Library folder**, **Sidebar**, **Pinned**) and [ADR 0011](../../adr/0011-library-sidebar.md) (a Library of real folders, one folder grant).

## 1. Intent

The owner keeps some folders outside the Library, for example `D:\work\client-x`. They want to work on them **in place**, from the sidebar, next to the Library, without copying them in. Edits go to the original files.

Today the Library is one root, and the only way to see another folder is to re-point the whole Library at it. That hides the Library while you're elsewhere.

## 2. Goals, non-goals, anti-goals

**Goals**
- Add any number of outside folders to the sidebar. Each appears as its own tree under the Library.
- Inside an added folder, everything works as it does in the Library.
- Removing one from the sidebar never touches the disk.

**Non-goals**
- reordering added folders
- renaming an added folder from its heading
- per-folder settings
- adding single files
- syncing or backing up

**Anti-goals**
- **The webview can never grant itself a folder.** An added folder comes only from the OS folder dialog, run by Rust, as with **Choose Library folder…**.
- **Nothing is lost by moving across folders.** Dragging between two different trees copies; it never moves.
- **Adding a huge folder** (a whole drive, the home folder) must not make Zukai crawl.

## 3. Approaches (decided 2026-11-19)

1. **Added folders beside the Library. Chosen.** Rust keeps a list of extra folder grants, each listed, watched and indexed like the Library root. The owner picked this because they have several outside folders and want them visible alongside the Library at once.
2. **A quick switcher between whole Libraries** (a recent list on **Choose Library folder…**). It's cheap and keeps one grant, but only one folder is visible at a time and the Library disappears. Rejected.
3. **A link placed inside the Library.** It breaks the rule that outside links can't be opened, and it misbehaves with sync, zip and git. Rejected.

## 4. Behaviour (approved 2026-11-19)

**Adding**
- Where you find **Add folder…**:
  - the Library heading's ⋯ menu
  - the right-click menu on empty sidebar space
- It opens the OS folder picker (in Rust). Cancelling does nothing.
- The folder is **refused, with a message saying why**, if it is:
  - the Library root, inside it, or containing it
  - an added folder already, inside one, or containing one
  - a drive or volume root (`C:\`, `/`, `/Volumes/X`) or the user's home folder itself
  - not a folder, or unreadable

  Folders *inside* the home folder are fine.
- A new added folder goes **last** in the list and starts expanded.

**Showing**
- The sidebar order, top to bottom:
  1. Pinned
  2. Library
  3. each added folder, in the order added
  4. Scratchpads
- Each added folder has its **own heading**. The heading shows:
  - the folder's name
  - its parent path, shortened in a faint style (`D:\work`)
  - the full path in a tooltip
- Each heading collapses and expands like the Library. Its sub-folders' expanded state is kept in the Session as today (keyed by path).
- The heading's ⋯ menu offers:
  - New file
  - New folder
  - Reveal in Explorer/Finder
  - **Remove from sidebar**

**Missing**
- If an added folder is missing (an unplugged drive, or renamed outside Zukai), its heading stays, greyed out, marked **Not found**, with **Locate…** and **Remove from sidebar**.
- **Locate…** opens the folder picker and replaces that entry, with the same checks as Adding. It's treated as the folder having **moved**: open Tabs and Pinned items under the old path follow to the new one, as they do after a rename (`library_follow`). *(My call.)*
- Rust checks availability whenever `library_root` is asked, which happens at launch and when the window regains focus. A folder that comes back, such as a drive plugged in again, is **available again automatically**: its watcher and index start, and no Locate… is needed. Its entry stays in `library.json` until it's removed. *(My call.)*
- While a folder is missing, its paths fail exactly as the Library's do while the Library is offline. Every command that takes a path (`list`, `reserve`, `trash`, `reveal`, `resolve`, saving) gets the same error. *(My call.)*

**Working inside one**
- These work exactly as in the Library:
  - new file and new folder
  - rename
  - drag to move **within the same tree**
  - delete to the OS trash
  - copy-in by dropping from Explorer or Finder
  - Save As into it
  - New file into it
  - opening files
  - pinning
  - live updates on outside changes
  - Open Tabs following renames and moves
- Delete follows the Library rule: it goes to the trash, and **is refused if the drive has no trash** (some network or removable drives). It's never a permanent delete.
- The link rules apply per tree. A link that resolves inside **the same tree** behaves like its target. Anything else gets the link icon and can't be opened.
- The sidebar search covers the Library and every available added folder. Each result shows which tree it belongs to.

**Across trees**
- Dragging an item from one tree onto a folder of another (Library ↔ added, or added ↔ added) **copies** it, with ` (2)` added on a name clash. The source is untouched. While dragging across, the drop target shows a "Copy" hint.

**Removing**
- **Remove from sidebar** drops the grant and the watcher and forgets the folder. Nothing on disk changes.
- **Open Tabs from it stay open and keep saving.** Each one keeps a grant for its own file, as a file opened from Explorer would.
- **Pinned items from it stay in the Pinned list.** Opening one works only if its file grant still exists. Otherwise it shows as missing, as today.

**Re-pointing the Library**
- If **Choose Library folder…** picks a folder that overlaps an added folder (the same folder, inside it, or containing it), that added folder is **removed from the list**, and a notice says so. The Library wins. Its open Tabs are kept exactly as **Remove from sidebar** keeps them: `library_choose` takes the open paths too. *(My call.)*

## 5. Design

**Rust: grants**
- `Grants` gains a list of **added roots** beside the Library root. The Library root's offline machinery today (`RootSlot`: stored path, hint, `recover_root`, miss TTL) becomes **per root**, so a missing added folder is as safe as a missing Library. Paths under it never become loose file grants, and they re-attach when it comes back. Expect `RootSlot` to turn into a per-root struct held in a list. *(My call: the secure option over a thin list.)*
- `in_root` and `check` accept a path inside **any** granted root, and report which root. Link resolution stays per root: a link may only resolve inside the root it was found in.
- The overlap and "too broad" checks live in one pure function, so they can be tested against tmp dirs. Drive roots and the home folder are found with `dirs::home_dir()` and "path has no parent".

**Rust: storage**
- `library.json` becomes `{ "root": "...", "added": ["...", ...] }`.
- A missing or malformed `added` is an empty list. Malformed entries are dropped one by one, so the root is never lost.
- The overlap check runs **at load** too, so a hand-edited file can't sneak an overlap in. The Library root wins over any added folder, and earlier entries win over later ones. A dropped entry is logged, not shown. *(My call.)*
- Only Rust writes it. This applies to the ADR 0011 rule for the root and to the new list.

**Rust: commands**
- `library_root` returns `{ root, available, added: [{ path, available }] }`.
- New commands:
  - `library_add_folder` (dialog, checks, saves, starts the watcher and index)
  - `library_locate_folder(path)`
  - `library_remove_folder(path)`

  Each returns the new state.
- On removal, Rust turns each open file under that folder into a file grant. The webview passes its open paths, as `library_follow` does, and Rust grants only paths that were inside the removed root.

**Rust: watcher, index, ops**
- One watcher and one name index per root, with the same debounce and events. `zukai://library-changed` dirs may be from any root.
- `move` across roots is refused. The UI turns a cross-tree drop into a `copy_into`.
- `drop_into` and `reserve` accept any root.

**Front end**
- `RootState` gains `added`.
- `Sidebar` renders one `LibraryTree` section per available root, plus the missing headings. `LibraryTree` already takes its root by prop or can be made to.
- Drag-and-drop compares the source and destination roots to choose move or copy.

**Docs**
- An ADR 0011 note (or ADR 0012) recording that the grant is now several folders the user chose, and why.
- A glossary entry for **Added folder**, with _Avoid_: linked folder, workspace folder, mount.

## 6. Out of scope

- reordering added folders
- moving (not copying) across trees
- adding single files
- adding the same folder twice under different names
- network-share specifics beyond "works if the OS treats it as a folder"

## 7. Testing

- **Rust:**
  - the overlap and too-broad checks (inside, containing, equal, case differences on Windows, drive root, home)
  - the `library.json` round trip with junk entries
  - grants per root, including a link escaping from an added root into the Library being refused
  - remove turns open files into file grants
  - cross-root move refused
  - watcher events from an added root
- **Front end:**
  - the sidebar order and headings
  - missing headings with Locate and Remove
  - cross-tree drop copies
  - search results tagged by tree
  - Remove keeps Tabs open
- **Manual:** add a folder on another drive, edit a file from Explorer while it's open, then unplug or rename the folder and see **Not found**.

## 8. Left to the builder

- **Watcher sharing.** Whether the watchers share one `notify` instance or run one each.
- **Search result marking.** How a result shows its tree: a suffix, or a group heading.
- **Copy hint styling.** How the "Copy" hint looks while dragging across trees.
