# Zukai — Agents (replacing Ask)

Date: 2026-11-24
Status: Approved 2026-11-24

Background reading: [`PRODUCT.md`](../../../PRODUCT.md), [`CONTEXT.md`](../../../CONTEXT.md) (**Terminal**, **Terminal panel**, **Ask**), the [Terminal design](2026-11-20-terminal-design.md) and [ADR 0013](../../adr/0013-ask-with-the-users-own-key.md) (Ask).

## 1. Intent

Ask, Zukai's built-in AI panel, isn't useful in practice, and the owner wants to remove it. Engineers already have capable AI coding agents in the terminal, like Claude Code, Codex, Gemini CLI, OpenCode and Cursor's agent. Zukai shouldn't compete with them. It should start them where the user is working. The model is Herdr's "+" menu: **Terminal**, then a **Start an agent** list, with agents that aren't installed shown dimmed.

An agent starts in **the folder of the note the user is on**. This is the Terminal's existing default-folder rule, so an agent is simply a Terminal that runs an agent CLI instead of a bare prompt.

This replaces ADR 0013. Zukai stops being an AI client. It no longer stores keys, calls providers or runs tools for a model. The agent the user already trusts does all of that.

## 2. Decisions (owner, 2026-11-24)

1. **Ask is removed entirely**, not hidden behind a setting.
2. **Agents run in the Terminal panel**, opened from a Herdr-style menu that lists known agents and dims the ones that aren't installed.
3. **An agent starts in the folder of the note the user is on**, which is the Terminal's default folder.
4. **The agent is run by the user's normal shell** (approach 1 in section 9). Zukai starts the same login shell a Terminal uses and has it run the agent. When the agent quits, the tab is left at a shell prompt in that folder.

## 3. Goals, non-goals, anti-goals

**Goals**

- Start any installed agent in the current note's folder in one action, from the keyboard or the mouse.
- See at a glance which agents are installed.
- Remove every trace of Ask: the panel, shortcut, status-bar button, Settings section, Rust module, crates and docs.

**Non-goals**

- Telling the agent which note or selection is open. It gets the folder, not the file. *(Owner, 2026-11-24.)*
- Installing agents, signing in to them, or configuring their models or keys. That stays in each agent's own CLI.
- A user-editable list of agents or custom commands, in Settings or anywhere else. The list is fixed in the app (see section 6).
- Agent-specific UI, like showing what the agent is doing, its token use or its diffs. An agent tab is a Terminal.
- Restoring agent sessions after a restart. Like Terminals, they end on quit.
- Agents as editor Tabs, or anywhere other than the Terminal panel.

**Anti-goals: failures even if it works**

- The menu says an agent is installed but starting it fails with "command not found", or the reverse. Detection and launch must look at the same PATH.
- The UI can make Zukai run an arbitrary command line. Only agents from the fixed list can start.
- Opening the menu stalls the UI while Zukai looks for agents.
- Ask leftovers, like dead settings, an unused crate, a keychain entry nobody can see or a stale glossary entry.
- Heavier chrome. The menu is a small popover in the existing menu style, not a launcher screen.

## 4. Behaviour

**The agent list** (fixed, in this order)

| Name in the menu | Command |
|---|---|
| Claude Code | `claude` |
| Codex | `codex` |
| Gemini | `gemini` |
| OpenCode | `opencode` |
| Cursor | `cursor-agent` |

*(Builder's call: these five, which are the widely used terminal agents with a stable command name. Adding one later is a one-line change in Rust plus its label.)*

**The New terminal menu**

- The Terminal panel header's **+** gets a small chevron beside it, matching the Tab bar's + menu (commit `1c7830d`). The + itself still opens a plain Terminal straight away, and the chevron opens the menu. *(Builder's call: this keeps the existing one-click behaviour of + and mirrors the Tab bar.)*
- The menu, from top to bottom:
  - **Terminal**, with its shortcut shown (Ctrl+Shift+`)
  - a muted heading, **Start an agent**
  - one row per agent. Installed agents come first, in table order, with **1** to **9** shown at the right as in-menu keys. Agents that aren't installed come after them, dimmed and disabled, with **not installed** at the right.
- In the menu, the arrow keys and Enter work as in the other menus, a digit starts that agent, and Escape closes it.
- Each row shows the agent's own logo at 16 px, as in Herdr's menu *(owner, 2026-11-24, replacing the earlier letter marks)*. The logos are inline SVGs from Simple Icons (CC0), bundled with the app. Claude Code keeps its brand orange, and the others follow the text colour, so they read on every theme. Codex has no mark there, so it keeps a letter in a rounded square. The Terminal row shows the terminal icon.

**Opening the menu when the panel is hidden**

- **Mod+J** opens the same menu, anchored above the status bar's right end. Mod+J was Ask's key, so muscle memory carries over. *(Builder's call.)*
- The status bar's **Ask** button is replaced by an **Agent** button in the same place, which opens the same menu. *(Builder's call: the button and Mod+J always show, since agents don't depend on any setup in Zukai.)*
- With a Terminal focused, Mod+J goes to the shell on Windows and Linux, as Ctrl+J did before (see the Terminal design's key rule). Use the + chevron there. On macOS, Cmd+J reaches Zukai.
- "Start agent menu" (Mod+J) is in the Shortcuts list in Settings, in place of "Toggle Ask panel".

**Starting an agent**

- Choosing an agent opens a **new** Terminal in the default folder, the same way Ctrl+Shift+` does. That's the active Tab's File's folder if it's in a granted folder, otherwise the Library root, otherwise the first available added folder. It shows the panel and focuses the new tab. If no folder qualifies, the status bar shows the same message as for a Terminal, "Choose a Library folder to open a terminal."
- When the menu is opened from the panel's + chevron, the folder is the active Terminal's starting folder, falling back to the default folder, which is the existing rule for +.
- The tab's label is the agent's name and the folder (`Claude Code · docs`). The existing same-name rule adds the parent folder when two tabs collide. *(Builder's call.)*
- When the agent quits, the user is at an interactive shell prompt in the same tab and folder. The label stays the same. *(Builder's call: the tab doesn't track what's running, as with any Terminal.)*
- If the agent was uninstalled after the menu was drawn, the shell prints its own "not found" error and leaves the prompt. Zukai adds nothing.
- Everything else is the Terminal's existing behaviour, including killing, process-tree cleanup, key routing, copy and paste, theme colours, quitting and not being restored.

**Detecting installed agents**

- Zukai asks **the same shell, started the same way as a launch**, whether each command exists. That way detection sees everything a launch would, including PATH lines in `.zshrc`/`.bashrc` (nvm, fnm, volta, npm globals) and aliases such as Claude Code's `alias claude=…`.
  - **macOS and Linux:** Zukai runs `<shell> -l -i -c '…'` once for all agents. It checks each one with `command -v` (in fish, `type -q`) and prints one line per found agent, behind a unique marker, so that rc-file noise (banners, oh-my-zsh) is ignored. It runs with a time limit of a few seconds. On failure or timeout, it falls back to searching Zukai's own PATH. *(Builder's call: the exact script, and whether it needs a PTY to behave interactively.)*
  - **Windows:** Zukai searches its own PATH, which is already the user's full PATH. Only `.exe`, `.cmd` and `.bat` count. A `.ps1` alone doesn't, because the execution policy usually blocks it (see Launch below).
- The check runs off the UI thread on **every** menu opening. The menu draws straight away from the last result and updates in place. Before the first result, the agent rows show a quiet placeholder state rather than "not installed".
- **Installing an agent while Zukai is open:**
  - **macOS and Linux:** it shows up on the next menu opening, including installers that add a PATH folder through the profile, because the shell is asked afresh each time.
  - **Windows:** Zukai's environment doesn't see registry PATH changes, so an agent whose installer added a new PATH folder appears only after Zukai restarts. A plain Terminal behaves the same way. *(Builder's call: re-reading the registry PATH would change how every Terminal starts, which is out of scope. VS Code has the same limit.)*

**Ask is removed**

- The UI loses:
  - the Ask panel and its CSS
  - `useAsk`, the Ask button, the `toggleAsk` command and the `askWidth` setting
  - the AI section of Settings (`AiSettings`), along with "Excluded from Ask"
- Rust loses the `ai` module, its seven commands, the `Asks` state and its cancel on exit, plus the `keyring` and `ureq` crates if nothing else uses them.
- **Leftover data:** no migration code. Ask never shipped beyond the owner's machine *(owner, 2026-11-24)*.
  - The owner removes their key in Settings → AI before updating, or deletes the `zukai` keychain entry by hand.
  - A stray `ai.json` in the app data folder is ignored.
  - `askWidth` in `settings.json` is ignored and dropped on the next save, as unknown keys already are.
  - Ask history was never built (ADR 0013's "Short history"), so there's nothing to clean up.

## 5. How it works

**Rust** (in the `terminal` module)

- `agents.rs` holds the fixed list: an id (`claude-code`, `codex`, `gemini`, `opencode`, `cursor`), a display name and a command name.
- `terminal_agents() -> Vec<{ id, name, installed }>` does the detection described above. The shell's PATH is cached in managed state.
- `terminal_open` gains an optional `agent: Option<String>` (an id). Rust looks up the command. **An unknown id is an error.** The UI never sends a command string, which keeps the Terminal design's rule that the UI can't run arbitrary commands, widened only by this fixed list.
- How the shell runs the agent, then stays:
  - **pwsh / powershell.exe:** `-NoExit -Command <cmd>`
  - **cmd.exe:** `/K <cmd>`
  - **Unix:** `-l -i -c '<cmd>; exec "<shell>" -l'`. This runs the agent in a login, interactive shell (so PATH and aliases match), then replaces itself with a fresh login shell at the prompt.

  Command names are fixed identifiers, so there's no quoting of user input.
- **Windows and PowerShell's execution policy:** npm installs `claude.ps1` next to `claude.cmd`. Under `-Command claude`, PowerShell would choose the `.ps1`, which the default policy blocks. So on Windows, Rust passes the name of the file that detection found, with its extension (for example `claude.cmd`). The extension is from the fixed set `.exe`, `.cmd`, `.bat`. Zukai never passes `-ExecutionPolicy Bypass`, because it doesn't override the user's or IT's security settings. *(Builder's call on the exact flags, as long as the behaviour in section 4 holds on every shell `pick_shell` can return, and fish's `-c` and exec work.)*
- The process stays the shell, so the Job Object, the process-tree kill and the quit flow cover agents unchanged.

**UI**

- `src/terminal/` gains the agent menu, used by both the panel's + chevron and the status bar's Agent button, and `useTerminals.open` gains an optional agent id.
- The agent list is fetched with `terminal_agents` and kept in a small hook. The menu is part of the startup bundle only if it's tiny. Otherwise it's lazy-loaded like the panel, and xterm.js still loads only when a Terminal opens.
- `shortcuts.ts`: `toggleAsk` becomes `agentMenu` on Mod+J.

**Docs**

- ADR 0014, "Agents replace Ask", supersedes ADR 0013. Mark 0013 as superseded and add a dated note to `docs/vision.md` and ADR 0010.
- In `CONTEXT.md`, remove the **Ask** section and the AI part of **Settings**. Add **Agent** (a Terminal started by running one of Zukai's known agent CLIs in the default folder) and **Agent menu**.
- `docs/superpowers/followups/2026-11-21-ask-foundation.md` is deleted, since its items no longer apply.

## 6. Constraints

- All three platforms ship (ADR 0006). Detection and launch must be tried by hand on each, especially macOS started from Finder and an npm `.cmd` agent on Windows.
- Security: the UI can choose only an id from the fixed list, and the folder still passes the Terminal grant check. Zukai never handles AI keys anymore.
- Launch time isn't affected. The agent search never runs at startup, only when the menu first opens.
- The menu follows the existing menu and chrome tokens (DESIGN.md).

## 7. Testing

- **Rust:**
  - agent id lookup, with unknown ids rejected
  - the launch arguments for each shell kind
  - a PATH search that honours `PATHEXT` on Windows (fed a fake PATH and file set, like `shell.rs`'s tests)
  - parsing the login shell's PATH output, the fallback on failure, and the time limit
  - an integration test that opens a Terminal with a stand-in agent (a test script on a fake PATH) that prints and exits, then checks the prompt is still alive by writing `echo ok`
- **UI (vitest):**
  - menu order, with installed agents first and dimmed rows disabled and unnumbered
  - digit keys, arrows, Enter and Escape
  - Mod+J and the status bar button open the menu
  - the + chevron uses the active Terminal's folder
  - choosing an agent opens a Terminal with its id
  - tab labels
  - nothing about Ask remains (the Settings dialog has no AI section, and the shortcut list has no Ask entry)
- **By hand on each OS:** start Claude Code from a note in a project folder and check that it's in that folder. Quit it and land at a prompt. Install an agent while Zukai is open and see it appear on the next menu opening.

## 8. Left to the builder

- the glyphs for the agent rows and the Agent button icon
- the placeholder look while detection runs
- the time limit for the login-shell PATH lookup
- the exact shell flags, within section 5
- whether the agent menu is lazy-loaded

## 9. Approaches considered

1. **The user's login shell runs the agent, then stays at a prompt. Chosen.** PATH comes from the user's profile, so detection and launch agree. npm `.cmd` wrappers on Windows run cleanly. The process tree and quit flow are unchanged. Quitting the agent leaves a useful prompt in the folder.
2. **Spawn the agent executable directly in the PTY, with no shell.** It's the cleanest tree, and the tab closes with the agent. But Rust would have to resolve each executable itself, which is fragile with npm wrappers on Windows and Finder's bare PATH on macOS. Rejected.
3. **Open a plain Terminal and type the command into it.** It's the least code. But the command is echoed, it races the shell's startup, and detection can't easily share the shell's PATH. Rejected.

Keeping Ask alongside agents was ruled out by the owner, who finds it useless.
