# Zukai — Git sync for library folders

Date: 2026-11-24
Status: Approved 2026-11-24

Background reading: [`CONTEXT.md`](../../../CONTEXT.md) (**Library**, **Library folder**, **Sidebar**), [ADR 0011](../../adr/0011-library-sidebar.md), [added folders](2026-11-19-added-folders-design.md). Mockup of the git row: https://claude.ai/artifact/Wk9k1HorBXwQ8npVadfkqb

## 1. Intent

Zukai has no cloud and no accounts, and it won't get them. The owner still wants users to have their notes on more than one machine. Engineers already have git and a host for remotes (GitHub, GitLab, a server), so Zukai lets them sync a library folder through their own `git`:

- set up a folder for syncing from inside Zukai;
- bring that folder onto another machine by cloning it;
- **Pull**, **Commit** and **Push** from the sidebar.

It's a thin layer over the user's own `git`, not a git client.

## 2. Goals, non-goals, anti-goals

**Goals**
- A new user can go from "a folder of notes on machine A" to "the same notes on machine B" without opening a terminal, given an empty repo on their git host and working git credentials.
- When a library folder (the Library or an added folder) is a git repo, the sidebar shows its branch, whether it has uncommitted changes, and Pull / Commit / Push.
- Day to day, syncing takes two actions: **Commit** on one machine (which also pushes), then **Pull** on the other.
- Failures say what went wrong and what to do, in plain words.

**Non-goals**
- Staging single files, diffs, history, branches (switching, creating), stash, tags.
- Creating the remote repo on GitHub or GitLab (no host APIs, no OAuth).
- Changing or removing a remote after setup.
- Git for scratchpads or for files opened from outside library folders.
- Resolving conflicts in Zukai.
- Automatic background sync (on a timer, on save).

**Anti-goals**
- **Zukai never loses or rewrites the user's work.** No `reset`, no `--force`, no `checkout --`, no deleting a `.git`, and nothing that discards changes. If git refuses, Zukai stops and explains.
- **Zukai never hangs on git.** A credential prompt or a slow remote must not freeze the UI or leave a hidden process waiting for input.
- **No new chrome.** No new sidebar panel or toolbar. The git row stays quiet and the editor stays the biggest thing on screen.
- **Zukai doesn't bundle git or store credentials.** It runs the user's `git`, and authentication is whatever that git already uses (SSH agent, credential manager).

## 3. Approaches (decided 2026-11-23)

1. **A git row under each library folder's heading. Chosen.** It's always visible, so the user doesn't need to hover to find it. It sits next to the folder it acts on, and it shows status at rest. The owner picked it as the most contextual option, with no new place to navigate to.
2. **A dedicated Git panel in the sidebar.** More room, but it pulls the user away from the Library and breaks "no extra sidebars". Rejected.
3. **Git actions only in the folder's ⋯ / right-click menu.** No new chrome, but there's no status at rest and it's easy to miss. Rejected.

Setup and clone were added on 2026-11-24 at the owner's request. Without them, a new user has to use a terminal twice before syncing works.

Backend: Rust runs the system `git` binary (`std::process::Command`) instead of linking libgit2. That means no new dependency, the user's own config, hooks and credential helpers apply, and the results match what the user sees in a terminal.

## 4. Behaviour

### 4.0 Turning it off (decided 2026-11-24)

- Settings get a **Git sync** switch, **on by default**, with the description "Show git status and Pull, Commit and Push for library folders."
- **When it's off, Zukai has no git features at all:**
  - no git rows;
  - no **Set up sync…** or **Add folder from git…** menu items (hidden, not disabled);
  - **no git process ever runs**, not even the search for git in §5 or a status check.

  Folders that are repos are left as they are on disk.
- Turning it off while an operation is running lets that operation finish, then hides everything. Turning it on finds git and reads status for every library folder, as at startup.
- Stored as `gitSync: boolean` in the existing settings (`src/model/settings.ts`, default `true`, a non-boolean parses to the default). Rust gets the value and its `git_*` commands refuse while it's off, so the switch holds even if the UI is wrong.

### 4.1 Set up sync (approved 2026-11-24)

- **Where:** **Set up sync…** in the ⋯ menu (and right-click menu) of the Library heading and of each added folder's heading.
- **When it's offered:** only when the folder is not in any git work tree.
  - If the folder is already the top of a repo, the git row shows instead and the item is hidden.
  - If the folder is *inside* a bigger repo, the item is disabled with the reason "This folder is inside the git repo at <path>."
- **The card:** an inline card under the heading, styled like the commit card. It has:
  - a "Remote URL" field, with placeholder `git@github.com:you/notes.git`;
  - a hint line: "Create an empty repo on GitHub, GitLab or your server, then paste its URL.";
  - the note "Everything in this folder will be committed and pushed.";
  - **Set up** and **Cancel** buttons.
- **What it runs**, in order, stopping at the first failure:
  1. `git init` with the initial branch named `main`.
  2. `git add -A`, then `git commit -m "Set up Zukai sync"`.
  3. `git remote add origin <url>`.
  4. `git push -u origin main`.
- **If the push fails** (bad URL, no access, the remote already has commits), Zukai keeps the local repo. It never deletes `.git`. The git row appears with the error under it.
  - In this state `origin` exists but there's no upstream yet, so **Push** stays enabled and runs `git push -u origin <branch>`. The user can fix their access and press Push.
  - If the remote already has commits: "That repo isn't empty. To use its notes here, use **Add folder from git…** instead."
- **Empty folder:** the first commit is skipped, and the push happens after the user's first Commit.

### 4.2 Add folder from git, i.e. clone (approved 2026-11-24)

- **Where:** **Add folder from git…** right after **Add folder…**, in the Library heading's ⋯ menu and in the right-click menu on empty sidebar space.
- **The dialog:** a small dialog, since there's no heading to attach a card to yet. It has:
  - a "Repo URL" field;
  - a **Choose location…** button that opens the OS folder picker, run by Rust as **Add folder…** does;
  - a read-only preview of the destination, `<chosen parent>/<repo name>`, with the repo name taken from the URL and editable;
  - a **Use as my Library** checkbox, off by default;
  - **Clone** and **Cancel** buttons.
- **Before cloning:** the destination must not exist, or must be an empty folder. It's checked against the same rules as **Add folder…** (not inside the Library or an added folder, not a drive root or the home folder). Refused destinations show the same messages as Add folder.
- **While cloning:** a placeholder row "Cloning <name>…" with a spinner sits where the new folder will appear. Clicking it offers **Cancel**, which kills git and removes only the folder git was creating. That folder is new and incomplete, so this doesn't break the anti-goal.
- **When it's done:** the folder becomes an added folder, last in the list and expanded. With **Use as my Library** checked, it becomes the Library instead, exactly as **Choose Library folder…** does.
- **Errors:** an empty repo clones fine. Bad URL, auth and network failures use the error copy in §4.7.

### 4.3 When the git row shows

- Under the heading of the Library and of each added folder, **only when that folder is the top level of a git work tree** (my call, see §7). Otherwise the heading looks as it does today.
- If git can't be found (§5), no rows show, and **Set up sync…** and **Add folder from git…** are disabled with "Install git to sync folders." This is not an error.

### 4.4 The git row (approved 2026-11-23, see mockup)

- A 22px row right below the folder heading, indented under the name.
- Left: the branch icon, then the branch name in faint text. In detached HEAD it shows the short commit hash.
- Then, when the work tree has uncommitted changes (including untracked, non-ignored files), an **amber dot** titled "Uncommitted changes". It's a status color, allowed under the One Accent Rule the way danger is. It's a new token (`--z-warn`), defined for every theme.
- Right: three 20px icon buttons, **Pull**, **Commit**, **Push**, using Lucide `arrow-down-to-line`, `git-commit-horizontal` and `arrow-up-from-line`, with tooltips.
- **No upstream:**
  - If `origin` exists, Push is enabled and sets the upstream (§4.1), and Pull is disabled.
  - With no remote at all, Pull and Push are disabled, with the tooltip "No remote set up for this folder". Commit only commits.
- **While a rebase or merge is in progress** (whether Zukai or the user's terminal started it):
  - the row shows "rebasing" or "merging" next to the branch;
  - **all three buttons are disabled**, with the tooltip "Finish the rebase in a terminal first";
  - the Rust commands refuse in that state too, so a stray click can't run `git add -A` over files with conflict markers.

### 4.5 Commit, then push (approved 2026-11-23)

- Clicking **Commit** opens a small inline card under the row, the same pattern as the folder-delete confirmation. Its one-line message field is pre-filled with `Sync YYYY-MM-DD` (local date) and selected.
  - **Enter** commits.
  - **Esc** or clicking away cancels.
  - An empty message can't be submitted.
- If no changes need committing, the card doesn't open. Commit goes straight to pushing any commits that haven't been pushed yet, or the tooltip says "Nothing to commit".
- Commit runs `git add -A` and `git commit -m <msg>` in the folder, then pushes if a remote exists. The amber dot clears after the commit succeeds.
- The Commit button spins through both steps and shows a check when done. If the commit succeeds but the push fails, the error says "Committed. Push failed: …" and the dot stays cleared.
- If any open tab for a file in this folder has unsaved edits, the card shows "N unsaved files won't be included" with a **Save all** link. Commit always takes what's on disk.

### 4.6 Pull and Push

- **Pull refuses when the folder has uncommitted changes** (decided 2026-11-24): "You have uncommitted changes. Commit first, then pull." It never touches working files, so nothing is set aside or stashed.
- On a clean folder, Pull runs `git pull --rebase`. Files changed on disk reload through the existing disk-change handling, with no new code path.
- **Push** runs `git push`, or `git push -u origin <branch>` when there's no upstream yet. If there's nothing to push, the tooltip says so and the button does nothing.
- **One operation at a time:** only one git operation runs per folder. While one runs, all three buttons in that row are disabled and the clicked one spins. Other folders' rows still work.
- Success shows a check for about a second.

### 4.7 Errors: explain and stop

- On failure, an inline message appears under the row (or in the clone dialog) in the same float style as the rename error. It has one plain sentence, git's first relevant line in mono, and a dismiss button. It stays until dismissed or until the next operation on that folder.
- Mapped cases:
  - **Push rejected** (the remote has newer commits): "The remote has newer changes. Pull first, then push."
  - **Pull conflict:** "Pull stopped: <n> files conflict. Finish it in a terminal (`git rebase --continue` or `--abort`)." Zukai never continues or aborts the rebase itself.
  - **Remote not found or access denied:** "Couldn't reach that repo. Check the URL and your git credentials."
  - **Network failure:** "Couldn't reach the remote. Check your connection."
  - **Timeout:** "Git took too long and was stopped."
  - **Anything else:** "Git failed." plus git's message.

### 4.8 Keeping status fresh

- Status (branch, dirty, remote, upstream, merge/rebase state) is read:
  - when the folder is shown;
  - after every Zukai git operation;
  - when the window regains focus;
  - when the existing folder watcher reports changes, debounced to about 1s.
- There's no polling.

## 5. How it's built (decided)

- **Rust module:** `src-tauri/src/git/` provides these Tauri commands:
  - `git_status(folder)`
  - `git_pull(folder)`
  - `git_commit_push(folder, message)`
  - `git_push(folder)`
  - `git_setup(folder, url)`
  - `git_clone(url, name, use_as_library)`, which returns once the parent picker and the clone have finished
  - `git_cancel(op_id)`

  The `folder` argument must be the Library root or an added folder root, checked against `Grants`, so the webview can't run git anywhere else. The clone destination's parent comes only from the Rust-run OS picker, never from the webview.
- **URL safety:** refuse URLs that start with `-`, and refuse `ext::` and `file://` transports. Always pass the URL after `--`, and set `GIT_PROTOCOL_FROM_USER=0` with `protocol.ext.allow=never`.
- **Status:** one `git status --porcelain=v2 --branch` call gives branch, upstream, ahead/behind and dirty. Add `git remote` for whether `origin` exists, and a check for `MERGE_HEAD` / `rebase-merge` / `rebase-apply` in the git dir. The top-level check uses `git rev-parse --show-toplevel`, compared after `dunce::canonicalize`.
- **Process hygiene:**
  - `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`, so git never waits on stdin;
  - stdin set to null;
  - `CREATE_NO_WINDOW` on Windows;
  - a timeout that kills the process: 10s for status, 60s for pull and push, 5 minutes for clone and the setup push;
  - everything runs off the main thread.
- **Pull flags:** `git pull --rebase` (my call, see §7), run only on a clean tree (Rust re-checks before running). It gives linear history for one person on several machines. No `--autostash`.
- **Initial branch:** `git init -b main` when git is 2.28 or newer. On older git, `git init` then `git symbolic-ref HEAD refs/heads/main`.
- **Finding git** (my call):
  - On Windows, `git` from `PATH`.
  - On macOS and Linux, apps launched from Finder or the desktop get a minimal PATH. Zukai reads the login shell's PATH once (`$SHELL -lc 'command -v git'`), then falls back to `/opt/homebrew/bin`, `/usr/local/bin` and `/usr/bin`.
  - On macOS, `/usr/bin/git` counts only if `xcode-select -p` succeeds, so Zukai never triggers the Command Line Tools install dialog.
- **Frontend:**
  - a `GitRow` component, rendered by `LibraryTree` under heading rows and by the sidebar under the LIBRARY section heading for the Library root;
  - a `useGitStatus` hook that keeps per-folder state;
  - a setup card reusing the commit card's styling;
  - a clone dialog using the app's existing dialog pattern;
  - menu items added where **Add folder…** and the heading ⋯ menus are built.
- **Clone into the Library:** reuses the existing Choose Library folder path in Rust, and clone into an added folder reuses the existing add-folder validation. Neither is reimplemented.

## 6. Left to the builder

- Exact mapping from git stderr to the error cases above. Match on stable fragments and fall back to "Git failed."
- Test strategy: Rust tests against temp repos with a local bare remote (tests may use a local path even though the UI refuses `file://`), plus component tests for the row, card and dialog states.
- Whether `useGitStatus` lives in `src/app/` beside `useLibrary` or in a new `src/git/`.
- DESIGN.md gets the new `--z-warn` token and short entries for the git row and the setup card.
- Whether clone progress shows a percentage (`--progress` parsing) or just a spinner.

## 7. Calls I made (check these)

- "Library folders" covers both the Library root and added folders.
- The git row shows only when the folder is the **top** of a repo. In a subfolder of a bigger repo, "commit all" would commit things outside the notes, and Set up sync is disabled there too.
- Pull uses `--rebase`, so it never creates merge commits between your own machines.
- While a rebase or merge is in progress, all three buttons are disabled, and Rust refuses too.
- Finding git on macOS and Linux: the login shell's PATH, then known locations, never triggering the Xcode install dialog.
- The default commit message is `Sync YYYY-MM-DD`, and the setup commit is "Set up Zukai sync".
- Set up sync always names the branch `main` and the remote `origin`.
- If the setup push fails, the local repo is kept. Push then retries and sets the upstream.
- A cloned folder becomes an added folder by default. The **Use as my Library** checkbox covers the case where you synced your Library itself.
- With the setting off, the git items are hidden rather than disabled, and no git process runs at all.
- Zukai doesn't add a `.gitignore`. Everything in the folder is committed, as the setup card says.
