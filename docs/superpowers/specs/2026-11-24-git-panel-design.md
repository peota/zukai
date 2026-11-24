# Git panel: a sidebar view for changes, branches and sync

Status: Draft 2026-11-24
Builds on: `docs/superpowers/specs/2026-11-24-library-git-sync-design.md` (called **the sync spec** below), on branch `feat/git-sync`, which is not merged yet.

## 1. Intent

The sync spec put git into the Library tree: a 22px row under each folder heading with Pull, Commit and Push. The owner now wants git in **one place of its own**, a view that is responsible only for git. In it you can see what changed, read a diff, pull, commit, push, switch branches and create new ones. The Library tree goes back to being just files.

Who it's for doesn't change: **one person keeping their own notebook in step across several machines**. Branches are occasional side work, such as trying a reorganization or keeping a draft apart. There is no team workflow, no pull requests, no review.

## 2. Goals, non-goals, anti-goals

**Goals**
- A **Git view** in the sidebar, swapped with the Library by a Files | Git switch.
- See **what changed** in a folder, and click a file to see its **diff** in a read-only tab.
- **Pull, commit and push** from the view, with the same rules and error copy as the sync spec.
- **Switch branches** (local, plus remote branches not yet checked out) and **create a branch** from where you are.
- Everything set up in the sync spec carries over: the Settings switch, set up sync, add folder from git, refusals, process hygiene, status freshness.

**Non-goals**
- Delete, rename, merge or rebase branches; stash; discard or revert a file; stage single files or hunks; history or log; blame; editing in the diff tab; fetch on its own button.
- Team features: pull requests, links to the forge, multiple remotes.

**Anti-goals** (failure even if it technically works)
- **Losing work.** No Zukai action may overwrite an uncommitted change or an unsaved edit. A branch switch that would do that is refused, not attempted.
- **An IDE in the sidebar.** The view is calm and short; the editor area stays the largest thing on screen (DESIGN.md).
- **Git running when the switch is off.** Same as the sync spec §4.0.

## 3. Approaches (decided 2026-11-24)

**Where the panel lives**
- **A. A view that swaps with the Library in the sidebar** (chosen). No new column, which DESIGN.md forbids ("no extra sidebars"); a familiar pattern from VS Code's Source Control. Cost: you can't see the file tree and git at once, which matters little because clicking a change opens its diff in the editor area.
- B. A Git tab in the editor area. The most room, but heavy for a quick commit.
- C. A docked right panel. Breaks the "no extra sidebars" rule and squeezes the note.

**Where the work happens**
- **On `feat/git-sync`, before merge** (chosen). The Git view replaces `GitRow` and `SetupSyncCard`; the Rust layer, `useGitSync`, error copy and `CloneDialog` carry over. Merging first would ship the sidebar row to main only to remove it.

**How the diff gets its "before" text**
- **Rust returns the file's committed content (`HEAD:path`)**; the tab shows it against the file on disk with CodeMirror's unified merge view (`@codemirror/merge`, new dependency) (chosen). Reuses the editor's highlighting, themes and fonts.
- Rust returns `git diff` patch text and the frontend parses it. Fewer bytes, but a hand-written parser and renderer with no highlighting.

## 4. Behaviour

### 4.1 The Files | Git switch

- A compact segmented control (track 7px, thumbs 5px, per DESIGN.md) at the **top of the sidebar**, above the search field: **Files** and **Git**, each with a 16px Lucide icon (`folder` / `git-branch`) and label.
- **Files** shows the sidebar as it is today (search, Pinned, Library, Scratchpads), minus all git rows. **Git** replaces the whole area below the switch with the Git view.
- The 5px **amber dot** (`--z-warn`, "Uncommitted changes") moves here: it sits on the Git segment when **any** library folder that is a repo has uncommitted changes.
- The chosen view is remembered across restarts (stored with the session, next to the sidebar width).
- **Shortcut:** `Ctrl+Shift+G` (`Cmd+Shift+G` on macOS) toggles to the Git view, or back to Files when Git is showing. Listed in the shortcut table.
- **With Git sync off** (Settings), the switch is not rendered at all; the sidebar is exactly as before this feature. If the Git view was showing when the setting is turned off, the sidebar returns to Files.

### 4.2 Branch chip in the status bar

- When the **active tab's file** is inside a library folder that is a repo, the status bar shows a status chip with the `git-branch` icon and the branch name (short hash in detached HEAD), plus "rebasing" or "merging" when one is in progress.
- Clicking it opens the Git view with that folder selected. Hidden when the active tab isn't in a repo, and when Git sync is off.

### 4.3 The Git view, top to bottom

```
┌ [Files | Git•] ───────────────┐
│ Library ▾                 ⋯   │  folder picker; ⋯ menu
│ ⑂ main ▾        ↓1 ↑2  ⤓  ⤒  │  branch button, counts, Pull, Push
│───────────────────────────────│
│ ┌ Sync 2026-11-24 ──────────┐ │  message field (placeholder = default)
│ └───────────────────────────┘ │
│ [ Commit & push ]             │
│ 2 unsaved files won't be      │  only when relevant
│ included · Save all           │
│ CHANGES  3                    │
│  M standup.md                 │
│  A rust.md        ideas       │
│  D old.txt                    │
└───────────────────────────────┘
```

**Folder picker.** A button showing the selected library folder's name (the Library root or an added folder), opening a menu listing all of them. Each entry carries the amber dot when it has uncommitted changes, or "not synced" in faint text when it isn't a repo. The default selection is the folder of the active tab's file, else the Library root; the last selection is remembered for the session. With only one library folder, the picker is plain text, not a button.

**⋯ menu.** **Add folder from git…** (opens the existing `CloneDialog`) and **Refresh**.

**Branch row.**
- **Branch button:** `git-branch` icon + branch name (or short hash in detached HEAD) + chevron. Opens the branch menu (§4.5).
- **Counts:** `↓n` behind and `↑n` ahead of the upstream, drawn with Lucide arrows, shown only when non-zero; nothing when there's no upstream.
- **Pull** and **Push**: 24px icon buttons (`arrow-down-to-line`, `arrow-up-from-line`) with tooltips. Enabled/disabled rules, tooltips, one-op-at-a-time, spin and check feedback are exactly the sync spec §4.4 and §4.6.
- **Rebase or merge in progress:** "rebasing" or "merging" next to the branch; Pull, Push, Commit, branch switch and create are all disabled with "Finish the rebase in a terminal first" (sync spec §4.4). The changes list still shows, with conflicted files marked.

**Commit box.**
- A message field, **multi-line** (grows to 4 lines, then scrolls), empty, with the placeholder `Sync YYYY-MM-DD` (local date). **Committing with an empty field uses that default.** `Ctrl+Enter` / `Cmd+Enter` commits.
- The button reads **Commit & push** when the folder has `origin`, **Commit** when it has no remote. Disabled when there's nothing to commit; then, if commits are waiting to be pushed, Push in the branch row handles them.
- The message is cleared after a successful commit, and kept if the commit fails.
- What it runs, the "Committed. Push failed: …" case, and the unsaved-files note with **Save all** are unchanged from the sync spec §4.5.

**Changes list.**
- A section heading **CHANGES** with the count, in the Label style.
- One 30px row per changed file, sorted by path: a status letter, the file name in text ink, and its parent folder (relative to the library folder) in faint ink, truncated from the left.
- Statuses, compared between the last commit and the files on disk (there's no staging; commit takes everything): **M** modified, **A** added (including untracked, non-ignored files, each file listed individually, not as a folder), **D** deleted, **R** renamed (shows `old → new` in the tooltip), **U** conflicted. The letter sits in a fixed-width column in muted ink; only **U** takes the danger color.
- **Click** (or Enter) opens the file's diff tab (§4.6). The row's context menu has **Open file** (hidden for deleted files) and **Copy path**.
- **Empty:** "No changes" in faint text, with "Last synced …" only if that's cheap to know; otherwise just "No changes".
- **Large lists:** the first 500 rows show, then a faint row "and N more files". No virtualization needed.

**Errors.** The inline error box (`GitErrorBox`, same copy as the sync spec §4.7) shows under the branch row, for the selected folder.

### 4.4 Other states of the view

- **Git not found:** the view shows one calm paragraph, "Install git to sync folders.", and nothing else.
- **Selected folder isn't a repo:** an empty state: a short line "This folder isn't synced yet." and the **Set up sync** form inline (Remote URL field, hint, the "Everything in this folder will be committed and pushed." note, **Set up** button), exactly the behaviour of the sync spec §4.1. **Set up sync…** is no longer in the Library heading menus.
- **Selected folder is inside a bigger repo:** "This folder is inside the git repo at <path>." and nothing else.
- **Before the first status answer:** the header with a quiet loading state; no spinner flashes under ~300ms.

### 4.5 The branch menu

A float menu (10px radius, 6px rows) anchored to the branch button.

```
┌───────────────────────────────┐
│ 🔍 Find or create a branch    │
│ ＋ New branch…                │
│ LOCAL                         │
│ ✓ main                        │
│   reorg-2026                  │
│ ON REMOTE                     │
│   origin/laptop-draft         │
└───────────────────────────────┘
```

- **Filter field** at the top, shown when there are more than 8 branches in total.
- **New branch…** turns the menu's top into an inline name field. Enter creates the branch from the current commit and switches to it (`git switch -c <name>`). The name is checked as you type (git's own branch-name rules); an invalid name shows "Not a valid branch name" and Enter does nothing; an existing name shows "That branch already exists". **Creating a branch is allowed with uncommitted changes and unsaved tabs**, because it doesn't touch any file: your changes simply come along to the new branch. It has no upstream until the first Push, which sets it (sync spec §4.6).
- **LOCAL:** local branches, current first with a drawn check (Lucide `check`), then alphabetical.
- **ON REMOTE:** branches on `origin` with no local branch of the same name, as of the last Pull (no network call when the menu opens). Choosing one creates a local branch of the same name tracking it and switches to it.
- **Switching** (`git switch <name>`) is **refused** with a plain message in the menu, and nothing runs, when:
  - the folder has uncommitted changes: "You have uncommitted changes. Commit first, then switch.";
  - any open tab for a file in this folder has unsaved edits: "Save or close N unsaved files first." with a **Save all** link;
  - a rebase or merge is in progress (all items disabled).
- **After a switch** (or a create), status and changes refresh. Open tabs whose files changed on disk reload, and tabs whose files no longer exist are handled, through the **existing** disk-change and gone-file handling; there is no new code path for that.
- **Detached HEAD:** the button shows the short hash; the menu lists branches as usual, none checked.

### 4.6 The diff tab

- Opened by clicking a change. One diff tab per file: clicking the same change again focuses the existing tab.
- A new tab kind, **read-only**. Title: the file name, with the tab's subtitle or tooltip "Changes since last commit". Icon: Lucide `git-compare`.
- **Content:** the committed version (`HEAD:path`, or `HEAD:old_path` for a rename) against the file on disk, in CodeMirror's **unified** merge view: deleted lines shown in place above the new lines, changed words highlighted, unchanged stretches collapsed with "N unchanged lines" that expand on click. Syntax highlighting, theme and fonts are those the text editor uses for that file type.
  - **Added:** everything is an insertion. **Deleted:** everything is a deletion.
  - **Line endings:** a CRLF ↔ LF difference alone isn't shown as a changed line.
- **Live:** the diff updates when the file changes on disk or after a commit (if the file is then unchanged, the tab shows "No changes since the last commit.").
- **Not shown as text:** binary files (a NUL byte in the first 8 KB, as git decides; images are binary, `.excalidraw` canvases are JSON text and do diff), files that aren't valid UTF-8, and files over 1 MB on either side. The tab shows one line: "Binary file changed", or "Too large to show (over 1 MB)", plus an **Open file** button.
- **File bar:** an **Open file** button (hidden for deleted files) opens the real file in a normal tab.
- **Not restored** after restart (the session drops diff tabs). Closing the tab never prompts.
- Diff tabs work in Split like any other tab.

### 4.7 Keeping it fresh

- Status, the changes list and the branch list refresh on the triggers in the sync spec §4.8 (shown, after every Zukai git op, window focus, folder watcher debounced ~1s). The changes list and branches are read **only for the folder selected in the Git view, and only while the Git view is showing**; the amber dot keeps using the cheap status call for every folder.
- No polling.

### 4.8 What's removed

- The git row under folder headings (`GitRow`), the inline commit card, `SetupSyncCard`, the root git footer in `Sidebar`, and the `underHeading` plumbing in `LibraryTree` that only served them.
- **Set up sync…** from the Library heading menus (it lives in the Git view's empty state).
- **Add folder from git…** stays next to **Add folder…** in the Library heading ⋯ menu and the empty-space menu, and is also in the Git view's ⋯ menu.

## 5. How it's built (decided)

- **Rust, new commands** in `src-tauri/src/git/`, all behind the existing gate (setting on, folder is exactly the Library root or an added root), using the existing `run` with its env, timeouts and no-window rules:
  - `git_changes(folder) -> Vec<Change>` where `Change { path, old_path?, status: "modified"|"added"|"deleted"|"renamed"|"conflicted" }`, paths relative to the folder with `/` separators. From `git status --porcelain=v2 -z --untracked-files=all` (with `-c status.showUntrackedFiles=all` / `core.quotepath=false` as needed). Doesn't take the busy lock (like `git_status`).
  - `git_branches(folder) -> { current: Option<String>, local: Vec<Branch>, remote_only: Vec<String> }`, from `git for-each-ref` on `refs/heads` and `refs/remotes/origin` (excluding `origin/HEAD`). No lock.
  - `git_switch(folder, branch, from_remote: bool)`: takes the busy lock; Rust re-checks clean tree and no rebase/merge before running; `git switch <name>`, or `git switch --track origin/<name>` for a remote branch. Unsaved tabs are checked by the frontend, since Rust can't see them.
  - `git_create_branch(folder, name)`: takes the busy lock; refuses during rebase/merge; `git switch -c <name>`.
  - `git_head_file(folder, path) -> { kind: "text", text } | { kind: "binary" } | { kind: "tooLarge" } | { kind: "missing" }`: `git cat-file` on `HEAD:<path>`, size checked first (`cat-file -s`) against 1 MB. No lock.
- **Input safety:** branch names are checked with `git check-ref-format --branch` and refused if they start with `-`; remote branch names must exist in the `git_branches` result. File paths must be relative, contain no `..` segment or drive prefix, and are passed to git as `HEAD:<path>` only. The on-disk side of a diff is read through the existing file-read command and grants, not a new path.
- **Frontend:**
  - `src/ui/git/GitView.tsx` (header, commit box, changes list, empty states), `src/ui/git/BranchMenu.tsx`, `src/ui/git/ChangesList.tsx`; a `SidebarViewSwitch` in `Sidebar`.
  - `useGitSync` grows `changes(folder)`, `branches(folder)`, `switchBranch`, `createBranch`, and a "selected folder" the view reports so only it is read.
  - Diff tab: a new tab kind `"diff"` (with `path` and `folder`), rendered by a `DiffPane` built on `@codemirror/merge`'s `unifiedMergeView`, reusing the text editor's language and theme extensions. Session save skips diff tabs.
  - Branch chip added to `StatusBar`.
- **Tests:** Rust tests against temp repos with a local bare remote, as the sync spec's; component tests for the switch, view states, branch menu (filter, create validation, refusals), changes list, diff pane states (text, added, deleted, binary, too large, no changes).
- **Docs:** DESIGN.md gets short entries for the view switch, the Git view, the branch menu and the diff tab, replacing the git-row entry; CONTEXT.md gets **Git view** and **Diff tab** if it defines UI terms.

## 6. Left to the builder

- The view's exact spacing and type within DESIGN.md's tokens, the status-letter treatment, and the empty-state wording beyond what's quoted here; to be designed with Impeccable against the existing system, in Paper and Graphite at least.
- Whether the commit box sits above or below the changes list once seen at real height (above is the proposal).
- Whether "Last synced …" in the empty changes list is cheap enough to include.
- How `@codemirror/merge` is configured to ignore CR-only differences.
- Whether the folder picker is a native-feeling menu or a reuse of an existing menu component (prefer reuse).

## 7. Calls I made (check these)

- The switch sits at the **top** of the sidebar, above search, and Git replaces everything below it.
- The amber dot moves to the Git segment and means "some folder has uncommitted changes".
- `Ctrl/Cmd+Shift+G` toggles the view (no existing binding uses it).
- The status-bar branch chip follows the **active tab's** folder.
- The commit message field starts empty with the date as placeholder; an empty commit uses the default. Multi-line, `Ctrl/Cmd+Enter` to commit.
- Creating a branch is allowed with uncommitted changes and unsaved edits (no file changes); switching is not.
- Remote branches come from the last Pull; opening the menu never touches the network.
- No delete, discard, stash, history, or per-file staging.
- Diff tabs aren't restored after restart, never prompt on close, and show binary/over-1MB files as a single line.
- **Add folder from git…** stays in the Library menus as well as the Git view's ⋯ menu; **Set up sync…** moves to the Git view only.
