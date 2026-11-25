# 14. Agents replace Ask

Date: 2026-11-24
Status: Accepted. Supersedes [ADR 0013](0013-ask-with-the-users-own-key.md).

## Context

Ask, the built-in AI panel, wasn't useful in practice, and the owner wanted it removed. Engineers already have capable AI coding agents in the terminal: Claude Code, Codex, Gemini CLI, OpenCode and Cursor's agent. Zukai shouldn't compete with them. It should start them where the user is working.

Three ways to start an agent were considered:

1. **The user's login shell runs the agent, then stays at a prompt.** PATH comes from the user's profile, so detection and launch agree. npm `.cmd` wrappers on Windows run cleanly. The process tree and the quit flow don't change.
2. **Spawn the agent executable directly in the PTY, with no shell.** The tree is cleaner and the tab closes with the agent. But Rust would have to resolve each executable itself, which is fragile with npm wrappers on Windows and Finder's bare PATH on macOS.
3. **Open a plain Terminal and type the command into it.** It's the least code. But the command is echoed, it races the shell's startup, and detection can't easily share the shell's PATH.

Keeping Ask alongside agents was ruled out.

## Decision

- **Ask is removed entirely**, not hidden behind a setting. That covers the panel, the AI provider and key, the Ask tools, Proposed edits, Ask history and the AI section in Settings.
- **Agents run in the Terminal panel.** An **Agent** is a Terminal that runs a known agent CLI instead of a bare prompt.
- **A menu starts them.** It opens from a small chevron beside the Terminal panel's +, from the status bar's **Agent** button (where Ask was) and from Mod+J. It lists **Terminal** with its shortcut, then a **Start an agent** heading, with installed agents first (numbered 1-9) and the rest dimmed as **not installed**.
- **An agent starts in the Terminal default folder:** the active File's folder when it's granted, else the Library root, else the first available added folder. From the panel's chevron it starts in the active Terminal's folder.
- **The user's login shell runs the agent** (approach 1). When the agent quits, the tab is left at a shell prompt in that folder.
- **Detection runs only when the menu opens.** On Unix it asks the user's login shell. On Windows it searches PATH for `.exe`, `.cmd` and `.bat`.

## Consequences

- Principle 4 goes back to "no cloud connection", with no exception. Agents are the user's own programs, so Zukai never handles AI keys, calls providers or runs tools for a model.
- Rust loses the keychain store, the Ask tools and the provider HTTP client. The Markdown preview and the Rich editor no longer need to render Mermaid blocks for saved answers.
- Zukai can't see what an agent does or review its edits. An agent changes Files on disk like any other program, and the usual saving rules, Snapshots and Disk conflicts apply.
- An agent that is installed but not on the login shell's PATH shows as not installed.
- The menu lists a fixed set of agents. Adding another means adding it to Zukai's list.
