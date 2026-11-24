# Git Sync for Library Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user sync a library folder between machines through their own `git`: set it up, clone it elsewhere, and Pull / Commit / Push from a git row in the sidebar, all behind a Settings switch.

**Architecture:** A new Rust module `src-tauri/src/git/` runs the system `git` binary with strict process hygiene, parses its output, and exposes Tauri commands. These are gated by a managed `GitState`: an enabled flag, the found git binary, per-folder busy locks and clone cancel handles. The frontend adds `src/git/` (API wrappers, error copy, a `useGitSync` hook), plus `GitRow`, `SetupSyncCard` and `CloneDialog` components. These are wired into `LibraryTree` heading rows and the Sidebar's LIBRARY heading through one render prop.

**Tech Stack:** Rust (Tauri v2, thiserror, serde, tempfile and dunce in tests), React 19 + TypeScript, Tailwind v4, Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-24-library-git-sync-design.md`. Read it before any task. It holds all user-facing copy and behaviour.

## Global Constraints

- Never run `reset`, `--force`, `checkout --`, `stash`, or `rebase --continue/--abort`, and never delete a `.git`. The only removal allowed is the folder a cancelled or failed clone created itself.
- Every git process:
  - env `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`;
  - stdin null;
  - `CREATE_NO_WINDOW` (`0x08000000`) on Windows;
  - killed on timeout;
  - run off the main thread.
- Timeouts:
  - status: 10s;
  - pull and push: 60s;
  - local ops (`init`, `add`, `commit`, `remote`): 60s;
  - clone and the setup push: 300s.
- Pull is `git pull --rebase` only, never `--autostash`, and refuses a dirty tree. It refuses in Rust as well as in the UI.
- Every op refuses while a rebase or merge is in progress. It refuses in Rust as well as in the UI.
- Set up sync uses branch `main` and remote `origin`, and commits with the message `Set up Zukai sync`.
- The default commit message is `Sync YYYY-MM-DD`, using the local date.
- URLs: refuse a leading `-`, the `ext::` scheme and the `file://` scheme. Always pass the URL after `--`. Set `GIT_PROTOCOL_FROM_USER=0` and `-c protocol.ext.allow=never`.
- The `gitSync` setting defaults to `true`. When it's off:
  - no git process runs at all, not even discovery;
  - git UI is hidden, not disabled;
  - Rust commands return kind `disabled`.
- `folder` arguments must be exactly the Library root or an added root. Use the idiom `let t = g.in_root(p)?; g.root_of(&t).as_ref() == Some(&t)`. Anything else returns kind `not_allowed`.
- A clone parent comes only from the Rust-run picker, held in Rust under a token. The webview never supplies it as a path.
- Icons are Lucide at `strokeWidth` 1.6: `GitBranch`, `ArrowDownToLine`, `GitCommitHorizontal`, `ArrowUpFromLine`, `Loader2`, `Check`.
- The only new color is the `--z-warn` token. Use existing `--z-*` tokens for everything else.
- Rust CI must pass: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test -- --include-ignored`, all in `src-tauri`. Frontend checks must pass: `npm run typecheck`, `npm run lint` and `npm test`.

## Review Focus

1. **Folder paths with spaces and non-ASCII** (e.g. `C:\Users\Sahar Tal\נוטס`). Every op works, and status still parses. Tested in Task 2 and Task 3.
2. **Commit messages with quotes, a leading `-`, or non-ASCII** (`-x "quoted" ü`). They are committed verbatim and never parsed as flags or by a shell. Tested in Task 3.
3. **Hostile URLs** (`--upload-pack=touch /tmp/x`, `ext::sh -c id`, `file:///etc`). Refused with kind `bad_url` before git runs. Tested in Task 3.
4. **A fresh repo with no commits** (unborn `main`). Status shows branch `main`, ahead and behind are 0, and nothing crashes. Tested in Task 2.
5. **Success output on stderr** (`git push` prints progress to stderr). Success is judged by exit code only, never by stderr content. Tested in Task 1 and Task 3.

---

### Task 1: Git runner, discovery and error type

**Files:**
- Create: `src-tauri/src/git/mod.rs`, `src-tauri/src/git/run.rs`, `src-tauri/src/git/error.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod git;`)
- Test: in-file `#[cfg(test)]` modules

**Interfaces:**
- Produces:
  - `pub struct Git { bin: PathBuf }` with `pub fn run(&self, cwd: &Path, args: &[&str], timeout: Duration) -> Result<Done, GitError>`, where `pub struct Done { pub stdout: String, pub stderr: String }`. It runs `bin` with `args`, applying every process rule in Global Constraints. A non-zero exit becomes `GitError` through `classify`.
  - `pub fn find_git() -> Option<Git>` follows spec §5 "Finding git":
    - Windows: `git` on `PATH`;
    - unix: `$SHELL -lc 'command -v git'` with a 10s timeout, then `/opt/homebrew/bin/git`, `/usr/local/bin/git`, `/usr/bin/git`;
    - macOS: `/usr/bin/git` only if `xcode-select -p` exits 0.

    A candidate counts only if `git --version` exits 0.
  - `pub(crate) fn run_with_timeout(cmd: Command, timeout: Duration) -> Result<Output, RunFail>`, where `enum RunFail { Spawn(io::Error), Timeout }`. It spawns, waits with a deadline, and on timeout kills the process tree (reuse `terminal::tree::guard(pid)` then `.kill()`).
  - `pub fn git_version(&self) -> (u32, u32)`, used for the `init -b` check in Task 3.
  - `#[derive(Debug, Clone, Copy, PartialEq, Serialize)] #[serde(rename_all = "snake_case")] pub enum GitKind` with variants:
    - `Disabled`, `NoGit`, `NotAllowed`, `Busy`, `InProgress`, `Dirty`
    - `Rejected`, `Conflict`, `RepoUnreachable`, `Network`, `Timeout`
    - `RemoteNotEmpty`, `BadUrl`, `DestExists`, `Refused`, `Cancelled`, `Failed`
  - `#[derive(Debug, Clone, Serialize, thiserror::Error)] #[error("{kind:?}: {detail}")] pub struct GitError { pub kind: GitKind, pub detail: String, pub conflicts: Option<u32>, pub committed: bool }`. It serializes as `{ kind: "rejected" | …snake_case, detail, conflicts, committed }`.
  - `pub fn classify(stderr: &str) -> GitKind`, with match fragments:
    - `rejected`: `[rejected]`, `non-fast-forward`, `fetch first`
    - `conflict`: `CONFLICT`, `could not apply`
    - `repo_unreachable`: `Repository not found`, `Permission denied`, `Authentication failed`, `could not read Username`, `does not appear to be a git repository`
    - `network`: `Could not resolve host`, `Connection timed out`, `Failed to connect`
    - anything else: `failed`
  - `pub fn first_line(stderr: &str) -> String` returns the first line starting with `fatal:`, `error:` or ` ! [`. Failing that, it returns the first non-empty line.

- [ ] **Step 1: Write failing tests** in `run.rs` and `error.rs`:
  - `classify_maps_fragments`: one assert per fragment group above, plus `classify("weird") == Failed`.
  - `first_line_prefers_fatal`: `first_line("hint: x\nfatal: bad thing\n") == "fatal: bad thing"`.
  - `runner_times_out_and_kills`: `run_with_timeout` on a sleeping command (`cmd /C ping -n 30 127.0.0.1` on Windows, `sleep 30` on unix) with 300ms returns `RunFail::Timeout` in under 5s.
  - `stderr_on_success_is_not_an_error`: in a temp dir, run `init`, then `checkout -b other`. The second writes "Switched to a new branch" to stderr and exits 0. Assert `Ok`, with `stderr` non-empty.
  - `find_git_finds_git`: `#[ignore]`-free, assumes git on CI runners. `find_git().is_some()`.
  - `error_serializes_snake_case`: `serde_json::to_value(GitError{kind:GitKind::RemoteNotEmpty,..})["kind"] == "remote_not_empty"`.
- [ ] **Step 2: Run** `cargo test git::` in `src-tauri`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the items listed in Interfaces. `run_with_timeout` polls `try_wait` every 25ms. Read stdout and stderr on threads so a full pipe can't deadlock.
- [ ] **Step 4: Run** `cargo test git::` and `cargo clippy --all-targets -- -D warnings`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(git): runner with timeouts, discovery and error kinds`

### Task 2: Status

**Files:**
- Create: `src-tauri/src/git/status.rs`, `src-tauri/src/git/testutil.rs` (`#[cfg(test)]`)
- Test: in-file

**Interfaces:**
- Consumes: `Git::run`, `GitError` (Task 1).
- Produces:
  - `#[derive(Serialize)] #[serde(tag = "kind", rename_all = "camelCase")] pub enum FolderGit { NotRepo, InsideRepo { top: String }, Repo(RepoStatus) }`
  - `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct RepoStatus { pub branch: Option<String>, pub head: String, pub dirty: bool, pub upstream: bool, pub origin: bool, pub ahead: u32, pub behind: u32, pub state: RepoState }`
    - `head` is the 7-character short oid, or `""` when unborn.
    - `branch` is `None` on a detached HEAD.
  - `pub enum RepoState { Clean, Rebasing, Merging }`, serialized as `"none" | "rebasing" | "merging"`.
  - `pub fn parse_porcelain(out: &str) -> Parsed` (pure), with `Parsed { branch, head, upstream, ahead, behind, dirty, conflicts: u32 }`.
  - `pub fn folder_git(git: &Git, dir: &Path) -> Result<FolderGit, GitError>`:
    1. `rev-parse --show-toplevel`. A failure here means `NotRepo`.
    2. Compare the result with `dunce::canonicalize` of `dir`, using `files::grants::key` for case-folding. A mismatch means `InsideRepo`.
    3. Run `status --porcelain=v2 --branch` and `remote`.
    4. Get the git dir from `rev-parse --git-dir`, then check for `MERGE_HEAD`, `rebase-merge` and `rebase-apply` in it.
- testutil: `pub fn repo() -> (TempDir, PathBuf)` creates an initialised repo on `main` with `user.name`/`user.email` set locally. `pub fn repo_with_remote() -> (TempDir, PathBuf /*work*/, PathBuf /*bare*/)` adds a bare remote as `origin`, makes one commit and pushes it with `-u`. Both use a directory named `notes ü space` (Review Focus 1).

- [ ] **Step 1: Write failing tests:**
  - `parses_unborn_branch`: input `"# branch.oid (initial)\n# branch.head main\n"` gives `branch == Some("main")`, `head == ""`, `ahead == 0`, `!dirty` (Review Focus 4).
  - `parses_ahead_behind_and_dirty`: `"# branch.oid abcdef1234\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b f.md\n"` gives `ahead==2, behind==1, upstream, dirty, head=="abcdef1"`.
  - `parses_detached`: `# branch.head (detached)` gives `branch == None`.
  - `counts_conflicts`: two `u ` lines give `conflicts == 2`.
  - `untracked_counts_as_dirty`: a `? new.md` line gives `dirty`.
  - `folder_git_not_repo` / `inside_repo` / `repo` against temp dirs. A subfolder of `repo()` gives `InsideRepo { top }`.
  - `detects_rebasing`: create `<gitdir>/rebase-merge/` and expect `state == Rebasing`.
- [ ] **Step 2: Run** `cargo test git::status`. Expected: FAIL.
- [ ] **Step 3: Implement** the items listed in Interfaces.
- [ ] **Step 4: Run** `cargo test git::status`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(git): read folder status`

### Task 3: Operations: pull, commit and push, push, setup

**Files:**
- Create: `src-tauri/src/git/ops.rs`, `src-tauri/src/git/url.rs`
- Test: in-file

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `pub fn check_url(url: &str) -> Result<(), GitError>` returns `BadUrl` if:
    - the URL, trimmed, is empty;
    - it starts with `-`;
    - it starts with `ext::` (case-insensitive);
    - it starts with `file:`.
  - `pub fn pull(git: &Git, dir: &Path) -> Result<(), GitError>`:
    1. refuse `InProgress` or `Dirty` based on `folder_git`;
    2. run `pull --rebase` with the 60s timeout;
    3. on `Conflict`, fill `conflicts` from a fresh `parse_porcelain`.
  - `pub fn commit_push(git: &Git, dir: &Path, message: &str) -> Result<(), GitError>`:
    1. refuse `InProgress`;
    2. `add -A`;
    3. if `status --porcelain` is empty, skip the commit; otherwise `commit -m <message>` passed as one arg;
    4. if `origin` exists, `push` (with `-u origin <branch>` when there's no upstream).

    A push failure after a successful commit returns an error with `committed: true`.
  - `pub fn push(git: &Git, dir: &Path) -> Result<(), GitError>` refuses `InProgress`, then runs `push`, or `push -u origin <branch>` when there's no upstream.
  - `pub fn setup(git: &Git, dir: &Path, url: &str) -> Result<(), GitError>`:
    1. `check_url`;
    2. refuse `Refused` unless `folder_git` is `NotRepo`;
    3. `init -b main` if git is 2.28 or newer, else `init` then `symbolic-ref HEAD refs/heads/main`;
    4. `add -A`, then `commit -m "Set up Zukai sync"`, skipped when nothing is staged;
    5. `remote add origin -- <url>`;
    6. if there's a commit, `push -u origin main` with the 300s timeout. A `Rejected` result here is remapped to `RemoteNotEmpty`.

- [ ] **Step 1: Write failing tests** using `testutil`. Use a second clone of the bare remote as "the other machine".
  - `check_url_refuses_hostile`: `--upload-pack=touch x`, `ext::sh -c id`, `EXT::x`, `file:///etc` and `""` are all `BadUrl`. `git@github.com:a/b.git` and `https://h/a.git` are `Ok` (Review Focus 3).
  - `commit_push_sends_to_remote`: write `a.md`, then `commit_push(work, "-x \"quoted\" ü")`. The other clone's `git log -1 --format=%s` equals `-x "quoted" ü` exactly (Review Focus 2 and 5).
  - `commit_push_clean_pushes_unpushed`: commit locally with git, then `commit_push` leaves `ahead == 0`.
  - `commit_push_reports_committed_when_push_rejected`: the other clone pushes first. `commit_push` returns `kind == Rejected` and `committed == true`.
  - `pull_refuses_dirty`: with an untracked file, the result is `kind == Dirty` and the file still exists.
  - `pull_brings_changes`: the other clone pushes `b.md`, then `pull` makes `b.md` exist.
  - `pull_conflict_reports_count`: both sides edit the same line, the other side pushes, and the local side commits. `pull` returns `Conflict` with `conflicts == Some(1)`, and `folder_git` then shows `state == Rebasing`.
  - `ops_refuse_while_rebasing`: in that state, `commit_push`, `push` and `pull` all return `InProgress`.
  - `setup_pushes_to_empty_bare`: setup on a plain folder with `a.md` and an empty bare remote. The result is `Repo` with `upstream && !dirty && branch == "main"`.
  - `setup_on_non_empty_remote`: the result is `RemoteNotEmpty`. `.git` still exists and `origin` is set.
  - `setup_refuses_inside_repo`: a subfolder of a repo gives `Refused`.
  - `setup_empty_folder_skips_push`: setup on an empty folder succeeds, with `origin` set, `upstream == false` and no commits. A later `commit_push` with a new file pushes and sets the upstream.
  - `push_sets_upstream_when_missing`: after a failed setup, retarget origin to an empty bare remote, then `push` gives `upstream == true`.
- [ ] **Step 2: Run** `cargo test git::ops git::url`. Expected: FAIL.
- [ ] **Step 3: Implement** the items listed in Interfaces. Build the URL args as `["remote","add","origin","--",url]`, and put `-c protocol.ext.allow=never` before every network subcommand.
- [ ] **Step 4: Run** `cargo test git::`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(git): pull, commit-and-push, push and setup`

### Task 4: Clone

**Files:**
- Create: `src-tauri/src/git/clone.rs`
- Test: in-file

**Interfaces:**
- Consumes: Tasks 1 and 3 (`check_url`), and `library::added::refusal(candidate, library, added, home, mount_point) -> Option<Refusal>`.
- Produces:
  - `pub fn repo_name(url: &str) -> String` returns the last path segment, minus `.git` and trailing `/`, with `:` treated as a separator.
  - `pub fn check_name(name: &str) -> Result<(), GitError>` returns `Refused` for an empty name, `.` or `..`, or a name containing `/` or `\` or a char that's invalid on Windows (`<>:"|?*`).
  - `pub fn clone_into(git: &Git, url: &str, dest: &Path, cancel: &CancelFlag) -> Result<(), GitError>`:
    - `check_url`;
    - `DestExists` if `dest` exists and isn't an empty dir;
    - run `-c protocol.ext.allow=never clone -- <url> <dest>` with the 300s timeout;
    - honour `cancel` by polling it alongside the timeout. Extend Task 1's runner with `run_cancellable(…, cancel: &CancelFlag)`, where `CancelFlag = Arc<AtomicBool>`, which returns `Cancelled`;
    - on any failure, remove `dest` with `remove_dir_all` **only if this call created it**.

- [ ] **Step 1: Write failing tests:**
  - `repo_name_cases`: `git@github.com:me/notes.git` gives `notes`, `https://h/a/b/` gives `b`, `host:repo` gives `repo`.
  - `check_name_refuses`: `""`, `".."`, `"a/b"`, `"a:b"`.
  - `clones_bare_remote`: clone `repo_with_remote()`'s bare into `tmp/new` and expect `folder_git == Repo { upstream: true }`.
  - `clones_empty_repo`: an empty bare remote clones without error.
  - `refuses_non_empty_dest`: `DestExists`, and the existing files are untouched.
  - `failed_clone_removes_only_created_dest`: a bad repo path removes `tmp/new`. A pre-existing empty `tmp/pre` dest survives.
  - `cancel_removes_dest`: set the flag before the call. The result is `Cancelled` and dest doesn't exist.
- [ ] **Step 2: Run** `cargo test git::clone`. Expected: FAIL.
- [ ] **Step 3: Implement** the items listed in Interfaces.
- [ ] **Step 4: Run** `cargo test git::clone`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(git): clone with cancel and cleanup`

### Task 5: Tauri commands and the enable gate

**Files:**
- Create: `src-tauri/src/git/commands.rs`, `src-tauri/src/git/state.rs`
- Modify:
  - `src-tauri/src/lib.rs:196-204`: add `.manage(git::state::GitState::default())`;
  - `src-tauri/src/lib.rs:257-279`: register the commands below;
  - `src-tauri/src/library/commands.rs:902`: make `sync_added_watchers` `pub(crate)`.
- Test: in-file (state logic, without an AppHandle)

**Interfaces:**
- Consumes: Tasks 1–4, plus these from the library and files modules:
  - `files::commands::blocking`
  - `library::commands::{add_folder, use_root, root_state, sync_added_watchers, data_dir, RootState}`
  - `Grants::{in_root, root_of, root, added}`
- Produces (`state.rs`):
  - `GitState { enabled: AtomicBool /*default false until the frontend says*/, git: Mutex<Option<Option<Git>>> /*None = not looked yet*/, busy: Mutex<HashSet<String>>, picks: Mutex<HashMap<String, PathBuf>>, cancels: Mutex<HashMap<String, CancelFlag>> }` with:
    - `fn git(&self) -> Result<Git, GitError>`: `Disabled` when off; discovery runs lazily once; `NoGit` if none is found;
    - `fn lock(&self, key: String) -> Result<BusyGuard, GitError>`: `Busy` if the key is already held, released on drop.
- Commands, all `#[tauri::command] pub async`. Each returns `Result<_, GitError>` and does its git work inside `spawn_blocking`:
  - `git_set_enabled(app, enabled: bool) -> GitAvailability { available: bool }`. Turning it off never runs git. Turning it on runs discovery.
  - `git_status(app, folder: String) -> FolderGit`
  - `git_pull(app, folder: String) -> ()`
  - `git_commit_push(app, folder: String, message: String) -> ()`
  - `git_push(app, folder: String) -> ()`
  - `git_setup(app, folder: String, url: String) -> ()`
  - `git_pick_clone_parent(app, window) -> Option<PickedParent { token: String, path: String }>`, using the same dialog code as `library_add_folder`.
  - `git_clone(app, token: String, url: String, name: String, use_as_library: bool, op_id: String) -> RootState`:
    1. Resolve `dest = picks[token]/name`.
    2. For the added-folder case only, check `added::refusal(dest, …)` and map a refusal to `Refused` with `detail = refusal.message()`.
    3. Run `clone_into`.
    4. Then call `add_folder(g, data, &dest)` or `use_root(g, data, &dest, &[])`, followed by `sync_added_watchers`.
  - `git_cancel(app, op_id: String) -> ()`

  Every `folder` command first checks the exactly-a-root idiom (otherwise `NotAllowed`) and holds `lock(key(folder))` for its whole run.
- Modify: `src/dev/preview.ts:229`. Add mock handlers: `git_set_enabled` returns `{available:false}`, and the other `git_*` commands reject `{kind:"no_git",detail:"",conflicts:null,committed:false}`.

- [ ] **Step 1: Write failing tests** in `state.rs`:
  - `disabled_state_never_discovers`: with `enabled = false`, `git()` returns `Disabled` and the inner slot stays `None`.
  - `busy_lock_is_exclusive`: a second `lock("k")` gives `Busy`; after dropping the first, it gives `Ok`.
  - `picks_are_single_use`: `take_pick(token)` returns the path once, then `None`.
- [ ] **Step 2: Run** `cargo test git::state`. Expected: FAIL.
- [ ] **Step 3: Implement** `state.rs`, `commands.rs` and the registration. `Refused` errors from add-folder validation carry the existing `Refusal::message()` text in `detail`.
- [ ] **Step 4: Run** `cargo test`, `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(git): tauri commands behind the git sync switch`

### Task 6: Setting, API, copy and the useGitSync hook

**Files:**
- Modify:
  - `src/model/settings.ts`: add `gitSync: boolean`, default `true`, parsed like `autosaveFiles`;
  - `src/ui/SettingsDialog.tsx`: add a row after the autosave row (:523-543) with `id="z-git-sync"`, label "Git sync", hint "Show git status and Pull, Commit and Push for library folders.";
  - `src/app/useWorkspace.ts`: call `useGitSync` beside `useLibrary` (:656) and expose it as `w.git`, plus `unsavedUnder(folder: string): number`, which counts open tabs whose path `isUnder(folder)` and where `files.hasPending(id)` is true.
- Create:
  - `src/git/api.ts`: types mirroring Task 2 and Task 5 (`FolderGit = {kind:"notRepo"} | {kind:"insideRepo"; top: string} | ({kind:"repo"} & RepoStatus)`, `RepoStatus.state: "none" | "rebasing" | "merging"`), plus invoke wrappers with camelCase args (`gitStatus(folder)`, `gitPull(folder)`, `gitCommitPush(folder, message)`, `gitPush(folder)`, `gitSetup(folder, url)`, `gitPickCloneParent()`, `gitClone(req: CloneRequest)`, `gitCancel(opId)`, `gitSetEnabled(enabled)`), and `asGitError(e: unknown): GitError`;
  - `src/git/messages.ts`: `errorCopy(e: GitError): string`, `defaultCommitMessage(now: Date): string`;
  - `src/git/useGitSync.ts`.
- Test: `src/model/settings.test.ts`, `src/git/messages.test.ts`, `src/git/useGitSync.test.ts`

**Interfaces:**
- Produces:
  - `type GitOp = "pull" | "commit" | "push" | "setup"`
  - `interface GitSyncApi { enabled: boolean; available: boolean; status(folder: string): FolderGit | undefined; running(folder: string): GitOp | null; justDone(folder: string): GitOp | null; error(folder: string): GitError | null; dismiss(folder: string): void; pull(folder: string): Promise<void>; commit(folder: string, message: string): Promise<void>; push(folder: string): Promise<void>; setup(folder: string, url: string): Promise<void>; refresh(folder?: string): void }`
  - `useGitSync(opts: { enabled: boolean; folders: string[] }): GitSyncApi`. Here `folders` is `[root, ...added.map(a => a.path)]`, filtered to available ones.
- `errorCopy`, verbatim from spec §4.7 plus the refusal copy:
  - `rejected`: "The remote has newer changes. Pull first, then push."
  - `conflict`: "Pull stopped: {n} files conflict. Finish it in a terminal (`git rebase --continue` or `--abort`)."
  - `repo_unreachable`: "Couldn't reach that repo. Check the URL and your git credentials."
  - `network`: "Couldn't reach the remote. Check your connection."
  - `timeout`: "Git took too long and was stopped."
  - `dirty`: "You have uncommitted changes. Commit first, then pull."
  - `remote_not_empty`: "That repo isn't empty. To use its notes here, use Add folder from git… instead."
  - `in_progress`: "Finish the rebase in a terminal first"
  - `bad_url`: "That doesn't look like a git URL."
  - `dest_exists`: "A folder with that name already exists there."
  - `refused`: `detail`
  - anything else: "Git failed."

  When `committed` is true, prefix with "Committed. Push failed: ".
- Hook behaviour:
  - on `enabled` change, call `gitSetEnabled(enabled)` first;
  - when enabled and available, fetch the status of each folder;
  - refresh one folder after each op;
  - refresh all on window `focus`, and on `onLibraryChanged` debounced 1000ms;
  - `justDone` clears after 1000ms;
  - starting an op clears that folder's error;
  - when disabled, `status()` returns `undefined` for every folder and no invoke runs except `gitSetEnabled(false)`;
  - if the user turns the switch off while an op is running, `enabled` stays `true` until that op settles, then flips (spec §4.0).

- [ ] **Step 1: Write failing tests:**
  - settings: `DEFAULT_SETTINGS.gitSync === true`, `parseSettings({gitSync:false}).gitSync === false`, `parseSettings({gitSync:"no"}).gitSync === true`.
  - messages: `defaultCommitMessage(new Date(2026,10,24)) === "Sync 2026-11-24"`. Add one test per `errorCopy` case, including `committed` and `conflicts: 2`.
  - hook (mock `@tauri-apps/api/core` `invoke`):
    - `disabled_runs_no_git_commands`: only `git_set_enabled` with `{enabled:false}` is invoked.
    - `fetches_status_per_folder`.
    - `refreshes_on_focus`.
    - `commit_sets_running_then_justDone`.
    - `error_kept_until_dismiss_or_next_op`.
- [ ] **Step 2: Run** `npx vitest run src/git src/model/settings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the items listed in Interfaces, plus the Settings row (same markup as the autosave row).
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(git): git sync setting, api and status hook`

### Task 7: Warn token, icons and GitRow

**Files:**
- Modify:
  - `src/styles/app.css`: add `--z-warn` in `:root` (`#b45309`) and `:root[data-theme="dark"]` (`#d97706`), and add `--color-warn: var(--z-warn);` in `@theme inline` (:220-248). Check contrast of the dot against `--z-side` in all five themes (≥3:1 for a non-text indicator), and override in the palette blocks only where it fails;
  - `src/ui/icons.tsx`: add the six Lucide icons from Global Constraints to `IconName` and `ICONS`.
- Create: `src/ui/GitRow.tsx`
- Test: `src/ui/GitRow.test.tsx`

**Interfaces:**
- Consumes: the `RepoStatus`, `GitOp`, `GitError` and `errorCopy`/`defaultCommitMessage` types from Task 6.
- Produces: `GitRow(props: { name: string; status: RepoStatus; running: GitOp | null; justDone: GitOp | null; error: GitError | null; unsaved: number; indent: number; onPull(): void; onCommit(message: string): void; onPush(): void; onSaveAll(): void; onDismiss(): void })`.
- Visuals follow spec §4.4 and the mockup:
  - 22px row, `paddingLeft = indent`;
  - branch name `text-ui-xs text-faint`, or `head` when `branch` is null, plus " · rebasing" or " · merging";
  - a 5px `bg-warn` dot with `title="Uncommitted changes"` when dirty;
  - 20px buttons with `rounded-[4px] text-faint hover:bg-row-hover hover:text-muted` and `aria-label` set to "Pull", "Commit" or "Push";
  - the running button shows a spinning `Loader2` (`motion-reduce:animate-none`), and `justDone` shows `Check` for its button;
  - the commit card uses the TrashConfirm classes (`z-fade-in rounded-float bg-surface shadow-float`). Inside it go an input pre-filled with `defaultCommitMessage(new Date())` and selected, the line "N unsaved files won't be included" with a **Save all** button when `unsaved > 0`, and a submit button. Enter submits, Esc or blur-outside closes, and an empty message disables submit;
  - the error box uses the rename-error style with `errorCopy`, `detail` in `font-mono`, and a dismiss button labelled "Dismiss".
- Button enablement and tooltips:

  | Condition | Pull | Commit | Push |
  |---|---|---|---|
  | `running` set, or `state` is not `"none"` | disabled, "Finish the rebase in a terminal first" (only when `state` isn't `"none"`) | disabled | disabled |
  | no origin | disabled, "No remote set up for this folder" | enabled | disabled, same tooltip |
  | origin, no upstream | disabled | enabled | enabled |
  | dirty | enabled (Rust refuses with `dirty`) | opens card | enabled |
  | clean, `ahead > 0` | enabled | calls `onCommit("")`, which goes straight to push | enabled |
  | clean, `ahead == 0` | enabled | does nothing, tooltip "Nothing to commit" | does nothing, tooltip "Nothing to push" |

  The hook treats an empty message as "push only": it calls `gitPush`.

- [ ] **Step 1: Write failing tests**, one `it` per row of the table, plus:
  - `shows_dirty_dot_only_when_dirty`;
  - `detached_shows_head`;
  - `commit_card_prefills_and_submits_on_enter` (asserts `onCommit("Sync YYYY-MM-DD")` using fake timers set to 2026-11-24);
  - `escape_closes_card_without_commit`;
  - `empty_message_disables_submit`;
  - `unsaved_line_and_save_all`;
  - `error_shows_copy_detail_and_dismiss`.
- [ ] **Step 2: Run** `npx vitest run src/ui/GitRow.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the items listed in Interfaces.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(git): git row with commit card and errors`

### Task 8: Wire rows into the sidebar, and Set up sync

**Files:**
- Modify:
  - `src/ui/LibraryTree.tsx`: add prop `underHeading?(path: string): ReactNode`, rendered right after each heading row (:288-354). Wrap heading plus extra in a fragment keyed by path. Keep `data-row` indices unchanged;
  - `src/ui/Sidebar.tsx`: add props `git: GitSyncApi`, `unsavedUnder(folder): number`, `onSaveAll(): void`, `onCloneFolder(): void`. Then:
    - render the git row or setup card under `<SectionHeading label="LIBRARY">` (:768-817) for `root`, and through `underHeading` for added folders. Hide all of it when `!git.enabled`;
    - add **Set up sync…** to `rootItems(r)` (:450) and `headingItems(a)` (:467), but only when `git.enabled` and `git.available`, and only when `status` is `notRepo` or `insideRepo`. For `insideRepo`, use `disabled: true` with `reason: "This folder is inside the git repo at {top}."`. When `git.enabled && !git.available`, show it disabled with reason "Install git to sync folders.";
  - `src/App.tsx:601-650`: pass `w.git`, `w.unsavedUnder`, `w.saveAll`, and the clone opener (Task 9).
- Create: `src/ui/SetupSyncCard.tsx`
- Test: `src/ui/SetupSyncCard.test.tsx`, `src/ui/Sidebar.test.tsx` (extend if it exists, otherwise create)

**Interfaces:**
- Consumes: `GitSyncApi` (Task 6), `GitRow` (Task 7).
- Produces: `SetupSyncCard(props: { indent: number; running: boolean; error: GitError | null; onSetUp(url: string): void; onCancel(): void })`. It has:
  - the copy from spec §4.1: label "Remote URL", placeholder `git@github.com:you/notes.git`, hint "Create an empty repo on GitHub, GitLab or your server, then paste its URL.", and note "Everything in this folder will be committed and pushed.";
  - **Set up** and **Cancel** buttons.

  Sidebar keeps `settingUp: string | null` (the folder path) so it knows which card is open.

- [ ] **Step 1: Write failing tests:**
  - SetupSyncCard: `submits_trimmed_url`, `empty_url_disables_set_up`, `escape_cancels`.
  - Sidebar:
    - `git_off_hides_rows_and_menu_items`, rendered with `git.enabled=false` and a repo status: no "Pull" button, no "Set up sync…" item;
    - `repo_shows_row_under_added_heading`;
    - `not_repo_offers_set_up_sync`;
    - `inside_repo_disables_set_up_with_reason`;
    - `no_git_disables_with_install_reason`.
- [ ] **Step 2: Run** `npx vitest run src/ui/SetupSyncCard.test.tsx src/ui/Sidebar.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the items listed in Interfaces. After a successful setup, close the card. The hook's refresh then turns it into a git row. On failure, the row shows the error (Task 7). `remote_not_empty` and `repo_unreachable` show there too.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(git): git rows and set up sync in the sidebar`

### Task 9: Add folder from git

**Files:**
- Modify:
  - `src/app/useLibrary.ts`: add `LibraryApi.cloneFolder(req: Omit<CloneRequest, "opId">, opId: string): Promise<GitError | null>`. Implement it like `addFolder` (:945) and `chooseRoot` (:933), applying the returned `RootState` through the same path (`changeRoot`). When `useAsLibrary`, restart watching exactly as `chooseRoot` does;
  - `src/ui/Sidebar.tsx`: add **Add folder from git…** right after `addFolderItem` (:461) in `libraryItems()` (:578) and in the LIBRARY ⋯ menu (:590-599). Same visibility rules as Set up sync (hidden when off, disabled "Install git to sync folders." when unavailable). Render the placeholder row `Cloning {name}…` with a spinning `Loader2` after the last added folder while a clone runs. Clicking it opens a `Menu` with one item, **Cancel**, which calls `gitCancel(opId)`.
- Create: `src/ui/CloneDialog.tsx`
- Test: `src/ui/CloneDialog.test.tsx`

**Interfaces:**
- Consumes: `gitPickCloneParent`, `gitCancel`, `CloneRequest { token, url, name, useAsLibrary, opId }` (Task 6), and `repo_name` behaviour (mirror it in TS as `repoName(url)` in `src/git/messages.ts`, tested with the same three cases as Task 4).
- Produces: `CloneDialog(props: { initial?: { url: string; name: string; useAsLibrary: boolean; parent: PickedParent | null; error: GitError | null }; onClone(req: Omit<CloneRequest,"opId">, shown: {name: string}): void; onCancel(): void })`. It follows the `SaveChangesDialog` shell (backdrop, `role="dialog"`, Esc cancels) and contains:
  - a "Repo URL" field;
  - a **Choose location…** button that calls `gitPickCloneParent()`;
  - a read-only destination preview `{parent.path}/{name}`, where the name field auto-fills from `repoName(url)` until the user edits it;
  - a **Use as my Library** checkbox, unchecked by default;
  - **Clone** (enabled only with a URL, a parent and a name) and **Cancel**.
- Flow (plan decision): **Clone** closes the dialog and shows the placeholder row. On failure, other than `cancelled`, the dialog reopens with every field kept and the error shown via `errorCopy`. On success, the new folder appears through the returned `RootState`.

- [ ] **Step 1: Write failing tests:**
  - `name_follows_url_until_edited`;
  - `clone_disabled_until_url_parent_name`;
  - `choose_location_shows_destination` (mock `gitPickCloneParent` resolving `{token:"t",path:"C:\\notes parent"}`);
  - `reopens_with_error_and_fields`, rendering `initial` with `error.kind="dest_exists"` and checking the copy is shown;
  - `use_as_library_passed_through`;
  - `repoName` cases in `messages.test.ts`.
- [ ] **Step 2: Run** `npx vitest run src/ui/CloneDialog.test.tsx src/git`. Expected: FAIL.
- [ ] **Step 3: Implement** the items listed in Interfaces, the menu items and the placeholder.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(git): add folder from git`

### Task 10: DESIGN.md and end-to-end check in the real app

**Files:**
- Modify: `DESIGN.md` and `.impeccable/design.json`. Add the `--z-warn` status token (under status colors, noting it's allowed by the One Accent Rule as a status), plus short **Git Row** and **Setup Sync Card** component entries. Keep the existing format, using `.claude/skills/impeccable/scripts/impeccable.cmd design-lookup` to see neighbours.

- [ ] **Step 1: Update** DESIGN.md and design.json.
- [ ] **Step 2: Run the app** (`npm run tauri dev`) with a temp bare remote (`git init --bare %TEMP%\zk-remote.git`). Walk through:
  1. Turn **Git sync** off: no rows, no menu items, and no `git.exe` process (check Task Manager).
  2. Turn it on, add a plain folder, then **Set up sync…**. First try `file:///C:/…/zk-remote.git` and expect the "That doesn't look like a git URL." error. Then use the plain `C:\…\zk-remote.git` path and confirm the row appears on `main`.
  3. Edit a note and confirm the amber dot shows. Commit with the default message: the check shows, the dot clears, and `git log` in the bare remote shows `Sync 2026-11-24`.
  4. **Add folder from git…** with the same bare path into a new parent. Confirm the folder is added as an expanded added folder with a clean row.
  5. Edit the same line in both copies, commit both, then Pull in the second. Expected: the conflict message, the row shows "rebasing", and all buttons are disabled. Run `git rebase --abort` in a terminal, focus the app, and confirm the row recovers.
  6. With a dirty folder, Pull shows "You have uncommitted changes. Commit first, then pull."
  7. Check the Paper and Graphite themes: the dot is visible and the row stays quieter than its heading.
- [ ] **Step 3: Run** `npm test`, `npm run typecheck`, `npm run lint`, and in `src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test -- --include-ignored`. Expected: all PASS.
- [ ] **Step 4: Commit** `docs(design): git row, setup card and warn token`
