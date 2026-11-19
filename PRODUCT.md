# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

A Tauri desktop app (a web UI in the OS webview) shipping on Windows, macOS and Linux (ADR 0006). The design language adapts per desktop OS: window controls, title bar, and platform conventions follow Windows, macOS or Linux, while the content areas share one Zukai system.

## Users

Technical people who live in text and tools: software engineers first, plus adjacent roles such as data, DevOps and technical PMs. They are mid-task, usually with an IDE, terminal and browser already open, and need somewhere to put what comes up while working: a note, a command, a query, a sketch, a CSV export, a JSON payload. They return to it later, often days later, to find it again.

## Product Purpose

Zukai is a small, fast, local notebook for engineers. Writing something down should cost nothing, and finding it again should be effortless. Success is that a technical user reaches for Zukai whenever they need to write something down while working, and finds it there later.

It is not a Notepad replacement and not a productivity system. It opens and edits files from anywhere well (Notepad++ is the bar for the text editor), in service of the notebook.

## Positioning

Notes, code, drawings and data sit side by side in one tabbed notebook, each shown the way that suits it (text with highlighting, Markdown rich editing, an Excalidraw canvas, a CSV grid, an image viewer), stored as plain files on the user's own disk with no account. Scratchpads save themselves and the session restores; a File changes on disk only when you save it (or always, with Save files automatically), and nothing is silently overwritten.

## Operating Context

- Used alongside an IDE, terminal and browser, often in short bursts mid-task; keyboard-first (Mod+N new tab, Mod+Shift+N canvas, Mod+\ split, command palette, F3 find).
- One person's own notebook: local-first, plain files, can be put in git or a sync folder like any folder. No accounts, sharing or collaboration.
- A Library sidebar over notebook folders, a Scratchpads list and Pinned items; a single tab bar; Splits of exactly two tabs; a status bar for language, encoding and line endings.
- Light and dark themes, with "System" following the OS live.

## Capabilities and Constraints

- Kinds: Text (CodeMirror 6, syntax highlighting, language guess), Markdown (preview and a Milkdown rich editor with toolbar, slash menu and tables), Canvas (Excalidraw 0.18.1, offline), Image (read-only viewer), Table (CSV/TSV grid with a raw text View).
- Splits and Compare (diff of two Text Tabs), Huge Files, encodings and line endings preserved, Snapshots and persistent undo, file bars for disk changes, conflicts and missing files.
- Vocabulary is fixed by `CONTEXT.md` (Tab, Document, Scratchpad, File, Kind, View, Split, Library, Pinned). UI copy uses these words.
- Must stay fast to launch and light; Excalidraw loads only when a Canvas opens. Fonts and assets ship with the app, never from a CDN.
- Keyboard shortcuts and native-feeling behavior are part of the product; no browser behaviors (reload, print) leak through.
- Undecided: how far the notebook idea goes beyond the current feature set (vision, section 1).

## Brand Commitments

- Name: Zukai.
- The vision asks for a restrained desktop utility: minimal clutter, generous workspace, subtle separators, small unobtrusive toolbars, carefully designed light and dark themes. Avoid dashboard layouts, excessive sidebars, complicated menus, oversized buttons and unnecessary animation.
- The look so far was functional scaffolding, not a committed identity; it is open to replacement.
- Standing preference (owner, 2026-11-19): the category standard played straight, at the craft level of Linear, Obsidian and VS Code / Zed. Several themes (Graphite, Midnight, Solar Dark, Paper, Solar Light) and a separate accent colour setting.

## Evidence on Hand

- Product docs: `docs/vision.md`, `CONTEXT.md`, `docs/adr/`.
- Reference screenshots the owner collected: `insparation/` (dark note apps with roomy type and a calm sidebar).
- No logo, testimonials, user counts, pricing or licensing decisions exist yet; do not invent them.

## Product Principles

1. Writing something down costs nothing: open, type, done. No dialogs before the first keystroke.
2. The material leads; chrome recedes. The editor area is the product.
3. Each kind of material is shown the way that suits it, inside one consistent shell.
4. Plain files, local, trustworthy: saving is never surprising.
5. Stay a notebook, not a platform.
