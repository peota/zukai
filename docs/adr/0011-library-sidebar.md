# 11. A Library sidebar of real folders

Date: 2026-11-18
Status: Accepted. This reverses parts of the glossary ("no project concept", "no separate notes library") and the vision's "avoid excessive sidebars".

## Context

The owner works idea by idea. Each idea collects Markdown notes, Excalidraw flows, photos and plain or JSON files, and they want to jump between those pieces quickly. Tabs alone, with Recently Closed as the archive, don't give an idea a place to live.

We considered:
- **Virtual folders**, stored inside Zukai's own storage with an "export as folder" step later.
- **Real folders from day one**, inside a Zukai home folder.

## Decision

- **A Library of real folders.** Zukai has a **Library**: a real home folder on disk, `<Documents>/Zukai` by default, which the user can re-point.
  - Each project is a real folder inside it.
  - Each note, canvas or image is a real file: `.md`, `.excalidraw`, `.png` and so on.
- **The sidebar.** A sidebar (toggled with Mod+B) shows the Library as a tree, plus an Inbox of open Scratchpads.
- **Scratchpads stay loose.** Mod+N still creates a Scratchpad. It only becomes part of the Library through Save As into a Library folder.
- **Folder grant.** The Rust allowlist gains a folder grant for the Library root.

## Consequences

- Everything in the Library is usable outside Zukai: open it in Explorer, sync it, zip it or put it in git. It reuses the Files slice's saving, conflict and encoding rules.
- There is one storage model for project content, so there's never an export or conversion step.
- **The sidebar must stay out of the way.** Mod+B hides it completely, and with it hidden Zukai looks and behaves as before.
- **The webview may now read and write anything under the Library root.** That widens the allowlist from individual files to one folder the user chose.
- **Deleting from the sidebar must go to the operating system's trash**, because these are real user files.
- **Canvas moves earlier.** Flows are a core part of a project, so Canvas (M3) is delivered together with the Library, before M2.
