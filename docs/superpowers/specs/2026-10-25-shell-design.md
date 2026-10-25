# Zukai — First slice: the Shell

Date: 2026-10-25
Status: Draft, waiting for approval

Background reading: [`docs/vision.md`](../../vision.md), the glossary [`CONTEXT.md`](../../../CONTEXT.md), and the ADRs in [`docs/adr/`](../../adr/). Terms in **bold capitals** (Tab, Scratchpad, Session…) mean exactly what the glossary says.

## 1. Intent

Zukai is a fast, quiet desktop scratchpad meant to replace Notepad++ for quick work, and later to add an Excalidraw canvas and a CSV table. This first slice is the **shell**: the window, Tabs, a good text editor with good search, and saving that never loses anything. It's the base everything else plugs into, and it should already be pleasant to use every day for quick notes and snippets.

The owner's words for what matters most: **fast, simple, modern UI, and a good search** (meaning find inside the text you're looking at, with Enter moving to the next match).

This is the first half of milestone M1 in [ADR 0010](../../adr/0010-v1-milestone-order.md). The second half (opening Files from disk, Disk conflicts, Encoding and Line endings) comes next in its own slice.

## 2. Goals

1. A Tauri 2 desktop app that builds and runs on Windows, macOS and Linux, with CI on all three from the first commit.
2. Window layout **B**: the operating system's own title bar and window controls, Zukai's tab bar under it, the editor filling the rest, and a thin status bar at the bottom.
3. The **Paper** look (section 6) in light and dark, following the OS setting.
4. Tabs that only hold **Text Scratchpads**: create, switch, rename, reorder, close, and reopen the most recently closed.
5. A CodeMirror 6 editor with syntax highlighting and the find bar described in section 5.
6. Scratchpads autosaved continuously to plain files, and the Session restored after a restart, so the user never loses text.

## 3. Non-goals for this slice

All of these are planned and come in later slices, so the design must leave room for them without building them now:

- Opening or saving Files on disk, Save As, Disk changes and conflicts, Encoding and Line ending detection (next slice). Scratchpads are always UTF-8.
- Canvas (Excalidraw), Table (CSV), Split, Compare.
- Settings UI and `settings.json`. In this slice the theme just follows the OS.
- Command palette, line operations, column selection and other Notepad++ editing extras (M2).
- Persistent Undo history and Snapshots (M2). Undo works within the running session only.
- Huge Files, Quick capture, Background mode, single-instance handling, file associations.
- Installers, code signing, notarization and auto-update. CI produces unsigned builds only.

The only part of single-instance handling that _is_ in this slice is described in 5.6.

## 4. Anti-goals

These would count as failure even if everything else works:

- **Losing typed text.** Not on crash, quit, closing a Tab, or power loss beyond the last fraction of a second.
- **Feeling slow.** A visible startup delay, any lag while typing, or a new Tab that doesn't appear instantly.
- **Clutter.** Sidebars, toolbars, ribbons, big buttons, or decorative animation.
- **A generic look.** Blue-gray "developer tool" styling or neon syntax colors instead of the warm Paper look.

## 5. Behavior

### 5.1 Window and layout (B)

- The operating system's own window frame and title bar (no custom frame). The title shows `<Tab title> — Zukai`.
- **Tab bar** directly under the title bar: compact, the same color as the window chrome, with no line between it and the editor.
- **Editor** fills the rest. There are no sidebars or toolbars.
- **Status bar** at the bottom, thin, with muted text: `Ln X, Col Y` on the left, and the Language on the right. The Language is clickable and opens a small searchable list to change it. Encoding and Line ending aren't shown yet, because every Scratchpad is UTF-8 in this slice.
- The window's size, position and maximized state are restored on next launch.

### 5.2 Tabs

- **Launching** restores the previous Session. On the very first launch there is one empty Text Scratchpad.
- **Mod+N** or the `+` button creates a new Text Scratchpad Tab right after the current one and focuses its editor immediately. It takes no dialog and no choice.
- **Switching:** click a Tab; Ctrl+Tab and Ctrl+Shift+Tab cycle in tab-bar order; Mod+1 to Mod+8 jump to that position, and Mod+9 jumps to the last Tab.
- **Reorder** by dragging Tabs.
- **Titles** follow the glossary's Title rule. An unrenamed Scratchpad shows its first non-empty line, cut to about 30 characters, or "Untitled" when empty. Double-clicking a Tab renames it inline: Enter confirms, Esc cancels, and an empty name goes back to the automatic title. A renamed title sticks.
- **Closing:** Mod+W, middle-click, or the × that appears on hover and on the active Tab. There is never a confirmation.
  - An empty Scratchpad is deleted at once.
  - A non-empty Scratchpad goes to **Recently Closed**. **Mod+Shift+T** reopens the most recently closed one in its old position. Closed Scratchpads are deleted for good after 30 days. The list menu for Recently Closed comes in a later slice; this slice only needs Mod+Shift+T.
  - Closing the last Tab leaves one new empty Scratchpad, so the window is never empty. Closing the window quits the app, because Background mode doesn't exist yet.
- **Many Tabs:** Tabs shrink to a minimum width, and past that the tab bar scrolls horizontally (mouse wheel scrolls it). The active Tab is always scrolled into view.

### 5.3 Editor

CodeMirror 6 ([ADR 0003](../../adr/0003-codemirror-6-for-text.md)), configured as a plain, fast text editor:

- Line numbers in a quiet gutter, highlighting of the current line, bracket matching, auto-indent, multiple cursors (Mod+D adds the next occurrence), and the standard editing keys.
- Word wrap is off by default. Alt+Z toggles it for the current Tab, and the setting is remembered in the Session.
- **Syntax highlighting** for at least: plain text, Markdown, JSON, JavaScript, TypeScript, HTML, XML, CSS, SQL, Python, YAML, and shell. Language support beyond plain text loads only when first used, to keep startup fast.
- **Language guessing:** a Scratchpad starts as plain text. On the first paste, or after its first few lines are typed, Zukai guesses the Language from the content (for example, valid JSON becomes JSON, and text that starts with `<` and has tags becomes XML or HTML). A wrong guess is fixed from the status bar. Once the user picks a Language by hand, Zukai never guesses again for that Tab. The guessing method is the builder's call, but it must be cheap and conservative: when unsure, stay plain text.

### 5.4 Find bar ("a good search")

Approved from the mockup:

- **Mod+F** opens a small floating bar at the top right of the editor. If text is selected, it's filled in. Otherwise the last search term is filled in and selected.
- **As you type**, every match is highlighted, the current match is emphasized, and the bar shows a count like `3 of 12` (or `No results`).
- **Enter** jumps to the next match and **Shift+Enter** to the previous one. Both wrap around at the end, and the editor scrolls the match into view.
- **Toggles:** Match case, Whole word, and Regex, each with a keyboard shortcut (Alt+C, Alt+W, Alt+R as in VS Code). An invalid regex turns the input red, with no error popup.
- **Replace:** Mod+H (Mod+Alt+F on macOS, because Cmd+H hides the app) opens the same bar with a Replace row: Replace (Enter in the replace field) and Replace All. Replace All is a single step that one undo reverses.
- **F3 / Shift+F3** go to the next or previous match even after the bar is closed.
- **Esc** closes the bar, returns focus to the editor, and leaves the current match selected.
- Each Tab remembers its own search term and toggle state for the session.
- It uses CodeMirror's search engine (`@codemirror/search`) under our own bar UI, not CodeMirror's default panel.

### 5.5 Saving and Session

Following [ADR 0005](../../adr/0005-scratchpads-as-plain-files.md):

- Each Text Scratchpad is a plain UTF-8 file at `<app data>/scratchpads/<id>.txt`, containing exactly what the user typed. `<app data>` comes from Tauri's path API, never a hard-coded path.
- **Autosave** writes a Scratchpad shortly after typing stops (a short debounce of a few hundred milliseconds), and immediately when the window loses focus, when a Tab is closed, and when the app quits.
- **Every write is atomic:** write a temporary file in the same folder, flush it, then rename it over the real one. A crash leaves either the old version or the new one, never a half-written file.
- **`session.json`** holds the Session: Tab order, the active Tab, each Tab's id, Title (and whether it's renamed), Language (and whether it was picked by hand), cursor and selection, scroll position, word-wrap state, and window size and position. It's written with the same atomic method, debounced.
- **Recently Closed** Scratchpads move to `<app data>/closed/`, and their Session entry moves to a closed list inside `session.json`. Items older than 30 days are deleted on launch.
- **Restore on launch:** read `session.json`, reopen Tabs in order, put back cursor, scroll and the active Tab. If `session.json` is missing or unreadable, Zukai must not lose notes: any Scratchpad files in `scratchpads/` that aren't in the Session are reopened as Tabs.

### 5.6 One running copy, and where data lives _(builder-check calls)_

- **Only one copy of Zukai runs at a time.** Launching it again just focuses the existing window. This uses Tauri's single-instance plugin, which is needed later for `zukai --capture` anyway. Two copies writing the same Scratchpads and `session.json` would lose text, so this can't wait. _(My call.)_
- **The data folder is named `Zukai`** inside the operating system's per-user app data location, taken from Tauri's path API (`%APPDATA%\Zukai\` on Windows, `~/Library/Application Support/Zukai/` on macOS, `~/.local/share/Zukai/` on Linux). It deliberately does **not** follow the bundle identifier, so the identifier can change later without moving users' notes. _(My call.)_
- **Zukai owns the Scratchpad files.** People may read, grep or back them up while Zukai runs, but an outside edit made while that Scratchpad is open in Zukai may be overwritten by the next autosave. On launch, the file on disk is always what gets loaded. Detecting outside edits applies only to Files, in the next slice. _(My call.)_

## 6. Look: "Paper"

Chosen from the mockups: Notion-like, warm and soft.

- **Palette tokens** are defined once as CSS variables and used through Tailwind v4. CodeMirror's theme reads the same variables, so the editor and the shell always match. Starting values (the builder may refine them, keeping them warm and neutral):

| Token | Light | Dark |
|---|---|---|
| editor background | `#ffffff` | `#191919` |
| chrome (tab bar, status bar) | `#f7f6f3` | `#202020` |
| active tab / floating surfaces | `#ffffff` | `#2c2c2c` |
| hairline (used rarely) | `#ebeae6` | `#2a2a2a` |
| text | `#37352f` | `#e6e3de` |
| muted text | `#787774` | `#9b9893` |
| faint text (gutter, status) | `#b4b3af` | `#5f5d59` |
| accent (selection, current match, focus ring) | soft blue, Notion-like | soft blue, Notion-like |

- **Almost no borders.** The tab bar sits flush against the editor. The active Tab and floating pieces (the find bar, the Language list) lift off with a soft shadow, not an outline.
- **Corners:** about 6 px for Tabs and 8 px for floating surfaces.
- **Type:** Inter for the interface (small, relaxed spacing) and JetBrains Mono for the editor. Both are bundled with the app, so no network is needed.
- **Syntax colors** are muted and warm, like Notion's code blocks.
- **Theme** follows the OS light or dark setting and switches live without reloading the editor.
- **Motion:** only a quick fade when floating pieces appear. There are no other animations.
- **Solid chrome**, with no see-through effects, so all three platforms look the same.

## 7. Keyboard shortcuts in this slice

`Mod` = Ctrl on Windows and Linux, Cmd on macOS.

| Action | Shortcut |
|---|---|
| New Tab (Text Scratchpad) | Mod+N |
| Close Tab | Mod+W |
| Reopen closed Tab | Mod+Shift+T |
| Next / previous Tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Go to Tab 1–8 / last | Mod+1…8 / Mod+9 |
| Find | Mod+F |
| Replace | Mod+H (Mod+Alt+F on macOS) |
| Next / previous match | Enter / Shift+Enter in the bar; F3 / Shift+F3 anywhere |
| Toggle word wrap | Alt+Z |
| Add next occurrence to selection | Mod+D |
| Quit | Mod+Q |

## 8. Constraints

- Bundle identifier: **`io.github.peota.zukai`** (the owner's choice, permanent).
- Stack, already decided: Tauri 2 ([ADR 0002](../../adr/0002-tauri-shell-with-embedded-excalidraw.md)), React and TypeScript, CodeMirror 6 ([ADR 0003](../../adr/0003-codemirror-6-for-text.md)), Tailwind v4.
- Tooling (my call, approved by the owner): pnpm, Vite, Vitest, ESLint and Prettier, Clippy and rustfmt, GitHub Actions.
- Windows, macOS and Linux from day one ([ADR 0006](../../adr/0006-v1-ships-on-all-three-platforms.md)). CI runs lint, type-check, tests and an unsigned `tauri build` on all three.
- File reads and writes happen on the Rust side. The web UI never touches the file system directly.
- Excalidraw is not part of this slice and must not be in the startup bundle when it arrives later ([ADR 0002](../../adr/0002-tauri-shell-with-embedded-excalidraw.md)).
- Speed targets for the builder to measure against: the window shows restored Tabs within about 1 second of launch on an ordinary laptop, a new Tab appears within one frame, and typing never visibly lags.

## 9. Built to grow

These later features will plug into the shell, so the structure should expect them, without building them now:

- A Tab will later hold a File as well as a Scratchpad, and other Kinds (Canvas, Table). The Tab and Document model and the storage layer should not assume "always a Text Scratchpad."
- A Split will pair two Tabs into one joined tab.
- The status bar will gain Encoding, Line ending and Delimiter.
- Snapshots and persistent Undo history will hook into saving.

## 10. Left to the builder

- Code structure, state management, and how responsibilities are split between Rust and the UI.
- The format for Scratchpad ids, the exact debounce times, and the `session.json` schema (versioned, so later slices can migrate it).
- How Language guessing works, within the rules in 5.3.
- Which Tauri plugins and React libraries to use, beyond the stack above.
- The test strategy, which must at least cover atomic writes, Session restore (including a missing or corrupt `session.json`), the Recently Closed rules, and Title derivation.
- Exact visual values, within the Paper description and palette.
