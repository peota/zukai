# Git sidebar: the Git view leaves the Library sidebar

Short design. It changes where the Git view from `2026-11-24-git-panel-design.md` lives. What the view contains does not change.

## Why

The Files | Git switch made the Library and Git take turns in one sidebar. The user wants Git as its own sidebar that they open from the status bar and from a shortcut. The Library should stay a Library.

## Approaches

- **Right, sharing a slot with Ask (picked).** It docks on the right like the Ask panel, with its own resizable width. Only one of Git and Ask is open at a time, so the editor is never squeezed by two panels.
- Right, beside Ask. Both can be open at once, but the editor gets narrow on a laptop.
- Left, beside the Library. Two columns on one side, which puts the editor off-center.

## Design

- **GitPanel** (`src/ui/git/GitPanel.tsx`):
  - It is a right-docked `section` with the same frame as AskPanel: a left resize edge, then a 36px header holding "Git" and a × close button, then the existing `GitView`.
  - The resize edge is moved out of AskPanel into a shared component that both panels use.
  - Width is stored in settings as `gitWidth`, clamped like `askWidth` (the same minimum and the 70% cap).
- **Open state:**
  - It is App state and is not stored, the same as Ask: the panel starts closed on every launch.
  - The panel can only show while git sync is on. Turning sync off closes it.
  - Opening Git closes Ask, and opening Ask closes Git.
- **Ways in:**
  - `Mod+Shift+G` toggles the panel. It keeps the existing command, renamed `toggleGit`.
  - **Status bar:** when the active tab's folder is a repo, the branch chip toggles the panel. Otherwise, with sync on, a plain "Git" button sits in the same place. Both look pressed while the panel is open (`aria-pressed`, `bg-row-sel`, accent icon), like the Ask button.
  - Anything that called `showGitFor(folder)` now opens the panel on that folder.
- **Focus:** closing the panel gives the keyboard back to the editor, as Ask does.
- **Library sidebar:**
  - It goes back to Files only. `SidebarViewSwitch` and the Files/Git branch in `Sidebar.tsx` are removed, and so is `SidebarState.view`.
  - An old session that still holds `view` loads fine, because the field is ignored.
  - The clone placeholder stays in the Library tree.
  - "Add folder from git…" in the Git panel still starts the clone. It opens the Library sidebar so the progress row is visible.
- **The amber dot (uncommitted changes)** moves from the view switch to the status-bar Git entry.
- **DESIGN.md:** the Git view entry is updated to say it lives in the right panel.

## Left to the builder

- Test updates: the sidebar switch tests are removed or moved, and panel, status bar and shortcut tests are added.
- The browser preview mocks.
