# Zukai — Product Vision & Core Features

> Decisions made after this vision was written live in [`docs/adr/`](adr/), and the shared vocabulary lives in [`CONTEXT.md`](../CONTEXT.md). Where they differ from this document, they take precedence.

## 1. Overview

> **Reframed 2026-11-19.** Zukai is a notebook for engineers, not a Notepad replacement. The sections below were updated to match. The milestones and ADRs are unchanged for now.

Zukai is a small, efficient notebook for engineers. It is a fast desktop app where one engineer keeps what comes up while working:

- **Working notes:** what was tried, what broke, decisions, TODOs.
- **Snippets and commands:** shell one-liners, queries, config fragments, the regex that finally worked.
- **Sketches and diagrams:** architecture, flows, whiteboard thinking on a Canvas.
- **Data and artifacts:** CSV exports, JSON payloads, logs and screenshots, kept next to the notes about them.

It is not a Notepad replacement. Zukai opens files from anywhere and edits them well (Notepad++ is the bar for the text editor), but that is in service of the notebook: things you write down while working and come back to later.

Zukai should feel like a native desktop utility rather than a complex productivity platform. It should launch quickly, stay out of the way, and make it effortless to write something down and find it again.

It is one engineer's own notebook: personal, local-first, and kept as plain files on their own disk. A folder can be put in git or a sync service like any other folder, but Zukai itself has no accounts, sharing or collaboration.

How far the notebook idea goes is deliberately left open. The framing is set; the feature list will follow it.

## 2. Product Philosophy

Zukai should follow five core principles:

- **Speed first:** Opening the application, creating a new tab, and capturing a thought should require minimal effort.
- **Simplicity:** The default interface should be a clean, modern editor with tabs at the top. The notebook should never feel like a productivity system.
- **An engineer's material:** Notes, code, drawings and data sit side by side in the same notebook, each shown in the way that suits it.
- **Local-first, plain files:** Everything is stored locally as ordinary files, readable without Zukai, with no account or cloud connection.
- **Frictionless workflow:** Automatic saving, keyboard shortcuts, and session restoration should make the application feel seamless.

Avoid unnecessary features, complicated navigation, excessive configuration, and productivity-system complexity.

## 3. Core Features

### A. Tab-Based Workspace

The main interface should feature a horizontal tab bar at the top, inspired by modern text editors.

Users should be able to:

- Create a new tab instantly.
- Rename tabs.
- Switch between tabs quickly.
- Close and reopen tabs.
- Restore the previous workspace after restarting the application.
- Work with multiple documents and scratchpads simultaneously.

New tabs should open immediately, without requiring users to select a document type or configure settings.

### B. Text Editor

Provide a lightweight text editor for quick notes, temporary text, code snippets, and technical content.

Features:

- Plain-text editing.
- Syntax highlighting for common programming and data formats.
- Automatic language detection where practical.
- Support for common formats such as TXT, MD, JSON, XML, JavaScript, TypeScript, SQL, and other developer-oriented formats.
- Basic text editing shortcuts and search.
- Open and edit local files.
- Automatic saving for internal scratchpads.

The editor should prioritize responsiveness and readability over advanced word-processing functionality.

### C. Infinite Canvas

Integrate an Excalidraw-style infinite canvas for freeform visual thinking.

Users should be able to:

- Draw freehand sketches.
- Add shapes, arrows, connectors, and text.
- Move, resize, and arrange elements freely.
- Pan and zoom across an effectively unlimited workspace.
- Create diagrams, architecture sketches, flowcharts, and quick visual notes.
- Save and reopen canvases without losing their layout.

The canvas should feel lightweight and immediately accessible, not like a separate, heavyweight application.

### D. Flexible Text and Canvas Workflow

Preserve the simplicity of the text editor while making visual tools readily available.

Users should be able to:

- Create a dedicated canvas in a separate tab.
- Open a canvas alongside text when a split view is useful.
- Switch between text and visual work without losing their place.
- Keep related notes and sketches organized in the same workspace.

The default experience should remain text-first. The canvas is an optional extension of the workspace, not something that complicates every new tab.

### E. CSV Table Viewer and Editor

When a user opens a CSV file, Zukai should display it as a readable, interactive table instead of raw comma-separated text.

Features:

- Automatically detect common delimiters, including commas and semicolons.
- Display data in rows and columns.
- Resize columns and handle long cell values.
- Sort columns.
- Search and filter data.
- Edit individual cells.
- Save changes back to the original CSV file.
- Provide an option to inspect the raw text representation when needed.

The goal is to provide a fast, convenient way to inspect and make simple changes to CSV files without opening Excel or another full spreadsheet application.

This feature should remain focused on practical data inspection and lightweight editing rather than attempting to replicate Excel.

### F. Automatic Saving and Local Storage

Saving should be nearly invisible to the user.

Requirements:

- Automatically persist scratchpads and canvas content.
- Restore open tabs and workspace state after application restarts.
- Preserve document content and canvas layouts.
- Support opening and saving regular files on the local filesystem.
- Clearly distinguish internal scratchpads from external files.
- Avoid silently overwriting external files or losing user changes.

Use a local-first architecture and do not require an account or cloud service for core functionality.

### G. Keyboard-First Workflow

Support keyboard shortcuts for frequent actions, including:

- New tab.
- Close tab.
- Switch between tabs.
- Open file.
- Search.
- Create a new canvas.
- Toggle or open split view.
- Save or export content.

Consider a global keyboard shortcut that opens a small quick-capture window, allowing users to jot down a note without navigating away from their current application.

## 4. Intended User Experience

A typical workflow should look like this:

1. The user opens Zukai and immediately sees a clean text editor with tabs at the top.
2. They create a new tab and write a quick note or paste a code snippet.
3. They open another tab and sketch an idea on an infinite canvas.
4. They open a CSV file, which appears as a table automatically.
5. They switch between all these tabs without losing their work.
6. They close the application and reopen it later, finding their workspace restored.

The entire experience should feel fast, natural, and predictable.

## 5. Visual Direction

Use a modern, restrained desktop interface.

Design characteristics:

- Minimalist layout.
- Clean typography.
- Compact tab bar.
- Generous workspace area.
- Subtle borders and separators.
- Minimal visual clutter.
- Carefully designed light and dark themes.
- Small, unobtrusive toolbars.
- Consistent keyboard shortcuts and interaction patterns.

Avoid dashboard-style layouts, excessive sidebars, complicated menus, oversized buttons, and unnecessary animations.

The application should feel like a refined developer utility: functional, elegant, and unobtrusive.

## 6. Scope and Priorities

> **Replaced.** The build order for v1 is now the seven milestones in [ADR 0010](adr/0010-v1-milestone-order.md). That list adds work decided after this vision was written: shipping on three platforms, snapshots and persistent undo, keeping file encodings, the Notepad++ editing set, Compare, and editable files of any size. It also moves saving correctness to the first milestone. The original list is kept below for reference.

Prioritize the first version in this order:

1. Desktop shell and tab management.
2. Text editor with syntax highlighting.
3. Reliable autosave and session restoration.
4. Infinite canvas integration.
5. CSV table viewing and lightweight editing.
6. Split view and workflow polish.
7. Quick-capture window and global shortcut.

> **2026-11-21:** AI is no longer deferred: Ask is decided in [ADR 0013](adr/0013-ask-with-the-users-own-key.md).
>
> **2026-11-24:** Ask is removed; agents started from the Terminal panel replace it ([ADR 0014](adr/0014-agents-replace-ask.md)).

Defer cloud synchronization, user accounts, collaboration, AI features, plugins, and advanced spreadsheet calculations until the core experience is reliable.

## 7. Definition of Success

Zukai succeeds when an engineer naturally reaches for it whenever they need to write something down while working, whether it's a note, a command, a sketch or a data file, and finds it there again later.

It should be fast enough that writing something down costs nothing, capable enough for everyday code and CSV files, and small enough to stay a notebook rather than become a platform.

The guiding principle: **Open it instantly. Capture anything. Keep moving.**
