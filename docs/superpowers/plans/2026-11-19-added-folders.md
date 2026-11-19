# Added folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user add folders outside the Library to the sidebar and work on them in place.

**Architecture:**
- **Grants.** Rust's `Grants` turns its single `RootSlot` into a list of slots. Slot 0 is the Library; the rest are added roots. Every slot keeps the existing offline, hint and recover machinery, and each path is checked against the root it lexically sits in.
- **Watching and search.** Each available added root gets its own `LibraryWatcher` and `NameIndex`. Search merges them.
- **The tree.** The front end keeps one `TreeState`. It gains the added roots, and each one renders as a heading row (depth 0) with its children below, so keyboard handling, drag and the context menu all carry over.

**Tech Stack:** Tauri 2, Rust (`dunce`, `dirs`, `notify`), React 19 + TypeScript, Vitest, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-11-19-added-folders-design.md`

## Global Constraints

**Security**
- Added folders come only from the OS folder dialog run by Rust (`tauri_plugin_dialog`). No command lets the webview pass a folder to add.
- `library.json` is written only by Rust. The new shape is `{ "root": "<abs>", "added": ["<abs>", ...] }`, and saving the root must keep `added`, and saving `added` must keep `root`.
- A link found under root R may only resolve inside R. A link from an added folder into the Library, or into another added folder, is refused like any escape.
- Moves never cross roots: Rust refuses them, and the UI copies instead (`library_copy_into`). Delete never becomes a permanent delete; with no trash it stays `TrashUnavailable`.

**Copy (exact strings)**
- Refusals when adding (`FileError::Io` messages):
  - candidate is the Library or inside it: `That folder is already in your Library.`
  - candidate contains the Library: `That folder contains your Library.`
  - candidate is an added folder or inside one: `That folder is already in the sidebar.`
  - candidate contains an added folder: `That folder contains a folder already in the sidebar.`
  - a drive or volume root, or the home folder itself: `That folder is too big to add. Pick a folder inside it.`
  - not a folder or unreadable: `That folder can't be read.`
- Re-point notice: `Removed {name} from the sidebar: it overlaps the new Library folder.`
- UI labels:
  - `Add folder…`
  - `Remove from sidebar`
  - `Locate…`
  - `Not found`
  - `New file`
  - `New folder`
  - the existing `revealLabel(platform)`
  - the drag hint `Copy`

**Ordering**
- Sidebar order: Pinned, Library, the added folders in the order added, Scratchpads.
- A new added folder goes last and starts expanded.
- At load, the Library root wins over any added folder, and earlier added entries win over later ones.

## Review Focus

1. **A link inside an added folder pointing into the Library**, or into another added folder, must show the link icon and refuse to open, rename into or write through it. *(Task 2 test `link_from_added_into_library_refused`.)*
2. **An added folder whose drive is unplugged mid-session.**
   - Its paths fail with `NotGranted` and are never turned into loose file grants.
   - When the drive returns they work again with no Locate. *(Task 2 test `added_root_offline_then_back`.)*
3. **The same folder spelled differently on Windows** (`D:\Work` vs `d:\work\`) is refused as already added. *(Task 1 test `same_folder_other_case_is_already_added`.)*
4. **Rename, move or trash inside an added folder on Windows while it's watched** must work: the watchers on every root are paused around the operation, not only the Library's. *(Task 3 test `release_pauses_every_root_watcher`.)*
5. **A cross-tree drag onto a folder that already has that name** copies as `name (2)`, and the source stays untouched. *(Task 4 test `cross_root_drop_copies`.)*

---

### Task 1: Overlap rules and `library.json` storage (Rust)

**Files:**
- Create: `src-tauri/src/library/added.rs` (pure overlap check)
- Modify: `src-tauri/src/library/mod.rs` (`pub mod added;`), `src-tauri/src/library/root.rs`

**Interfaces:**
- Produces:
  - `pub enum Refusal { InLibrary, ContainsLibrary, AlreadyAdded, ContainsAdded, TooBroad }`, with `impl Refusal { pub fn message(&self) -> &'static str }` returning the exact strings above
  - `pub fn refusal(candidate: &Path, library: Option<&Path>, added: &[PathBuf], home: Option<&Path>) -> Option<Refusal>`. All paths are canonical. Compare by `grants::key` component by component, so `/a/b2` isn't inside `/a/b`. `TooBroad` means `candidate.parent().is_none()` or `key(candidate) == key(home)`. Check order: TooBroad, InLibrary, ContainsLibrary, AlreadyAdded, ContainsAdded.
  - `pub fn clean_added(library: Option<&Path>, added: Vec<PathBuf>) -> Vec<PathBuf>`: keeps each entry that has no `refusal` against the library and the entries kept before it (the home folder isn't checked at load). It logs each dropped entry with `eprintln!`.
  - `root.rs`:
    - `pub fn load_added(data: &Path) -> Vec<PathBuf>`: absolute paths only, junk entries dropped one by one
    - `pub fn save_added(data: &Path, added: &[PathBuf]) -> io::Result<()>`
    - `save_root` now keeps the stored `added` array

- [ ] **Step 1: Write failing tests.** In `added.rs`:
  - `refuses_library_inside_and_containing`
  - `refuses_added_inside_equal_and_containing`
  - `same_folder_other_case_is_already_added` (`#[cfg(windows)]`: `C:\X\Work` vs `c:\x\work`)
  - `sibling_prefix_is_not_inside` (`/a/b2` vs `/a/b` → `None`)
  - `drive_root_and_home_are_too_broad`; a folder inside home → `None`
  - `clean_added_drops_overlaps_keeping_first`: `[lib/inner, x, x/y, x]` → `[x]`

  In `root.rs`:
  - `added_round_trips_and_keeps_root`: save root, save added, save root again; both survive
  - `junk_added_entries_dropped_one_by_one`: `{"root":"<abs>","added":["<abs>", 3, "relative", null]}` → one entry, root intact
- [ ] **Step 2: Run them and confirm they fail:** `cd src-tauri && cargo test library::added library::root`.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run the same command; it passes.** Then run `cargo test` for the whole crate (165+) and `cargo clippy -- -D warnings`.
- [ ] **Step 5: Commit.** `feat(added): overlap rules and library.json added list`

### Task 2: `Grants` with several roots (Rust, security-critical)

**Files:**
- Modify: `src-tauri/src/files/grants.rs`, `src-tauri/src/library/mod.rs` (its `tests` helpers)
- Test: in-file `mod tests` in `grants.rs`, and `src-tauri/src/library/mod.rs` tests

**Interfaces:**
- Consumes: `added::refusal` (Task 1).
- **The slots.**
  - `root: Mutex<RootSlot>` becomes `roots: Mutex<Vec<RootSlot>>`. Index 0 is always the Library slot; it may be empty.
  - `RootSlot` keeps `root`, `hint`, `stored` and `missed`.
  - `recover_root` becomes per slot (`fn recover(&self, i: usize) -> Option<PathBuf>`), with the same compare-and-set on that slot's hint and the same TTL.
- **Unchanged public API** (Library semantics): `root()`, `set_root`, `load_root`, `set_root_hint`, `forget_recover_miss`, `recover_probes`.
- **New public API:**
  - `pub fn load_added(&self, stored: &[PathBuf]) -> Vec<(PathBuf, bool)>`: replaces every added slot. Each is loaded like `load_root`; when that fails, it's kept as a hint only. Returns `(path, available)` in order, where the path is canonical if available and stored otherwise.
  - `pub fn add_root(&self, dir: &Path) -> Result<PathBuf, FileError>`:
    - canonicalizes the folder; `Io("That folder can't be read.")` on failure
    - runs `added::refusal` against the Library and the current added slots (their roots or hints), with `dirs::home_dir()`
    - a refusal returns `FileError::Io(io::Error::other(r.message()))`
    - on success, pushes the slot last and returns the canonical path
  - `pub fn remove_root(&self, path: &Path)`: drops the added slot whose root, hint or stored path matches by key. It never touches slot 0.
  - `pub fn added(&self) -> Vec<PathBuf>`: each added slot's root, or its hint if it has no root.
  - `pub fn root_of(&self, p: &Path) -> Option<PathBuf>`: the granted root (canonical) that `p` is lexically under, by key, via root, hint or stored. `None` when it's under no root or that root is offline.
- **Changed semantics:**
  - `in_library(p)` is true under any slot.
  - `locate`, `in_root`, `within_root` and `resolve_in_root` pick the slot that `p` lexically sits under, and require the canonical result to start with **that slot's** root.
  - `check`'s last fallback (`within_root(canon)`) uses the slot of the path as given.
  - `grant` for a path under an added slot goes through `locate` like a Library path.

- [ ] **Step 1: Write failing tests.** Use a helper `library_with_added() -> (TempDir, Grants, root, added, outside)` in `library/mod.rs` tests. Tests:
  - `in_root_accepts_inside_any_root`
  - `link_from_added_into_library_refused` (unix symlink + `#[cfg(windows)]` junction via the existing `junction` helper): `in_root(added/link/x)` is `NotGranted`, and `in_root(root/x)` is still OK
  - `link_inside_same_added_root_ok`
  - `add_root_refuses_overlaps_with_message`: the error text equals `Refusal::InLibrary.message()` and so on
  - `remove_root_drops_its_grants_but_not_the_library`
  - `added_root_offline_then_back`:
    1. rename the added folder away; `check(path under it)` is `NotGranted`, and `grant` keeps it as given (not canonicalized)
    2. rename it back and call `forget_recover_miss`; `check` is OK with no reload
  - `stored_file_grant_under_removed_root_still_works`: grant a file under the added root, `remove_root`, then `check` returns it (a plain file grant)
  - `load_added_reports_availability`
- [ ] **Step 2: Run them and confirm they fail:** `cargo test grants library::tests`.
- [ ] **Step 3: Implement.** Keep every existing grants test green unchanged. They pin the Library behaviour.
- [ ] **Step 4: Run** `cargo test` (all) and `cargo clippy -- -D warnings`. Expect PASS and no warnings.
- [ ] **Step 5: Commit.** `feat(added): grants for several roots`

### Task 3: Commands, watchers and search (Rust)

**Files:**
- Modify: `src-tauri/src/library/commands.rs`, `src-tauri/src/library/watch.rs` (if needed), `src-tauri/src/lib.rs`
- Test: `mod tests` in `commands.rs`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces (serde camelCase):
  - `pub struct AddedState { pub path: String, pub available: bool }`
  - `RootState` gains `pub added: Vec<AddedState>`
- **Plain functions over `&Grants`** (testable):
  - `root_state(g, data)`: also runs `root::load_added`, then `added::clean_added`, then `g.load_added`. If cleaning dropped any entry, save the cleaned list.
  - `add_folder(g, data, dir: &Path) -> Result<RootState, FileError>`: runs `g.add_root`, then `root::save_added(g.added())`, then `root_state`.
  - `locate_folder(g, data, old: &str, dir: &Path) -> Result<RootState, FileError>`:
    - replaces the entry `old` in place (same position)
    - the overlap check excludes `old` itself
    - on refusal the list is unchanged
  - `remove_folder(g, data, path: &str, open: &[String]) -> Result<RootState, FileError>`:
    - before removing, collect each `open` path lexically under it
    - after `g.remove_root`, run `g.grant(p)` on each, ignoring errors
    - save the list
  - `use_root(g, data, dir, open: &[String])`: after setting the root, removes every added folder that `added::refusal` now flags against the new Library (granting their open paths as `remove_folder` does). It returns the `RootState` plus `removed: Vec<String>`, the names of the removed folders, which the UI shows with the re-point notice.
    - Add `#[serde(skip_serializing_if = "Vec::is_empty")] pub removed: Vec<String>` to `RootState`.
- **The root used by path helpers.** `list`, `entry`, `reveal_target`, `resolve`, `reserve` and `copy_to` use `g.root_of(path)` wherever they used `g.root()`.
  - `entry` refuses an item equal to **any** granted root.
  - `move_to` refuses when `root_of(src) != root_of(dest)` with `FileError::NotGranted`.
  - `follow` accepts any `from`, but `to` must be `in_root`, as today.
- **Watchers and indexes.**
  - New managed state `AddedWatchers(Mutex<Vec<(PathBuf, LibraryWatcher, NameIndex)>>)`.
  - `library_watch` syncs it to the available added roots: it starts new ones, drops removed ones and keeps unchanged ones.
  - `with_watchers_released` pauses and restores every added watcher as well.
  - `library_resync` calls `rebuild_if_older` on every index, and returns true if any rebuilt.
  - `library_search` merges the Library index first, then each added one in order, capped at `SEARCH_LIMIT`. `ready` is true only when all of them are ready.
- **Commands:**
  - new: `library_add_folder(window)`, `library_locate_folder(path, window)`, `library_remove_folder(path, open_paths)`
  - changed: `library_choose(window, open_paths)`
  - Each dialog is cancellable, and a cancel returns the current `root_state`. Register them in `lib.rs`.

- [ ] **Step 1: Write failing tests:**
  - `root_state_lists_added_with_availability`
  - `root_state_drops_overlapping_entries_and_saves`
  - `add_folder_saves_and_refuses_overlap`
  - `locate_replaces_in_place`
  - `remove_folder_keeps_open_files_granted`
  - `use_root_over_added_removes_it_and_names_it`
  - `list_in_added_classifies_links_by_its_root`
  - `move_across_roots_refused`; `copy_to` across roots works with ` (2)` on a clash
  - `entry_refuses_an_added_root_itself`
  - `release_pauses_every_root_watcher` (an `AddedWatchers` unit test: after `pause_all`, every watcher reports not running, and `resume_all` restarts them)
  - `search_merges_library_then_added`
- [ ] **Step 2: Run them and confirm they fail:** `cargo test library::commands`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cargo test` (all) and `cargo clippy -- -D warnings`. Expect PASS.
- [ ] **Step 5: Commit.** `feat(added): commands, watchers and search for added folders`

### Task 4: Front-end model: API, tree and `useLibrary`

**Files:**
- Modify: `src/library/api.ts`, `src/library/tree.ts`, `src/app/useLibrary.ts`, plus their tests (`tree.test.ts`, `useLibrary.test.ts`)

**Interfaces:**
- Consumes: Task 3's commands and `RootState`.
- **`api.ts`:**
  - `interface AddedState { path: string; available: boolean }`
  - `RootState` gains `added: AddedState[]` and `removed?: string[]`
  - `libraryAddFolder(): Promise<RootState>`
  - `libraryLocateFolder(path: string): Promise<RootState>`
  - `libraryRemoveFolder(path: string, openPaths: string[]): Promise<RootState>`
  - `libraryChoose(openPaths: string[])`
- **`tree.ts`:**
  - `TreeState` gains `added: AddedState[]`.
  - `Row` gains `heading?: { available: boolean }`, set only on an added folder's own row: `{ entry: { name: baseName, path, isDir: true, link: null }, depth: 0 }`.
  - `visibleRows(s)` returns the Library rows, then, per added folder, its heading row followed by its children at depth+1 when it's expanded and available.
  - `filterRows(results, roots: string[])` (roots[0] is the Library) groups each result under the root it starts with. Added roots get their heading row first. Results under no root are dropped.
  - `export function rootOf(path: string, roots: string[]): string | null`: compared by path prefix with a separator, case-insensitive on Windows. Use the platform from the existing `detectPlatform`, or a `caseInsensitive` parameter.
  - `rewritePrefix` also rewrites `added[].path`.
- **`useLibrary`:**
  - It applies `added` from every `RootState`. A newly added path is put into `expanded`, and each available one is listed when shown.
  - It re-asks `libraryRoot()` on window focus (next to `libraryResync`), so a re-plugged drive comes back.
  - It exposes on `LibraryApi`:
    - `added: AddedState[]`
    - `addFolder()`
    - `locateFolder(path)`
    - `removeFolder(path)`
  - `locateFolder` calls `libraryFollow(old, new, held paths)`, then `rewriteTabPaths`, using the same path the existing rename follow uses.
  - `move(path, destDir)`: when `rootOf(path) !== rootOf(destDir)`, it calls `libraryCopyInto([path], destDir)` and reloads `destDir` instead of moving.
  - `dropDirAt` returns the folder under the pointer in any tree. An added heading row's path counts as a folder.
  - `chooseRoot` passes the open paths. When `removed` is non-empty, it calls `showNotice` with the re-point notice for each name.
  - Errors from add or locate show their message via `showNotice`.

- [ ] **Step 1: Write failing tests.**

  `tree.test.ts`:
  - `added_rows_follow_library_rows_with_headings`
  - `collapsed_or_missing_added_shows_heading_only`
  - `filterRows_groups_by_root`
  - `rootOf_respects_separators` (`/a/b2/x` isn't under `/a/b`)

  `useLibrary.test.ts` (mocked API, as the existing tests do):
  - `add_folder_appends_and_expands`
  - `cross_root_drop_copies` (`libraryCopyInto` called, `libraryMove` not)
  - `remove_passes_open_paths`
  - `locate_follows_open_tabs`
  - `choose_root_notices_removed_folders`
  - `focus_rechecks_root_state`
- [ ] **Step 2: Run them and confirm they fail:** `pnpm vitest run src/library src/app/useLibrary.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck` and `pnpm lint`. Expect everything to PASS.
- [ ] **Step 5: Commit.** `feat(added): added folders in the library model`

### Task 5: Sidebar UI and docs

**Files:**
- Modify: `src/ui/Sidebar.tsx`, `src/ui/LibraryTree.tsx`, `src/ui/useFolderDrag.ts`, `src/App.tsx` (wiring), `src/ui/Sidebar.test.tsx`, `CONTEXT.md`, `docs/adr/0011-library-sidebar.md`

**Interfaces:**
- Consumes: Task 4's `LibraryApi` (`added`, `addFolder`, `locateFolder`, `removeFolder`) and `Row.heading`.
- `SidebarProps` gains `added`, `onAddFolder()`, `onLocateFolder(path)` and `onRemoveFolder(path)`.
- **Heading row** (`Row.heading` set):
  - It renders like the Library section heading: a chevron, the name, then `parentOf(path)` in `text-faint` (truncated from the left), with `title` = the full path.
  - It has a ⋯ button with these items: `New file`, `New folder`, `revealLabel`, `Remove from sidebar`.
  - When missing, it's greyed out, shows `Not found`, and the ⋯ menu has `Locate…` and `Remove from sidebar`.
  - It can't be renamed, dragged or trashed. Its row is a drop target when available.
- **Menus.**
  - `Add folder…` goes into the Library heading's ⋯ menu.
  - It also goes into the context menu for empty sidebar space, as the last item.
- **Cross-tree drag.** While a drag's source root differs from the target's, the target row shows a small `Copy` badge. `rootOf` from Task 4 decides.

- [ ] **Step 1: Write failing tests** in `Sidebar.test.tsx`:
  - `added_heading_shows_name_parent_and_tooltip`
  - `heading_menu_items`
  - `missing_heading_offers_locate_and_remove`
  - `add_folder_in_library_menu_and_empty_space_menu`
  - `heading_cannot_be_renamed_or_trashed` (F2 and Delete on it do nothing)
  - `cross_tree_drag_shows_copy_hint`
- [ ] **Step 2: Run them and confirm they fail:** `pnpm vitest run src/ui/Sidebar.test.tsx`.
- [ ] **Step 3: Implement.** Then the docs:
  - `CONTEXT.md` gains an **Added folder** entry: what it is, the copy-not-move rule, Remove never touches the disk, and missing with Locate. Its _Avoid_ line: linked folder, workspace folder, mount. Update the **Library** entry's "one folder grant" sentence and the **Sidebar** order.
  - ADR 0011 gets a dated note (2026-11-19): the grant is now the Library plus folders the user added through the OS dialog, why, and that links never cross roots.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint` and `cargo test`. Expect everything to PASS. Then do a browser-harness check of the heading row and its menus, in light and dark.
- [ ] **Step 5: Commit.** `feat(added): added folders in the sidebar`
