# Zukai — Terminal

Date: 2026-11-20
Status: Approved 2026-11-20

Background reading: [`PRODUCT.md`](../../../PRODUCT.md), the glossary [`CONTEXT.md`](../../../CONTEXT.md) (**Library**, **Tab**, **Split**), [ADR 0006](../../adr/0006-v1-ships-on-all-three-platforms.md) (all three platforms) and [ADR 0011](../../adr/0011-library-sidebar.md) (Library sidebar).

## 1. Intent

Zukai is an engineer's notebook, and the owner wants to run commands from it in the folder they're working in, without switching windows. Examples are `npm install` in a project folder, or a command left running in the background, like a dev server or a watcher. The model is VS Code's integrated terminal: a panel along the bottom of the window that can hold several terminals, each opened in a folder.

This slightly stretches "stay a notebook, not a platform." The owner chose it on purpose: running a command is part of the material an engineer works with. The terminal must still respect the other principles. It stays out of the way until asked for, it doesn't slow down launch, and it never leaves anything running after Zukai quits.

## 2. Decisions (owner, 2026-11-20)

1. It's a **real embedded terminal**, not a launcher for the system terminal app.
2. **Several terminals, VS Code style.** Each "Open in terminal" adds a new terminal, and the panel has a small strip of terminal tabs to switch between them and close them. A busy terminal (a dev server) never blocks opening another one.
3. It's built as **a PTY in Rust (`portable-pty`) plus xterm.js in the UI**, wired up by Zukai itself. The rejected alternatives are listed in section 9.
4. **The panel can sit at the bottom or to the side** of the editor, and the user switches between the two.

## 3. Goals, non-goals, anti-goals

**Goals**

- Open a terminal in any Library folder in one action, and run real shell commands there with colors, interactive prompts, Ctrl+C and full-screen programs (`vim`, `htop`, `less`).
- Keep several terminals open, with long-running ones staying alive in the background while you do other things, including while the panel is hidden.
- Work the same on Windows, macOS and Linux.

**Non-goals (for this slice)**

- Bringing terminals back after a restart. Quitting ends them, as in a plain terminal app.
- Split terminals within the panel, or terminals moved into the editor area as Tabs.
- Find in terminal output, shell integration (command markers, cwd tracking), and clickable file paths. Clickable URLs are in scope.
- Choosing a shell or a shell profile in Settings. The shell is picked automatically (section 5).
- Running a file ("Run this script") from the editor.

**Anti-goals: failures even if the terminal works**

- Launch gets slower. xterm.js must not be in the startup bundle.
- A process outlives Zukai, or is left orphaned when a terminal closes.
- The terminal swallows the keys an app shortcut needs, or the app steals keys the shell needs. On Windows and Linux, Ctrl+P, Ctrl+N, Ctrl+W, Ctrl+R and Ctrl+B are shell keys.
- On macOS, the terminal can't find `npm` or `node` because Zukai was started from Finder with a bare PATH.
- Heavy, IDE-like chrome. The panel follows the same restrained look as the tab bar and status bar.

## 4. Behaviour

**Opening**

- **Open in terminal** is a new item in the right-click menus for:
  - a Library folder entry
  - the Library root
  - an added folder's heading (when it's available)

  It sits next to "Show in Explorer / Finder." Each choice opens a **new** terminal in that folder, shows the panel and focuses the new terminal.
- **Ctrl+`** (the physical Backquote key, on every platform, as in VS Code) toggles the panel:
  - Hidden with terminals open: it shows the panel and focuses the active terminal.
  - Shown: it hides the panel (the terminals keep running) and returns focus to the editor.
  - Hidden with no terminals: it opens one in the **default folder**.
- **Ctrl+Shift+`** always opens a new terminal in the default folder.
- The **default folder** is the folder of the active Tab's File, when that File is inside a granted Library folder. Otherwise it's the Library root, and failing that, the first available added folder. If none of these exists (no Library root, or the root's drive is unplugged), no terminal opens. The status bar briefly shows "Choose a Library folder to open a terminal." The home folder is never used as a fallback, because terminals open only in granted folders. *(Builder's call.)*
- The panel's **+** button opens a new terminal in the active terminal's starting folder. If that folder is no longer granted or no longer exists, it uses the default folder instead.
- **A terminal that's already open isn't touched when its folder stops being granted**, for example when the folder is removed from the sidebar, the Library root is switched, or the folder is renamed or deleted. The grant check guards opening a terminal. Once a shell is running it can `cd` anywhere anyway, so closing it would only lose the user's work. *(Builder's call.)*
- Ctrl+` and Ctrl+Shift+` go in the Shortcuts list in Settings.

**The panel**

- **The panel has two positions:**
  - **Bottom (the default):** it sits under the editor area and above the status bar, across the workspace's width (not under the sidebar), as in VS Code. Its height can be changed by dragging the top edge, within 120 px to 70% of the window.
  - **Side:** it sits to the right of the editor area, under the tab bar and above the status bar, so the tab bar keeps its full width. Its width can be changed by dragging the left edge, within 240 px to 70% of the workspace.

  The position, the bottom height and the side width are all remembered in Settings (`terminalPosition`, `terminalHeight`, `terminalWidth`), like `previewSplit`. Each position keeps its own size, so switching back and forth doesn't lose either one. *(Builder's call: the right-hand side only, since the left is the sidebar's.)*
- **Switching position:** a button in the panel header toggles between bottom and side. Its icon shows where the panel will move to, and its tooltip says "Move to side" or "Move to bottom". Switching keeps every terminal running with its scrollback intact; each one is just re-fitted to its new size. *(Builder's call: no shortcut or Settings entry for it in this slice; the header button is enough.)*
- The header is one slim row in both positions:
  - on the left, the terminal tabs, which scroll sideways when they don't fit in the side position
  - on the right, **+** (new terminal), **trash** (kill the active terminal), **position** (bottom or side) and **chevron** (hide the panel)

  The header uses the existing chrome tokens and icon buttons.
- Each terminal tab shows the name of the folder it opened in (`zukai`, `docs`). Two tabs with the same name get a muted parent folder added (`docs · zukai`). Middle-click or the tab's × kills that terminal.
- When the last terminal is killed, the panel hides.
- Whether the panel is shown isn't remembered across a restart. Terminals don't come back, so the panel starts hidden.

**A terminal's life**

- When a terminal is killed (×, the trash button or middle-click), its whole process tree ends right away. There's no "are you sure?" prompt, matching VS Code's default.
- When the shell exits by itself (`exit`, or a crash), the tab stays and a dim line is printed: `Process exited with code N`. Its tab title is dimmed. Pressing any key in it, or clicking ×, closes it.
- Quitting Zukai kills every terminal's process tree as part of the existing exit flow, without asking.

**Inside a terminal**

- Text selection, copy and paste:
  - **Windows and Linux:**
    - Ctrl+Shift+C copies and Ctrl+Shift+V pastes.
    - Ctrl+C copies when there's a selection, and otherwise sends interrupt (Windows Terminal behaviour).
    - Ctrl+V pastes.
    - Right-click pastes when nothing is selected, and copies when something is.
  - **macOS:** Cmd+C and Cmd+V.
- URLs in the output are clickable and open through the existing `open_url` command.
- It uses the editor's monospace font (JetBrains Mono, bundled) and follows the editor's text size, including Mod+= and Mod+-.
- Colors come from the current theme and change live with it: background, foreground, cursor, selection and the 16 ANSI colors. Each theme gets an ANSI palette that fits it.

**Which keys reach the shell**

While a terminal has focus, every key goes to the shell except this short list, which goes to Zukai:

- Ctrl+` and Ctrl+Shift+`
- Ctrl+Tab and Ctrl+Shift+Tab (switching Tabs)
- the copy and paste keys above
- Mod+=, Mod+- and Mod+0 (text size), Mod+, (Settings) and Mod+Q (Quit), as in VS Code. In a shell, these Ctrl keys are rarely used or do nothing. *(Builder's call.)*
- **macOS only:** every Cmd shortcut (Cmd never means anything to a shell)

On Windows and Linux, the other Ctrl shortcuts (Ctrl+N, Ctrl+W, Ctrl+P, Ctrl+B and so on) go to the shell. That's how VS Code and every terminal app behave, and it's why the shell keys listed in the anti-goals keep working.

## 5. How it works

**Rust side** (a new `terminal` module next to `files` and `library`)

- `portable-pty` gives a PTY on every platform: ConPTY on Windows (10 1809 or later, which Tauri 2 needs anyway) and the native PTY on macOS and Linux.
- **The shell:**
  - **Windows:** `pwsh.exe` if it's on PATH, otherwise `powershell.exe`, otherwise `%COMSPEC%`.
  - **macOS and Linux:** `$SHELL`, then the user's login shell from the passwd entry, then `/bin/zsh` on macOS or `/bin/bash` on Linux, then `/bin/sh`. It's started as a **login shell** (`-l`), so PATH comes from the user's profile. This is what fixes the macOS PATH problem in the anti-goals.
- **The environment** is inherited from Zukai, plus `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=zukai` and `TERM_PROGRAM_VERSION`.
- **The folder must pass the same grant check** as other Library commands: a granted root, or a folder inside one, with links resolved as `reveal_target` does. The UI can only ask for a terminal in a folder Zukai already shows. It never passes a command line. Zukai only ever starts the shell.
- **Commands:**
  - `terminal_open(cwd, cols, rows, channel) -> id`
  - `terminal_write(id, data)`
  - `terminal_resize(id, cols, rows)`
  - `terminal_kill(id)`
- Output goes from a reader thread for each terminal to the UI over a `tauri::ipc::Channel` as raw bytes. It's batched (about every 8 ms, or every 64 KB) so a noisy build doesn't flood the IPC.
- When the shell exits, an exit message with the code is sent on the same channel.
- Terminals live in managed state (`Terminals`, a map from id to PTY, child process and writer).
- **Killing a terminal ends the whole tree:**
  - **Windows:** each shell is put in a Job Object with kill-on-close.
  - **Unix:** the shell leads its own session. On a kill, Zukai collects **every descendant** of the shell, not just its process group, because an interactive shell puts each job in its own group. On Linux it reads `/proc`; on macOS it uses the system process list, for example with the `sysinfo` crate. Each one gets SIGHUP, and after a short grace period anything still alive gets SIGKILL. *(Builder's call.)*
  - **Accepted limits on Unix:** a process that deliberately left the tree (double-forked, or reparented to init) survives, as it would in any terminal app. If Zukai crashes or is force-quit, its terminals' processes aren't cleaned up. Windows covers both through the Job Object.
- The exit path in `lib.rs` (`app_exit_after_flush` and the watchdog) kills every terminal before `app.exit`.

**UI side**

- A new `src/terminal/` area holds the panel, the tab strip and an xterm.js host. It also holds a small `useTerminals` state hook for the list, the active id, panel shown/hidden and the exited flags.
- The panel component and xterm.js (`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`) are **lazy-loaded** the first time a terminal opens, the same way `CanvasHost` loads Excalidraw. Nothing terminal-related loads at startup.
- Each xterm instance stays mounted while it exists, including while the panel is hidden or another terminal is active, so scrollback and background output are kept. Hidden ones use `display: none`. The fit addon re-fits when one is shown again and on panel resize, and the new size is sent with `terminal_resize`.
- Scrollback is 5,000 lines.
- `Settings` gains `terminalPosition` (`"bottom" | "side"`, default `"bottom"`), `terminalHeight` and `terminalWidth` (px, clamped). The xterm instances must stay mounted when the position changes, so the panel is moved with CSS (for example by switching the workspace's flex direction), not remounted into a different parent. Theme ANSI palettes sit next to the existing theme tokens.
- New `Command` types: `toggleTerminal` and `newTerminal`, in `shortcuts.ts`. The key-routing rule above is put in xterm's custom key handler.
- The CSP needs no changes. xterm.js's DOM and canvas renderers use only inline styles, which are already allowed. The WebGL renderer isn't used.
- Words for `CONTEXT.md`: **Terminal** (one shell session opened in a folder) and **Terminal panel** (the bottom panel holding them).

## 6. Constraints

- **Platforms:** Windows, macOS and Linux all ship (ADR 0006). All three must be tried by hand, especially the macOS PATH and the process-tree cleanup on each OS.
- **Launch time:** no terminal code in the startup bundle. The `portable-pty` crate is linked in, but it does nothing until a terminal opens.
- **Fonts and assets** ship with the app. No CDN.
- **Security:** the grant check on the folder, the shell only, and no command passed from the UI. Commands from a terminal run as the user, as in any terminal. That's the point.

## 7. Testing

- **Rust:**
  - unit tests for choosing the shell (fed a fake PATH and env)
  - the folder grant check (allowed, outside a root, a link escaping a root)
  - an integration test that opens a terminal, writes `echo hi` and an exit, and reads `hi` and an exit code back
  - a test that killing a terminal also ends a child it started
- **UI (vitest):**
  - `useTerminals` state: open, kill, last-one-hides, exited
  - switching position keeps the terminals and their xterm instances (not remounted), and each position remembers its own size
  - the tab-name rule for same-named folders
  - the key-routing rule per platform
  - the new shortcuts
  - the folder menus showing "Open in terminal"
- **By hand on each OS:**
  - `npm install` in a project folder
  - a dev server left running while the panel is hidden
  - `vim` and Ctrl+C
  - quitting with a server running, then checking that no `node` process is left

## 8. Left to the builder

These are the builder's call, and none of them change what the owner sees in a meaningful way:

- the exact batching numbers, scrollback length and minimum panel height
- the ANSI palette values for each theme, as long as each reads well and matches its theme
- how the reader thread and the channel are structured, and the exact error shapes, following `FileError`
- whether the exited-terminal message is printed by Rust or by the UI
- the panel resize handle's look, matching the Split divider

## 9. Approaches considered

1. **A PTY in Rust (`portable-pty`) plus xterm.js, wired up by Zukai. Chosen.** It's the standard pairing (VS Code uses the same design) and Zukai controls the grant check, process cleanup and quit. It costs a few hundred lines of Rust.
2. **A community Tauri plugin (`tauri-plugin-pty`) plus xterm.js.** It's less code, but it's a small third-party plugin. It could hold back Tauri upgrades, and it skips Zukai's folder checks.
3. **A plain child process with piped output (no PTY).** It's the lightest, but it isn't a real terminal. Colors, interactive prompts like npm's, Ctrl+C and full-screen programs break. Rejected.

A launcher that opens the system terminal app in a folder was also considered, and set aside because the owner wants to stay inside Zukai.
