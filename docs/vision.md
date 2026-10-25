# Zukai — Product Vision & Core Features

> Decisions made after this vision was written live in [`docs/adr/`](adr/), and the shared vocabulary lives in [`CONTEXT.md`](../CONTEXT.md). Where they differ from this document, they take precedence.

## 1. Overview

Zukai is a lightweight, fast desktop productivity application that combines the simplicity of Notepad, the flexibility of an infinite canvas like Excalidraw, and the practicality of a spreadsheet viewer.

The core idea is simple: one lightweight workspace for capturing thoughts, writing text, sketching ideas, and inspecting structured data — without switching between multiple applications.

Zukai should feel like a native desktop utility rather than a complex productivity platform. It should launch quickly, stay out of the user's way, and make it effortless to create, access, and manage temporary notes, code snippets, diagrams, and data files.

The application is designed primarily for desktop users, especially developers, technical professionals, and people who frequently switch between writing, brainstorming, and working with data.

## 2. Product Philosophy

Zukai should follow five core principles:

- **Speed first:** Opening the application, creating a new tab, and capturing a thought should require minimal effort.
- **Simplicity:** The default interface should resemble a clean, modern Notepad with tabs at the top.
- **Flexible workspaces:** Users can work with plain text, code, drawings, and tabular data in the same application.
- **Local-first:** User content should be stored locally by default, without requiring an account or cloud connection.
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

Defer cloud synchronization, user accounts, collaboration, AI features, plugins, and advanced spreadsheet calculations until the core experience is reliable.

## 7. Definition of Success

Zukai succeeds when users naturally reach for it whenever they need to quickly write something, inspect a data file, or sketch an idea.

It should be fast enough to replace Notepad for quick tasks, capable enough to handle everyday code snippets and CSV files, and flexible enough to serve as a personal scratchpad for visual thinking.

The guiding principle: **Open it instantly. Capture anything. Keep moving.**
