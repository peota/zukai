# Zukai Library and Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Library sidebar, Canvas and Image Tabs, and a guarded "Open with default app".
- **Library sidebar:** a tree of real folders and files in a Zukai home folder, with search, file operations, live sync and an Inbox of Scratchpads.
- **Canvas Tabs:** Excalidraw, loaded on demand, for Scratchpads and `.excalidraw` Files.
- **Image Tabs:** read-only viewing of image files.

**Architecture:**
- **Rust owns the Library.** It stores the root in a Rust-only `library.json` and grants the whole root folder in the existing allowlist. It lists folders on demand, keeps a background name index updated by a recursive watcher, and performs every file operation (create, rename, move, copy, trash, reveal, open).
- **The web side** gains a Document **Kind** (`text | canvas | image`) on `TabState` (Session v3), a pure tree model, a `Sidebar` component and a `useLibrary` hook.
- **Editors:** `EditorHost` keeps the text editor. `CanvasHost` lazily imports Excalidraw. `ImageHost` shows images from bytes read through Rust.
- **Splitting `useFiles.ts`:** it is 1,250 lines, so it is split first as pure moves along the seams agreed in the last review.

**Tech Stack:** As before (Tauri 2, React 19 + TS, CodeMirror 6, Tailwind v4, Vitest, cargo tests, GitHub Actions). New dependencies:
- **Rust:** `trash` (OS recycle bin), `tauri-plugin-opener` (reveal / open default app, Rust side only), `dirs` (Documents folder) and `notify` (recursive mode, already present).
- **npm:** `@excalidraw/excalidraw`, pinned to an exact version at least two weeks old.

**Spec:** [`docs/superpowers/specs/2026-11-18-library-canvas-design.md`](../specs/2026-11-18-library-canvas-design.md). Also read [ADR 0011](../../adr/0011-library-sidebar.md), [ADR 0002](../../adr/0002-tauri-shell-with-embedded-excalidraw.md) and [`CONTEXT.md`](../../../CONTEXT.md).

## Global Constraints

**File access**
- All file I/O stays in Rust.
- The webview never passes a path Rust didn't grant. The Library root is a **folder grant**: any path that resolves (after symlinks and `..`) inside the root is allowed, and anything resolving outside is refused with `not_granted`.

**The Library root**
- Stored only in `<app data>/Zukai/library.json` (`{ "root": "<abs path>" }`), written only by Rust.
- The default is `dirs::document_dir()/Zukai`, created on first use.
- It is never stored in `session.json`.

**File operations**
- They never replace an existing file. A name clash becomes `name (2).ext`, `name (3).ext` and so on.
- Rename keeps the file extension locked.
- Delete uses the OS trash only. If trashing fails, the delete is refused with a notice and never falls back to a permanent delete.
- A move or copy whose destination resolves outside the root is refused. So is moving a folder into itself or into one of its own descendants.

**Tree and search**
- Links are never followed in the tree walk, the watcher or the name index.
- A link that resolves inside the root behaves like its target. One that resolves outside is shown with a link icon and can't be opened.
- Dotfiles are hidden.
- Sort order: folders first, then natural, case-insensitive name order.

**Default-app opener**
- Only from an explicit **Open with default app** button.
- It refuses `.exe .com .msi .bat .cmd .ps1 .vbs .lnk .app .desktop .sh .command`.

**Kinds**
- **Canvas:** `.excalidraw`.
- **Image:** `.png .jpg .jpeg .gif .webp .bmp .svg`.
- **Text:** everything else, including the Kinds deferred to later slices (`.csv`, `.tsv`).
- SVG is shown only as `<img src=blob:…>`, never inlined.

**Session**
- `version: 3`. A v2 Session migrates: each Tab's Kind is derived from its File extension, and Scratchpads become Text.
- Sidebar UI state stored in the Session: `{ open, width, expanded: string[] }`.

**Canvas**
- Serialised with Excalidraw's `serializeAsJSON` (type `"excalidraw"`), saved through the existing Saver as UTF-8 text.
- It saves only when the scene's element versions or files change, never on viewport changes.
- Excalidraw's collaboration and online features are off, and its assets are bundled.
- Canvas Scratchpads are stored as `scratchpads/<id>.excalidraw`.

**Shortcuts**
- Mod+B toggles the sidebar.
- Mod+Shift+E focuses the sidebar. App shortcuts win over Excalidraw's.
- Mod+Shift+N creates a Canvas Scratchpad.
- In the sidebar: F2 renames and Delete trashes.
- In an Image Tab: Mod+= / Mod+- / Mod+0 zoom in, out and fit.

**Look and speed**
- The sidebar defaults to 240 px wide, its width can be dragged, and it uses Paper tokens: tinted `--z-side` background, `--z-row-hover` and `--z-row-sel` rows, monochrome icons.
- Toggling the sidebar is instant.
- Expanding a folder of 1,000 items takes under 100 ms.
- A text-only session never loads Excalidraw.

## Review Focus

1. **A project containing a huge folder, such as `node_modules` with 100k files.** Building the name index must run off the UI thread, and the sidebar must stay responsive. Search shows "Searching…" until the index is ready. Test in Task 4: `index_build_runs_in_background_and_search_reports_partial`.
2. **Moving a folder that contains an open File with unsaved edits.** All affected Tabs flush first, and the move is refused if any flush fails. The Tab paths then follow the move. Test in Task 7: `moveFolderWithDirtyOpenFileFlushesFirst` and `moveRefusedWhenFlushFails`.
3. **Dragging a folder onto itself or into its own subfolder.** This is refused with a notice and nothing changes on disk. Test in Task 3: `move_into_own_descendant_refused`.
4. **Several dropped files with the same name.** Each gets a unique ` (n)` suffix, and none is lost or overwritten. Test in Task 3: `copy_into_names_clashes_uniquely`.
5. **Excalidraw's `onChange` firing on every pointer move and scroll.** No autosave happens unless elements or files actually change. Test in Task 8: `viewportChangesDoNotSave`.

---

## File Structure

```
src-tauri/src/
  library/mod.rs        – LibraryError mapping, re-exports
  library/root.rs       – library.json load/save, default root, ensure exists
  library/ops.rs        – list_dir, create_folder, create_file, rename_entry, move_entry, copy_into, trash_entry, unique_name
  library/index.rs      – NameIndex (background walk, search, apply changes)
  library/watch.rs      – recursive root watcher → "zukai://library-changed"
  library/commands.rs   – #[tauri::command] wrappers
  files/grants.rs       – (modify) folder grant: set_root / check paths under root
  files/commands.rs     – (modify) file_read_bytes, open_default
  storage/scratchpads.rs– (modify) per-id extension (txt | excalidraw)
src/
  app/files/            – split of useFiles.ts: loading.ts, diskChanges.ts, barActions.ts, save.ts, closeReopen.ts, opening.ts, index.ts (useFiles composes them)
  model/types.ts        – (modify) Kind, TabState.kind, SidebarState
  model/kinds.ts        – kindOf(path), IMAGE_EXTS, CANVAS_EXT, EXEC_EXTS
  model/session.ts      – (modify) v3 + migration + sidebar state
  library/api.ts        – typed wrappers + onLibraryChanged
  library/tree.ts       – pure tree model (entries per dir, expanded, filter, apply changes, natural sort)
  library/names.ts      – sanitizeFileName, suggestedFileName(tab), extFor(tab)
  app/useLibrary.ts     – root state, tree loading, ops, Inbox moves, path rewrites
  ui/Sidebar.tsx, ui/LibraryTree.tsx, ui/Inbox.tsx, ui/icons.tsx
  canvas/CanvasHost.tsx – lazy Excalidraw, serialise, change detection, theme, viewport
  canvas/scene.ts       – parseScene(text) / sceneChanged(prev, next)
  image/ImageHost.tsx   – blob URL, fit/zoom/pan, status info
  App.tsx, ui/StatusBar.tsx, ui/FileBar.tsx, app/shortcuts.ts – (modify)
```

---

### Task 1: Split `useFiles.ts` (pure moves)

**Files:**
- Create: `src/app/files/{loading,diskChanges,barActions,save,closeReopen,opening,index}.ts`
- Modify: `src/app/useFiles.ts` (becomes a thin re-export or is removed), plus its imports in `useWorkspace.ts`

**Interfaces:**
- Produces: the same `useFiles(...)` signature and the same `FilesApi`, `FilesInternals`, `FilesInternalApi`, `ConvertRequest`, `ReplaceRequest`, `FormatRequest` and `NOTICE_MS` exports. Import them from `src/app/files/index.ts`. `src/app/useFiles.ts` may re-export them.
- Seams:
  - `loading`: `readShadow`, `readFileText`, `loadContent`, `afterRestore`, the unreadable mask
  - `diskChanges`: `recheck`, `reloadLocked`, `recheckAll`, event / focus / watch effects
  - `barActions`: `keepMine`, `loadDiskVersion`, `saveToOriginal`, `reopenWithEncoding`, `convert`, `updateTab`
  - `save`: `save`, `saveAs`, `renameFile`
  - `closeReopen`: `closeFile`, `reopenFile`, `reopenEntry`
  - `opening`: `openOne`, `openPaths`, `openFrom`, `pickAndOpen`, the launch effect
- The pieces share one context object. Each file stays under about 300 lines.

- [ ] **Step 1: Move the code** into the seams, keeping behaviour identical. **Do not change** `src/app/useFiles.test.ts`, except for import paths if they must change.
- [ ] **Step 2: Run** `pnpm test && pnpm lint && pnpm typecheck`. Expected: all pass (400 tests), with 0 lint warnings.
- [ ] **Step 3: Commit** with `git commit -m "refactor(files): split useFiles into focused modules"`.

### Task 2: Kind, Session v3, and Canvas Scratchpad storage

**Files:**
- Create: `src/model/kinds.ts`, `src/model/kinds.test.ts`
- Modify: `src/model/types.ts`, `src/model/session.ts` (+ tests), `src/model/workspace.ts` (`newTabState(id, kind = "text")`), `src-tauri/src/storage/scratchpads.rs` (+ tests), `src-tauri/src/commands.rs`, `src/storage/api.ts`, the writer and loader call sites

**Interfaces:**
- Produces in TS:
  ```ts
  export type Kind = "text" | "canvas" | "image";
  // TabState gains: kind: Kind
  export interface SidebarState { open: boolean; width: number; expanded: string[] }
  // SessionFile v3 gains: sidebar: SidebarState  (default { open: false, width: 240, expanded: [] })
  export function kindOf(path: string): Kind;          // by extension, case-insensitive
  export const CANVAS_EXT = ".excalidraw";
  export const IMAGE_EXTS: readonly string[];          // [".png",".jpg",".jpeg",".gif",".webp",".bmp",".svg"]
  export const EXEC_EXTS: readonly string[];           // [".exe",".com",".msi",".bat",".cmd",".ps1",".vbs",".lnk",".app",".desktop",".sh",".command"]
  ```
- Produces in Rust: scratchpad read, write, close, reopen, list and list_closed handle `<id>.txt` **and** `<id>.excalidraw`.
  - `write(base, id, content, ext: ScratchExt)` with `enum ScratchExt { Txt, Excalidraw }` (serde `"txt" | "excalidraw"`). Read, close and reopen find whichever exists.
  - `list` returns `Vec<{ id, ext }>`.
  - The commands `scratchpad_write` and `scratchpad_list` gain this argument and return value, and the TS wrappers change to match.

- [ ] **Step 1: Write the failing tests.**
  - `kindOfByExtension`: `a.EXCALIDRAW` → `"canvas"`, `x.PNG` → `"image"`, `x.svg` → `"image"`, `x.md` → `"text"`, `Makefile` → `"text"`.
  - `v2SessionMigratesToV3WithKinds`: a File Tab `…/flow.excalidraw` → `canvas`, `…/a.png` → `image`, a Scratchpad → `text`, and `sidebar` gets its default.
  - `v3RoundTrip`.
  - `futureVersionStillRejected`: version 4 → `null`.
  - Rust `excalidraw_scratchpad_round_trips_and_lists_with_ext`.
  - Rust `close_reopen_canvas_scratchpad`.
- [ ] **Step 2: Run** `pnpm test src/model` and `cargo test storage::scratchpads`. Expected: FAIL.
- [ ] **Step 3: Implement.** New Tabs get `kind`. Files opened by path get `kindOf(path)`. Scratchpad writes pass `"excalidraw"` for canvas Tabs and `"txt"` otherwise.
- [ ] **Step 4: Run** the full TS and Rust suites. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(model): document kinds, session v3, canvas scratchpad storage"`.

### Task 3: Rust Library core (root, folder grant, listing, operations)

**Files:**
- Create: `src-tauri/src/library/{mod,root,ops,commands}.rs`
- Modify: `src-tauri/src/files/grants.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` (`trash`, `dirs`, `tauri-plugin-opener`), `src-tauri/capabilities/default.json` (no opener permission for the webview)

**Interfaces:**
- Produces in Rust:
  ```rust
  // root.rs
  pub fn load_root(data: &Path) -> Option<PathBuf>;                 // library.json
  pub fn save_root(data: &Path, root: &Path) -> io::Result<()>;     // atomic
  pub fn default_root() -> Option<PathBuf>;                         // dirs::document_dir()/Zukai
  // grants.rs
  impl Grants { pub fn set_root(&self, root: &Path) -> Result<PathBuf, FileError>;   // canonical
                pub fn in_root(&self, p: &Path) -> Result<PathBuf, FileError> }      // canonical, must be inside root; else not_granted
  // check()/check_exact() also accept paths under the root (exactly-canonical for session checks)
  // ops.rs
  #[derive(Serialize)] #[serde(rename_all="camelCase")]
  pub struct Entry { pub name: String, pub path: String, pub is_dir: bool, pub link: Option<LinkKind> }   // LinkKind: Inside | Outside
  pub fn list_dir(dir: &Path) -> io::Result<Vec<Entry>>;            // no dotfiles; dirs first; natural, case-insensitive
  pub fn unique_name(dir: &Path, stem: &str, ext: &str) -> PathBuf; // "stem.ext", "stem (2).ext", …
  pub fn create_folder(parent: &Path, name: &str) -> Result<PathBuf, FileError>;
  pub fn create_file(parent: &Path, stem: &str, ext: &str, contents: &[u8]) -> Result<PathBuf, FileError>;
  pub fn rename_entry(path: &Path, new_name: &str) -> Result<PathBuf, FileError>;   // files: extension locked; no replace
  pub fn move_entry(path: &Path, dest_dir: &Path) -> Result<PathBuf, FileError>;     // unique name on clash; refuse into own descendant
  pub fn copy_into(srcs: &[PathBuf], dest_dir: &Path) -> Vec<Result<PathBuf, FileError>>;
  pub fn trash_entry(path: &Path) -> Result<(), FileError>;          // trash crate; error → FileError::TrashUnavailable
  ```
  - `FileError` gains `TrashUnavailable` (kind `"trash_unavailable"`) and `IntoSelf` (kind `"into_self"`).
- Produces these Tauri commands:
  - `library_root() -> { root: string | null, available: boolean }`. It also grants the root.
  - `library_use_default()` and `library_choose()` (folder dialog). Both save `library.json`, grant the root, and return the same shape.
  - `library_list(dir)`
  - `library_create_folder(parent, name)` and `library_create_file(parent, stem, ext)`
  - `library_rename(path, newName)`
  - `library_move(path, destDir)`
  - `library_copy_into(srcs, destDir)`. `srcs` must come from a Rust drop event or already be granted.
  - `library_trash(path)`
  - `library_reveal(path)`
- Every command checks `in_root` (or that the target is the root itself) on a blocking thread.

- [ ] **Step 1: Write the failing tests** (all using `tempdir`):
  - `root_round_trips_in_library_json`
  - `in_root_accepts_inside_refuses_outside_and_dotdot`
  - `in_root_refuses_symlink_escape` (`#[cfg(unix)]`, plus a junction test on Windows if feasible)
  - `list_dir_hides_dotfiles_sorts_dirs_first_natural` (`a2` sorts before `a10`)
  - `list_dir_marks_links_inside_and_outside` (`cfg(unix)`)
  - `create_file_picks_unique_name` (`Untitled.md`, then `Untitled 2.md` — note that the spec's new-item names use a space; clashes from move and copy use ` (2)`)
  - `rename_entry_keeps_extension_and_refuses_existing`
  - `move_entry_suffixes_on_clash`
  - `move_into_own_descendant_refused`
  - `move_dest_outside_root_refused`
  - `copy_into_names_clashes_uniquely` (three `a.png` → `a.png`, `a (2).png`, `a (3).png`)
  - `trash_failure_is_refused_not_deleted` (inject a failing trash function; the file still exists)
- [ ] **Step 2: Run** `cargo test library::`. Expected: FAIL. Then implement and run again. Expected: PASS.
- [ ] **Step 3: Run** the full cargo checks: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test`.
- [ ] **Step 4: Commit** with `git commit -m "feat(library): root, folder grant, listing and safe file operations"`.

### Task 4: Name index, recursive watch and search

**Files:**
- Create: `src-tauri/src/library/{index,watch}.rs`
- Modify: `src-tauri/src/library/commands.rs`, `lib.rs`

**Interfaces:**
- Produces:
  - `NameIndex` (managed state), with `start_build(root)` (background thread, no link following, skips dotfiles), `search(query, limit) -> SearchResult { entries: Vec<Entry>, ready: bool }` (case-insensitive substring on the name), and `apply(paths)`.
  - `LibraryWatcher`: a recursive watcher on the root, debounced 200 ms, which emits `"zukai://library-changed" { dirs: Vec<String> }` (the parent folders whose listing changed) and updates the index.
  - Commands: `library_search(query) -> SearchResult` and `library_watch()`, which (re)starts the watcher and the index for the current root.

- [ ] **Step 1: Write the failing tests:**
  - `index_build_runs_in_background_and_search_reports_partial`: build over a tree of 20,000 files. The `start_build` call returns in under 50 ms. An early `search` returns `ready: false` and does not block. After completion, `ready: true` and the matches are found.
  - `search_is_case_insensitive_and_limited`.
  - `watch_reports_parent_dirs_of_changes`: create, rename and delete each report the parent folder. Bound the wait to 3 s, and drain events before acting, as the Files-slice watch tests do.
  - `index_tracks_watcher_changes`.
- [ ] **Step 2: Run** `cargo test library::index library::watch`. Expected: FAIL. Then implement and run again. Expected: PASS.
- [ ] **Step 3: Commit** with `git commit -m "feat(library): background name index, recursive watch, search"`.

### Task 5: Library tree model and naming (pure TS)

**Files:**
- Create: `src/library/api.ts`, `src/library/tree.ts` (+test), `src/library/names.ts` (+test)

**Interfaces:**
- Produces:
  ```ts
  export interface Entry { name: string; path: string; isDir: boolean; link: "inside" | "outside" | null }
  export interface TreeState { root: string | null; children: Record<string, Entry[] | "loading">; expanded: Set<string>; selected: string | null }
  export function setChildren(s: TreeState, dir: string, entries: Entry[]): TreeState;
  export function toggle(s: TreeState, dir: string): TreeState;
  export function visibleRows(s: TreeState): { entry: Entry; depth: number }[];   // pre-order of expanded dirs
  export function invalidate(s: TreeState, dirs: string[]): { state: TreeState; reload: string[] }; // dirs currently loaded/expanded
  export function rewritePrefix(s: TreeState, from: string, to: string): TreeState;  // after a folder move/rename
  export function filterRows(results: Entry[], root: string): { entry: Entry; depth: number }[];  // search results with ancestor rows
  // names.ts
  export function sanitizeFileName(title: string): string;   // strips <>:"/\|?* and control chars, trims dots/spaces, collapses whitespace; "" → "Untitled"
  export function extFor(tab: TabState): string;            // canvas→.excalidraw, markdown→.md, plaintext→.txt, json→.json, sql→.sql, python→.py, yaml→.yaml, javascript→.js, typescript→.ts, html→.html, xml→.xml, css→.css, shell→.sh
  export function suggestedFileName(tab: TabState): string; // sanitizeFileName(title) + extFor(tab)
  ```
  `api.ts` wraps every Task 3 and Task 4 command, plus `onLibraryChanged(cb)`.

- [ ] **Step 1: Write the failing tests:**
  - `visibleRowsPreOrderOnlyExpanded`
  - `invalidateReturnsOnlyLoadedDirs`
  - `rewritePrefixUpdatesExpandedAndChildren`
  - `filterRowsIncludesAncestors`
  - `sanitizeStripsIllegalAndEmptyBecomesUntitled` (`"a/b: c?"` → `"a b c"`, `"  ...  "` → `"Untitled"`)
  - `extForEachLanguageAndCanvas`
- [ ] **Step 2: Run** `pnpm test src/library`. Expected: FAIL. Then implement and run again. Expected: PASS.
- [ ] **Step 3: Commit** with `git commit -m "feat(library): tree model and file naming"`.

### Task 6: Sidebar UI

**Files:**
- Create: `src/ui/Sidebar.tsx`, `src/ui/LibraryTree.tsx`, `src/ui/Inbox.tsx`, `src/ui/icons.tsx`, plus tests
- Modify: `src/App.tsx` (layout: sidebar left of the tab bar and editor), `src/styles/app.css` (`--z-side`, `--z-row-hover`, `--z-row-sel`, light and dark), `src/app/shortcuts.ts` (Mod+B → `toggleSidebar`, Mod+Shift+E → `focusSidebar`, Mod+Shift+N → `newCanvas`)

**Interfaces:**
- Consumes: Task 5's `TreeState` and helpers, and Task 7's `useLibrary` API, passed as props so tests can use fakes.
- Produces:
  - `Sidebar` props: `{ open; width; onWidth(w); root: string | null; available: boolean; tree: TreeState; rows; searching: boolean; search: { query; results; ready }; onSearch(q); inbox: { id; title; kind }[]; activePath: string | null; activeId; onOpen(entry); onToggle(dir); onCreate(parent, what: "folder"|"note"|"text"|"canvas"); onRename(path, name): Promise<string | null>; onMove(path, destDir); onTrash(path, itemCount?); onReveal(path); onCopyPath(path); onChooseRoot(); onRecreateRoot(); onInboxActivate(id); onInboxMove(id, destDir | null) }`
  - `null` for `onInboxMove` means Move to Library… through the save dialog.
- Behaviour:
  - Layout A: search, a LIBRARY header with `+`, the tree, then an INBOX section.
  - Root unavailable: a message plus Choose Library folder… / Create it again.
  - Keyboard: Up/Down, Left/Right, Enter, F2, Delete, Esc (back to the editor).
  - Context menus from 5.3, using the existing `Menu`.
  - Inline rename (the extension shown fixed, errors inline).
  - Pointer-event drag to move (the same approach as the TabBar, with a threshold and Esc to cancel).
  - Dropping an external file onto a folder row: handled by Rust drop events with a target-folder hint (Task 7).
  - Deleting a non-empty folder asks inline: `Move "X" and its N items to the Trash?`.
  - A width handle (180–480 px).
  - The active File's row is highlighted.

- [ ] **Step 1: Write the failing tests:**
  - `rendersTreeWithIconsAndInbox`
  - `searchShowsSearchingUntilReady`
  - `keyboardNavigationAndF2Rename`
  - `renameKeepsExtensionShowsInlineError`
  - `deleteNonEmptyFolderAsksInline`
  - `dragRowOntoFolderCallsOnMove`
  - `rootUnavailableShowsChooseAndRecreate`
  - `contextMenuNewItems`
  - `widthHandleClamps`
  - App-level: `modBTogglesSidebarAndHiddenLayoutUnchanged` (with the sidebar closed, the DOM has no sidebar node)
- [ ] **Step 2: Run** `pnpm test src/ui`. Expected: FAIL. Then implement and run again. Expected: PASS.
- [ ] **Step 3: Commit** with `git commit -m "feat(ui): Library sidebar with tree, search and Inbox"`.

### Task 7: `useLibrary`: wiring operations, Tabs and Inbox

**Files:**
- Create: `src/app/useLibrary.ts` (+test)
- Modify: `src/app/useWorkspace.ts` (compose; expose the API), `src/app/files/*` (opening library paths; `rewriteTabPaths`), `src-tauri/src/files/open_paths.rs` + `lib.rs` (a drop over a sidebar folder → `library_copy_into` instead of opening; the frontend sends the hovered folder via `library_set_drop_target(dir | null)`)

**Interfaces:**
- Produces on the Workspace:
  - `library: { root; available; tree; rows; search; inbox; activePath }`
  - plus the handler functions Task 6's props need, and `toggleSidebar()`, `focusSidebar()`, `newCanvas()`.
  - `sidebar` state is persisted in the Session (Task 2).
- Rules:
  - Opening a Library entry uses `openPaths([path])` (already granted through the root). The Tab gets `kind = kindOf(path)`.
  - New note, text file or canvas: create the file, open it, then start an inline rename.
  - **Rename or move of an entry that contains open Files** (the entry itself or descendants):
    1. Flush every affected Tab through the Saver.
    2. If any flush rejects, refuse the operation with a notice.
    3. Otherwise call Rust, then `rewriteTabPaths(fromPrefix, toPrefix)` for open Tabs, closed entries and the tree, and re-watch.
  - **Windows:** if a folder rename or move fails because a watcher handle is open, drop the per-file and Library watchers for that subtree, retry once, then re-watch (spec 5.8, item 5). Rust test: `rename_retries_after_dropping_watchers` (`cfg(windows)`).
  - **Trash:** open Files under the trashed path become Missing through the normal watcher path. No special code beyond the refresh.
  - **Inbox:**
    - Move to Library… runs the native save dialog, starting in the root, with `suggestedFileName(tab)`. This is the existing Save As path.
    - Dragging an Inbox item onto a folder saves to `unique_name(folder, sanitized title, extFor(tab))` with no dialog.
  - **Choose Library folder…** calls `library_choose`, then reloads the tree and restarts the watcher and index.
  - **Library changed:** `invalidate`, then reload the dirs it returns.

- [ ] **Step 1: Write the failing tests** (`renderHook`, mocked api):
  - `openEntryOpensTabWithKind`
  - `createNoteOpensAndStartsRename`
  - `moveFolderWithDirtyOpenFileFlushesFirst`
  - `moveRefusedWhenFlushFails` (nothing moved, a notice shown)
  - `renameFolderRewritesOpenAndClosedTabPaths`
  - `inboxDragSavesWithSuggestedName`
  - `moveToLibraryUsesSaveDialogInRoot`
  - `libraryChangedReloadsOnlyLoadedDirs`
  - `chooseRootReloadsTree`
  - `trashRefusedShowsNotice`
- [ ] **Step 2: Run** `pnpm test src/app`. Expected: FAIL. Then implement and run again. Expected: PASS. Run the Rust checks too.
- [ ] **Step 3: Verify manually** with `pnpm app`. Expected:
  1. The sidebar appears with Mod+B and the root is created.
  2. A new folder and note can be created.
  3. Drag a file into a folder.
  4. Rename a folder that holds an open note: its Tab follows.
  5. Delete to the Recycle Bin.
  6. Drop a PNG from Explorer onto a folder: it's copied.
- [ ] **Step 4: Commit** with `git commit -m "feat(library): wire sidebar operations, tab path rewrites and Inbox moves"`.

### Task 8: Canvas (Excalidraw)

**Files:**
- Create: `src/canvas/CanvasHost.tsx` (+test), `src/canvas/scene.ts` (+test)
- Modify: `package.json` (`@excalidraw/excalidraw`, exact version), `src/App.tsx` (render by Kind), `src/app/files/*` (canvas replace and reload use a scene replace), `src/ui/StatusBar.tsx` (Canvas shows the Kind label only), `vite.config.ts` (bundle Excalidraw assets locally)

**Interfaces:**
- Produces:
  ```ts
  export function parseScene(text: string): { ok: true; scene: { elements; appState; files } } | { ok: false };
  export function sceneSignature(elements, files): string;  // ids+versions of non-deleted elements + file ids; equal ⇒ no save
  ```
- `CanvasHost` props: `{ tabs; activeId; loadContent(id); onChange(id, text); onTabPatch(id, patch); replaceRequests; isReadOnly(id); theme: "light" | "dark" }`.
  - Lazily `import("@excalidraw/excalidraw")` on the first canvas Tab.
  - Serialise with `serializeAsJSON(elements, appState, files, "local")`.
  - Call `onChange` only when `sceneSignature` changes.
  - Apply replace requests with `updateScene` plus `history.clear`, as one step.
  - Turn off `isCollaborating` and the live-collaboration UI. Remove links to the online library and to Excalidraw+.
  - Map `theme` live.
  - Remember the viewport (`scrollX`, `scrollY`, `zoom`) in the Tab via `onTabPatch` (debounced, not saved to the file).
  - If `parseScene` fails, open the Tab read-only with the bar "This file isn't a valid Excalidraw drawing, so it's open read-only to protect it."
  - App shortcuts win: a `keydown` capture handler hands `matchShortcut` hits to the app before Excalidraw sees them.

- [ ] **Step 1: Write the failing tests:**
  - `parseSceneAcceptsValidRejectsInvalid`
  - `sceneSignatureIgnoresViewportAndSelection`
  - `viewportChangesDoNotSave` (call `onChange` with only appState scroll or zoom changes → no `onChange` to the Saver)
  - `elementChangeSavesSerializedJson`
  - `invalidCanvasOpensReadOnlyWithBar`
  - `excalidrawNotImportedForTextOnlySession` (spy on the dynamic import)
  - `replaceRequestUpdatesSceneOnce`
  - `modShiftEGoesToAppNotExcalidraw`
- [ ] **Step 2: Run** `pnpm test src/canvas`. Expected: FAIL. Then implement and run again. Expected: PASS. Mock Excalidraw in jsdom where needed.
- [ ] **Step 3: Verify manually** with `pnpm app`. Expected:
  1. Mod+Shift+N opens a canvas and drawing autosaves.
  2. Quit and relaunch: the drawing is restored.
  3. Open a `.excalidraw` file from the Library.
  4. Edit it in excalidraw.com and save it over: the reload happens.
  5. Switch to dark mode: the canvas follows.
  6. Startup with only text Tabs shows no Excalidraw network or chunk load.
- [ ] **Step 4: Commit** with `git commit -m "feat(canvas): Excalidraw canvases for scratchpads and .excalidraw files"`.

### Task 9: Image viewer and "Open with default app"

**Files:**
- Create: `src/image/ImageHost.tsx` (+test)
- Modify: `src-tauri/src/files/commands.rs` (`file_read_bytes(path) -> tauri::ipc::Response` raw bytes, granted and capped at `MAX_OPEN_BYTES`; `open_default(path)` using the opener, refusing `EXEC_EXTS` and paths outside the Library and the granted files), `src/files/api.ts`, `src/App.tsx`, `src/ui/StatusBar.tsx`, `src/ui/FileBar.tsx` (the readonly bar gains **Open with default app** when not blocked)

**Interfaces:**
- `ImageHost` props: `{ tab; readBytes(path): Promise<ArrayBuffer>; reloadSeq: number }`.
  - Creates a blob URL with the right MIME type and revokes it on change or unmount.
  - Fits by default.
  - Mod+= / Mod+- / Mod+0, Mod+wheel zoom toward the cursor, drag to pan.
  - Checkered background.
  - Reports `{ width, height, format, bytes }` to the status bar.
- Rust: `open_default` returns `{ kind: "refused_exec" }` for blocked extensions. It is never called by single-clicking a row.

- [ ] **Step 1: Write the failing tests:**
  - `imageFitsAndZooms`
  - `svgRenderedAsImgNeverInline` (no `<svg>` element in the DOM)
  - `blobUrlRevokedOnUnmount`
  - `reloadOnSeqChange`
  - Rust `open_default_refuses_exec_extensions`
  - Rust `read_bytes_requires_grant_and_cap`
  - `readonlyBarShowsOpenWithDefaultApp` (hidden for exec extensions)
- [ ] **Step 2: Run** the tests. Expected: FAIL. Then implement and run again. Expected: PASS.
- [ ] **Step 3: Commit** with `git commit -m "feat: image viewer and guarded open-with-default-app"`.

### Task 10: Docs, end-to-end check and CI

**Files:**
- Modify: `CONTEXT.md`, `docs/adr/0010-v1-milestone-order.md`, and only what the checks expose

- [ ] **Step 1: Update `CONTEXT.md`.**
  - Add **Library**, **Library folder**, **Sidebar**, **Inbox**, and the **Image** and **Canvas** Kind details.
  - Replace "Folders can't be opened… no project concept" and "There is no separate notes library" with the Library rules and a link to ADR 0011.
- [ ] **Step 2: Update ADR 0010.** Add a dated note: "Canvas (M3) is delivered with the Library before M2 (ADR 0011)."
- [ ] **Step 3: Run the full suite:** `pnpm lint` (0 warnings), `pnpm typecheck`, `pnpm test`, `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test`. Expected: all clean.
- [ ] **Step 4: Run the scripted checks** on a release build. Back up `%APPDATA%\Zukai\` and the Documents/Zukai folder first, and restore both afterwards. Expected:
  1. The first launch creates the root.
  2. `library.json` exists and `session.json` contains no root.
  3. Files added in Explorer appear (tree reload evidence in a test hook or log).
  4. A seeded Session v2 migrates to v3 with Kinds.
  5. A text-only session doesn't load the Excalidraw chunk (check the dev-tools network log or a bundle-chunk log).
- [ ] **Step 5: Push the branch** and confirm `CI` is green on all three OSes. **Commit** with `git commit -m "docs: library glossary and milestone note"`.
