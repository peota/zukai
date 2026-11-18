# Library + Canvas — follow-ups

Open items left after the Library + Canvas slice (branch `feat/library`). All were triaged by the final whole-branch review as safe to follow up. None loses data or widens file access.

## Before merge: manual release-build pass

These checks need the real app, so they could not run in CI. Close any running Zukai dev instance first. Back up `%APPDATA%\Zukai`, `%APPDATA%\io.github.peota.zukai`, `%LOCALAPPDATA%\io.github.peota.zukai` and `Documents\Zukai`. Documents may be redirected to OneDrive. Run the release build, then restore the backups.

1. On first launch, the Library folder and `library.json` are created, and `session.json` holds no root.
2. A file added in Explorer appears in the tree.
3. An existing v2 Session migrates to v3 with Kinds.
4. Opening an existing `.excalidraw` without touching it keeps its modified time (no rewrite).
5. Draw, quit and relaunch: the drawing is restored.
6. The CSP blocks nothing the app needs:
   - Excalidraw fonts
   - export
   - image insert
   - the image viewer
   - Library and file commands
7. The network log shows no esm.sh request, and a text-only session never loads the Excalidraw chunk.

## Library and permissions (Rust)

- Concurrent `recover_root` probes against a dead network share are not de-duplicated. They need an in-flight marker.
- Every `locate` probes the root, so a root that drops mid-run still hits the dead share.
- A root reached through a junction or symlink the user made later is refused as "moved elsewhere", and the user has to pick the folder again. A remapped drive letter is not detected.
- `recreate_root` can adopt a link someone put in the root's place. It needs an explicit user action.
- A failed copy can leave a half-copied folder behind.
- `unique_name` only checks for a free name and does not reserve it.
- A root path with a trailing dot or space makes the Library unusable. It should be refused in `use_root`.
- Names with an NTFS stream suffix such as `link::$DATA` are not specifically refused.
- `SHQueryRecycleBinW` on a volume mounted into a folder may answer for the host drive. The trash still fails closed.
- Name index:
  - a race between the check and the build (it self-heals)
  - search order after watcher additions
  - dead slots are never compacted
  - non-ASCII queries allocate per entry
  - concurrent first searches can start duplicate builds
- The Windows `held_open` comment doesn't note that error 5 can also be a real ACL refusal, which waits up to 2 s.
- The F1 file-link Rust test returns early on Windows without the symlink privilege. It runs in CI.

## Sidebar UI

- No virtualisation. This is fine at about 1k rows.
- Dragging doesn't auto-scroll.
- The rename error popover drifts on scroll.
- The keyboard cursor can jump back after a fallback.
- Closing the plus-menu doesn't clear `returnFocus`.
- The drop-target race: a hover that isn't awaited can copy into a folder the pointer just left.
- Tabs opened during an operation aren't locked.
- The `movedPath` case fold has an edge case with İ.

## Canvas

- The whole scene is serialised on every drag frame, plus `savedAppState` on every change. Serialise on the trailing edge and flush.
- The viewport isn't flushed on exit. At most 300 ms of pan or zoom is lost, and that state lives only in the Session.
- Undo history is lost when switching Tabs.
- An invalid canvas being read-only doesn't show in the StatusBar.
- Reopening can move a stale file with the other extension into `scratchpads/`, where it is recovered as an orphan.

## Image and opener

- The TS button can't mirror the Rust-only refusals (Unix exec bit, AssocIsDangerous-only types). The button shows, and Rust refuses with a notice.
- The Unix exec-bit check refuses ordinary files on FAT, NTFS or network mounts.
- An image is read twice: once as text for its fingerprint, once as bytes.

## Code structure

- `FilesContext` has a wide surface and mixes argument styles. `context.ts` is near 300 lines.
- The `futureVersionStillRejected` test is missing (the behaviour is covered elsewhere).
- There is no test for the scratchpad other-extension removal failure.
