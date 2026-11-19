# Zukai — Rich Markdown editor

Date: 2026-11-19
Status: Draft, waiting for approval

Background reading:
- The glossary [`CONTEXT.md`](../../../CONTEXT.md): **Markdown preview**, **Tab**, **Language**, **Settings**, **Split**.
- [ADR 0003](../../adr/0003-codemirror-6-for-text.md): CodeMirror for text.
- [ADR 0005](../../adr/0005-scratchpads-as-plain-files.md): Scratchpads as plain files.

## 1. Intent

The owner wants writing Markdown notes to feel like Notion or Confluence. Tables, lists, checklists and headings should be easy to add and edit without typing the syntax. The note stays an ordinary `.md` file. The user decides, per Tab, between this new **Rich** editor and the existing plain **Markdown** editor. Rich is the default.

## 2. Goals, non-goals, anti-goals

**Goals**
- A Rich mode for Markdown Tabs, with headings, marks, links, lists, checklists, quotes, code blocks, rules and GFM tables (including adding and removing rows and columns). It has a slim toolbar, a "/" menu and the usual keys.
- A per-Tab switch between Rich and Markdown, plus a Settings default.
- Markdown stays the file format. Everything else in Zukai keeps working on the text: autosave, the Session, Files, Splits, the Library, the preview.

**Non-goals (this slice)**
- Find and Replace inside the rich editor
- images that load
- drag-to-reorder blocks
- comments, mentions, embeds, collaboration
- pasting rich HTML as anything more than what the Markdown schema holds

**Anti-goals**
- **Rich mode must never rewrite a file the user didn't edit in Rich.** Opening, scrolling and switching modes change nothing on disk.
- **Content is never lost.** Formatting may normalize (`*` → `-`, table padding), but no text, front matter, HTML or unknown syntax disappears.
- **The rich editor must not slow down Zukai** for people who never open a Markdown note. It is loaded only on first use.

## 3. Approaches (decided 2026-11-19)

1. **Milkdown: chosen.** Milkdown is a ProseMirror editor whose native model is Markdown (remark), and it has a GFM preset (tables, task lists, strikethrough). It gives Notion-like editing with Markdown as the real format. The cost is that the Markdown is re-serialized in Milkdown's style after an edit in Rich.
2. **TipTap with a Markdown add-on.** Rejected. Markdown is a conversion layer there, so tables and task lists round-trip less reliably and more of the file changes on save.
3. **Live preview inside CodeMirror (Obsidian-style).** Rejected. It keeps the exact text, but table editing wouldn't feel like Notion, and it is the most custom work.

## 4. Behaviour (approved 2026-11-19)

### Choosing the mode

- A Markdown Tab is in one of two editor modes: **Rich** or **Markdown**.
  - Markdown mode is today's editor, with its Edit, Split and Preview modes unchanged. Ctrl+Shift+V still cycles those three, and does nothing in Rich.
  - Rich has no preview. It is already the rendered view.
- **The switch** is a status-bar control on Markdown Tabs, `Rich ▾` / `Markdown ▾`. A shortcut, **Mod+Alt+M**, toggles it. The mode is stored per Tab in the Session.
- **The Settings default** (General): "Open Markdown notes in: **Rich editor** / Markdown". The default is Rich.
- **When the default applies:**
  - It applies to a Tab whose Language is Markdown because it came from a `.md` / `.markdown` File, or because the user picked Markdown in the Language menu.
  - A Scratchpad that is only *guessed* to be Markdown stays in Markdown mode. A Tab must never flip into Rich while the user types.
  - The mode is written onto the Tab the first time it's shown, so the Settings default no longer changes it after that. This includes Tabs restored from an older Session, which have no mode yet: their `.md` notes open in Rich after the upgrade, as the default says. *(My call.)*
- **Large or unsafe notes:**
  - Notes over **1 MB** (UTF-8 bytes) open in Markdown mode with a status-bar notice ("Too large for the rich editor"). The switch then refuses Rich with the same notice.
  - The check runs when a note is shown in Rich and at the switch. A note that grows past 1 MB while open in Rich stays in Rich. *(My call.)*
  - Read-only Files (held, too large to edit) open in Rich as read-only, if they're under 1 MB.

### Editing in Rich

- **Blocks:**
  - paragraph
  - headings H1–H6
  - bullet, numbered and task lists (nested)
  - quote
  - code block (with a language label)
  - horizontal rule
  - table (GFM)
- **Marks:** bold, italic, strikethrough, inline code, link.
- **Keys:**
  - Mod+B, Mod+I, Mod+Shift+X (strike), Mod+E (inline code), Mod+K (link)
  - Markdown input rules as you type (`# `, `- `, `1. `, `[ ] `, `> `, ``` ``` ```, `---`)
  - Tab / Shift+Tab to nest and un-nest lists, and to move between table cells
  - Undo and redo with Mod+Z / Mod+Shift+Z / Mod+Y
- **Toolbar:** a slim toolbar at the top of the Rich view.
  - Its items are paragraph/H1/H2/H3, B, I, S, inline code, link, bullet list, numbered list, checklist, quote, code block, table and rule.
  - It reflects the current selection.
  - Its icons and tokens follow the existing UI, with no new colours.
- **The "/" menu:**
  - Typing `/` at the start of an empty paragraph opens a filterable menu of the same block items.
  - Enter inserts the chosen block, and Esc closes the menu.
- **Tables:**
  - While the cursor is in a table, a small control offers add row above/below, add column left/right, delete row, delete column and delete table.
  - A new table is 3 columns × 2 rows with a header row.
- **Links:**
  - Ctrl+click (Cmd on macOS) opens a link through the existing `open_url` (http(s) and mailto only).
  - A plain click places the cursor.
  - `#heading` links do nothing in Rich.
- **Images** show as an inline chip with their alt text, the same as the preview. Nothing is loaded.
- **Raw HTML, front matter and syntax Milkdown can't show** (footnotes, if unsupported) are kept as raw, editable code-like blocks. They are written back exactly.
- **Zoom** (the font size) and the theme apply. Line numbers and word wrap don't apply in Rich, and those status-bar items are hidden.

### Text, saving and the rest of Zukai

- **The Tab's text is the source of truth, and the CodeMirror view stays its owner.** *(My call.)*
  - Rich parses the CodeMirror doc's text when shown.
  - On each **user edit** in Rich (debounced like the editor's own changes), Rich serializes to Markdown. If the text differs from the current doc, Rich writes it into that Tab's hidden CodeMirror view as one change (not added to CodeMirror's history). The existing `onEditorChange`, autosave, title-keeping, Files, conflict, Session, Split and Recently Closed paths then run exactly as they do for typing.
- **What counts as a user edit.** A ProseMirror transaction that changes the doc and is not tagged as programmatic. Mount, re-parse after an outside change, and Milkdown's own normalization are all tagged. Even then, nothing is written when the serialized text equals the current text. So opening, scrolling and switching modes never touch the file. *(My call.)*
- **Content Rich can't keep.**
  - When Rich is about to show a note, it first checks the round trip: parse, serialize, and compare both texts' Markdown syntax trees, ignoring formatting differences.
  - If anything would be lost (some inline HTML, reference-style links, escapes, unsupported syntax), the Tab opens in **Markdown** mode instead, with a notice: "This note uses Markdown the rich editor can't keep". The switch then refuses Rich with the same notice.
  - Front matter and block HTML are kept as raw blocks, so they don't trigger this.

  *(My call: this is the only way to keep the "content is never lost" promise.)*
- **Switching modes:**
  - Markdown → Rich parses the current text.
  - Rich → Markdown shows the current text, which is exactly what was last serialized.
  - The cursor goes to the nearest equivalent place on a best-effort basis; the start of the document is fine.
  - **Undo doesn't cross a switch.** Each switch starts a fresh history in the mode you switch to, and CodeMirror's history is cleared when Markdown mode is shown again. *(My call: changes Rich wrote bypass CodeMirror's history, so its old entries would no longer line up.)*
- **Keys while the cursor is in Rich.** Mod+Z/Mod+Shift+Z/Mod+Y go to Rich's own history. Every app Command keeps working as it does elsewhere: save, zoom, Tab switching, close, Split, Settings, Mod+Alt+M, and Mod+F/Mod+H, which switch modes as described below. *(My call.)*
- **Outside changes:** when a File's text changes on disk or is reloaded (the existing reload or conflict paths), a Rich Tab re-parses the new text. An unsaved Rich edit follows the existing conflict rules, since the text was already handed to the editor's change path.
- **Splits:** a Rich Tab can be one half of a Split. Clicking it focuses it like any half.
- **Find:** Mod+F (and Replace) in a Rich Tab switches it to Markdown mode and opens the find bar there.
- **The language menu:** changing the Language away from Markdown switches the Tab to the plain editor. Changing it back to Markdown applies the Settings default.

## 5. Design

**Dependencies**
- `@milkdown/kit` **7.23.0**, pinned exactly like the other editor dependencies.
- Milkdown's own UI kits (Crepe and themes) are **not** used. The toolbar, "/" menu and table control are Zukai's own React components, using the existing Menu and tokens.
- Everything is lazy-loaded in its own chunk on first Rich use, the same way the Markdown renderer is today.

**Model**
- `TabState` gains `markdownMode?: "rich" | "markdown"`, which is absent until decided.
- `Settings` gains `markdownDefault: "rich" | "markdown"` (default `"rich"`).
- Session parsing strips a malformed value field by field, as for `preview`.

**Components**
- `src/rich/` holds `RichEditor.tsx` (the Milkdown host for one Tab: parse on mount and on outside text changes, serialize on user edits, read-only), `RichToolbar.tsx`, `SlashMenu.tsx`, `TableControls.tsx` and `richMarkdown.ts` (the config: commonmark + GFM presets, history, listener, clipboard, plus the raw-block handling).
- `TabPane` hides the editor slot and shows `RichEditor` beside it when the Tab is a Markdown Tab in Rich mode, the way Preview-only hides it today.
- The CodeMirror view for that Tab keeps existing, hidden. It still owns the text, read-only state and conflict handling, so switching back is instant. `EditorHost` gains a narrow way for `RichEditor` to:
  - read a Tab's current text
  - replace it as one change outside the history
  - be told when it changes from outside
  - clear that view's history

  *(My call.)*
- **Dependencies:** `@milkdown/kit` only, with a small React host written by hand. `@milkdown/react` isn't used, and the `prosemirror-*` packages come through the kit. *(My call.)*

**Commands and keys**
- A new Command `toggleRichMarkdown` (Mod+Alt+M) is listed in `SHORTCUTS` under Editing as "Rich / Markdown editor".
- `find`/`replace` on a Rich Tab first switches the mode.

**Status bar**
- The mode switch shows on Markdown Tabs.
- The preview switch shows only in Markdown mode.

## 6. Testing

- **Model:**
  - the Session round trip of `markdownMode` and `markdownDefault`
  - how the default applies (a File, a picked Language, a guessed Scratchpad)
- **Round trip** (pure, `richMarkdown`):
  - A corpus is parsed and serialized, and must lose no content: headings, nested lists, task lists, tables with alignment, code fences with a language, quotes, links, images, front matter, raw HTML and footnotes.
  - Formatting differences are allowed, and the test compares a normalized form (via `remark`).
- **RichEditor:**
  - Opening doesn't call `onChange`.
  - Typing does, with the Markdown expected.
  - Toolbar actions, the "/" menu insert and the table row/column actions produce the expected Markdown.
  - Read-only refuses edits.
  - An outside text change re-renders.
  - Ctrl+click on a link calls `openUrl` only for http(s)/mailto.
- **Switching:**
  - Rich → Markdown shows the serialized text.
  - Markdown → Rich keeps edits.
  - Mod+Alt+M toggles.
  - Mod+F switches to Markdown and opens Find.
  - A note over 1 MB refuses Rich.
- **A browser check** in light and dark, inside a Split.

## 7. Left to the builder

- The toolbar's icon set (reuse `icons.tsx`, adding a few).
- The exact debounce (match the editor's change path).
- How the cursor maps between modes (best effort).
- How the raw blocks are styled.
