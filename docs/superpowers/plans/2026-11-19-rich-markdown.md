# Rich Markdown editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Markdown Tabs a Notion-like **Rich** editor (Milkdown) beside the plain **Markdown** editor, chosen per Tab, with Rich as the default.

**Architecture:**
- **Text ownership.** The hidden CodeMirror view stays the owner of each Tab's text. A narrow bridge on `EditorHost` lets the Rich editor read that text, replace it as one change kept out of the history, hear outside changes, and clear the history.
- **The Rich editor.** `RichEditor` hosts Milkdown for one Tab. It parses the text when shown and serializes only on real user edits, writing back through the bridge, so autosave, conflicts, the Session and Splits all keep working unchanged.
- **Mode.** `markdownMode` on the Tab decides which editor `TabPane` shows.

**Tech Stack:** React 19, TypeScript, CodeMirror 6, `@milkdown/kit` 7.23.0 (ProseMirror + remark), Vitest, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-11-19-rich-markdown-design.md`

## Global Constraints

**Dependencies and loading**
- `@milkdown/kit` is pinned to exactly `7.23.0`. It is the only new dependency. Don't use `@milkdown/crepe`, `@milkdown/react`, or any Milkdown theme.
- The rich editor is lazy-loaded in its own chunk, the same way `src/markdown/render.ts` is.

**Exact values**
- **Size limit:** `RICH_MAX_BYTES = 1_048_576` UTF-8 bytes. It is checked when a note is shown in Rich and at the switch, not while editing.
- **Notices:**
  - `Too large for the rich editor`
  - `This note uses Markdown the rich editor can't keep`
- **Labels:**
  - the status-bar switch: `Rich` / `Markdown`
  - the Settings radio: "Open Markdown notes in", with `Rich editor` / `Markdown`
  - the shortcut entry: `Rich / Markdown editor` (Editing group)
- **Shortcut:** `Mod+Alt+M`.
- **Defaults:** `Settings.markdownDefault` is `"rich"`. `TabState.markdownMode` is `"rich" | "markdown"` and absent until decided.

**Rules**
- **The default** applies only to a Markdown Tab with a `file`, or with `languagePicked`. A guessed Scratchpad gets `"markdown"`. The mode is written onto the Tab the first time it's shown.
- **Never write on open.** Only a transaction that changes the doc and isn't tagged programmatic may serialize. Nothing is written when the serialized text equals the current text.
- **Never lose content.** If `canKeep(text)` is false, the note shows in Markdown mode with the notice.
- **Links** open only through the existing `openUrl` (http(s)/mailto), with Ctrl+click (Cmd+click on macOS).
- **Images** render as their alt text. Nothing is loaded.
- **Undo doesn't cross a mode switch.** CodeMirror's history is cleared when the Tab is shown in Markdown mode again.

## Review Focus

1. **A Rich Tab whose File changes on disk** (reload or conflict) re-renders the new text and doesn't write it back. *(Task 4 test `outside_change_rerenders_without_writing`.)*
2. **A read-only File in Rich** refuses typing, toolbar actions and "/" inserts. *(Task 4 test `read_only_refuses_edits`; Task 5 test `toolbar_disabled_when_read_only`.)*
3. **Two Tabs of the same note can't exist, but two Rich Tabs in a Split can.** Each must keep its own editor and its own history. *(Task 4 test `two_rich_tabs_in_a_split_are_independent`.)*
4. **Switching Rich → Markdown → Rich after edits** keeps the text exactly. *(Task 4 test `switch_round_trip_keeps_text`.)*
5. **Pasting HTML from a web page into Rich** only produces nodes the Markdown schema holds, and serializes cleanly. *(Task 2 corpus: a pasted-HTML fixture through the clipboard plugin's parser.)*

---

### Task 1: Mode in the model, Settings and the shortcut

**Files:**
- Modify: `src/model/types.ts`, `src/model/settings.ts`, `src/model/session.ts`
- Modify: `src/app/shortcuts.ts`, `src/app/shortcutList.ts`
- Modify: `src/ui/SettingsDialog.tsx`
- Create: `src/model/markdownMode.ts`
- Test: `src/model/markdownMode.test.ts`, `src/model/session.test.ts`, `src/model/settings.test.ts` (or wherever `parseSettings` is tested), `src/app/shortcuts.test.ts`, `src/ui/SettingsDialog.test.tsx`

**Interfaces:**
- Produces:
  - `type MarkdownMode = "rich" | "markdown"` in types.ts. `TabState.markdownMode?: MarkdownMode`.
  - `Settings.markdownDefault: MarkdownMode`. `DEFAULT_SETTINGS.markdownDefault = "rich"`. A malformed value falls back to the default.
  - `markdownMode.ts`:
    - `export function effectiveMode(tab: TabState, settings: Settings): MarkdownMode | null`:
      - `null` when the Tab isn't text or its language isn't markdown
      - otherwise `tab.markdownMode`, if set
      - otherwise `settings.markdownDefault`, if `tab.file` or `tab.languagePicked`
      - otherwise `"markdown"`
    - `export const RICH_MAX_BYTES = 1_048_576`
    - `export function tooLargeForRich(text: string): boolean`, measured in UTF-8 bytes
  - The Session keeps `markdownMode` only when it's `"rich"` or `"markdown"`; anything else is stripped, like `withPreview`.
  - Command `{ type: "toggleRichMarkdown" }`, bound to `Mod+Alt+M` in `matchShortcut`. A `SHORTCUTS` entry `{ group: "Editing", action: "Rich / Markdown editor", keys: [["Mod","Alt","M"]], command: "toggleRichMarkdown" }`.
  - SettingsDialog (General) gains a radio group named "Open Markdown notes in" with `Rich editor` / `Markdown`, calling `onSettings({ markdownDefault })`.

- [ ] **Step 1: Write failing tests:**
  - `effectiveMode` covers: a file `.md` → `"rich"`, a picked Markdown Scratchpad → `"rich"`, a guessed one → `"markdown"`, an explicit `"markdown"` beats the `"rich"` default, a non-markdown Tab → `null`, and a `markdownDefault: "markdown"` setting.
  - `tooLargeForRich`: `"a".repeat(1_048_576)` → false, one more byte → true, and `"é".repeat(524_289)` → true (two bytes each).
  - The Session round trip keeps `markdownMode`, and a junk value is stripped.
  - `parseSettings` keeps or defaults `markdownDefault`.
  - `matchShortcut` of Ctrl+Alt+M (on Windows) and Cmd+Alt+M (on macOS) → `toggleRichMarkdown`. The existing test that every Command is listed still passes.
  - SettingsDialog shows the radio group and changes the setting.
- [ ] **Step 2: Run** `pnpm vitest run src/model src/app/shortcuts.test.ts src/ui/SettingsDialog.test.tsx` and confirm they FAIL.
- [ ] **Step 3: Implement.** Command handling in `useWorkspace` comes in Task 4; give it a no-op case for now so the switch is exhaustive.
- [ ] **Step 4: Run** the same command, then `pnpm test`, `pnpm typecheck` and `pnpm lint`. Expect PASS.
- [ ] **Step 5: Commit.** `feat(rich): markdown mode in the model, settings and shortcut`

### Task 2: Milkdown core: parse, serialize, can-keep

**Files:**
- Modify: `package.json` / `pnpm-lock.yaml` (`pnpm add @milkdown/kit@7.23.0 --save-exact`)
- Create: `src/rich/richMarkdown.ts`
- Test: `src/rich/richMarkdown.test.ts`, with fixtures inline or in `src/rich/fixtures/`

**Interfaces:**
- Produces:
  - `export function richPlugins(): MilkdownPlugin[]`: the commonmark and GFM presets, history, listener and clipboard, plus raw-block handling for front matter and block HTML. Task 4 builds its editor from this list.
  - `export async function roundTrip(text: string): Promise<string>`: parses and serializes with exactly the editor's schema and serializer, using a headless Milkdown editor on a detached element.
  - `export async function canKeep(text: string): Promise<boolean>`: true when the remark syntax trees of `text` and `roundTrip(text)` are equal once positions are dropped and formatting-only differences are ignored (list markers, emphasis markers, table padding, fence characters, trailing whitespace).
    - It uses `unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter)`, which reach the project through `@milkdown/kit`'s dependencies. If any of these isn't importable, add it pinned to the version Milkdown resolves, and record that ruling in the commit message.

- [ ] **Step 1: Write failing tests.**
  - **`round_trip_keeps_content`**, run over a corpus. For each sample, `canKeep` is true and `roundTrip` keeps every word. The corpus covers:
    - H1–H6
    - nested bullet and numbered lists
    - task lists, checked and unchecked
    - a table with left, center and right alignment
    - a fenced code block with `ts`
    - a quote containing a list
    - inline links and autolinks
    - an image `![alt](x.png)`
    - `---` front matter
    - a block `<div>` HTML
    - bold, italic, strikethrough and inline code
    - a horizontal rule
  - **`formatting_only_differences_are_kept`**: `"* a\n* b"` → `canKeep` true, and `roundTrip` may use `-`.
  - **`cannot_keep_detects_loss`**: at least one case where Milkdown would drop or change content (find one by probing: inline HTML, a reference-style link definition, or an escaped character) → `canKeep` false. Pin the real case found in the test, with a comment saying why.
  - **`pasted_html_serializes_cleanly`**: HTML with `<h2>`, `<ul><li>`, `<table>` and `<b>`, run through Milkdown's clipboard HTML parsing, gives Markdown with `##`, `-`, a GFM table and `**`.
- [ ] **Step 2: Run** `pnpm vitest run src/rich` and confirm it FAILS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run src/rich`, `pnpm typecheck`, `pnpm lint` and `pnpm build` (check that Milkdown ends up in its own chunk, not the main bundle). Expect PASS.
- [ ] **Step 5: Commit.** `feat(rich): milkdown core with round-trip check`

### Task 3: The EditorHost bridge

**Files:**
- Modify: `src/editor/EditorHost.tsx`
- Test: `src/editor/EditorHost.test.tsx`

**Interfaces:**
- Produces:
  - `export interface TextBridge`:
    - `text(id: string): string | null`: null until the view is loaded.
    - `replace(id: string, text: string): void`: one change kept out of the history (`Transaction.addToHistory.of(false)`) and tagged with an exported annotation `fromRich`. It runs the normal `onChange` path. It refuses a read-only view.
    - `onOutsideChange(id: string, cb: (text: string) => void): () => void`: fires for any doc change on that view **not** tagged `fromRich` (loads, reloads, replace requests, Convert), with the new text.
    - `clearHistory(id: string): void`: resets that view's undo history.
    - `readOnly(id: string): boolean`
    - `ready(id: string): Promise<void>`: resolves once the view's content has loaded.
  - The new `EditorHost` prop `bridgeRef?: (b: TextBridge | null) => void` is called with a stable object on mount and null on unmount.

- [ ] **Step 1: Write failing tests** in EditorHost.test.tsx:
  - `bridge_reads_and_replaces_outside_history`: after `replace`, `onChange` is called with the text, and `undo` doesn't restore the old text.
  - `bridge_reports_outside_changes_only`: a `replaceRequests` change fires the callback; a `bridge.replace` doesn't.
  - `bridge_refuses_read_only`
  - `bridge_clear_history`: after typing and `clearHistory`, `undo` changes nothing.
  - `bridge_ready_waits_for_load`
- [ ] **Step 2: Run** `pnpm vitest run src/editor/EditorHost.test.tsx` and confirm it FAILS.
- [ ] **Step 3: Implement.** Keep the existing views map as the single source.
- [ ] **Step 4: Run** the same file, then `pnpm test` and `pnpm typecheck`. Expect PASS.
- [ ] **Step 5: Commit.** `feat(rich): text bridge on the editor host`

### Task 4: RichEditor and the mode switch

**Files:**
- Create: `src/rich/RichEditor.tsx`
- Modify: `src/app/TabPane.tsx`, `src/App.tsx`, `src/app/useWorkspace.ts`, `src/ui/StatusBar.tsx`
- Test: `src/rich/RichEditor.test.tsx`, `src/app/useWorkspace.test.ts`, `src/ui/StatusBar.test.tsx`, `src/app/TabPane` (if tested), `src/App` integration if one exists

**Interfaces:**
- Consumes: Task 1's `effectiveMode`, `tooLargeForRich` and `toggleRichMarkdown`; Task 2's `richPlugins` and `canKeep`; Task 3's `TextBridge`.
- **`RichEditor`:**
  - `RichEditor({ id, bridge, readOnly, focused, fontSize, onOpenLink, onFallback }: RichEditorProps)`, lazy-imported by `TabPane`.
  - Mount: `await bridge.ready(id)`, then `canKeep(text)`. If false, call `onFallback("This note uses Markdown the rich editor can't keep")` and render nothing.
  - Otherwise it creates Milkdown with `richPlugins()` and the default value `text`. User edits are serialized (debounced about 300 ms, flushed on blur and unmount) and `bridge.replace`d only if they differ from `bridge.text(id)`.
  - `bridge.onOutsideChange` replaces the Milkdown doc, tagged programmatic, so nothing is written back.
  - Read-only uses Milkdown's `editable: () => false`.
  - Links are opened with Ctrl/Cmd+click → `onOpenLink(href)`, the existing handler, which allows only http(s)/mailto.
  - Images are shown as their alt text through a custom node view.
  - `fontSize` sets the content font size.
  - `focused` focuses the editor when it becomes true.
- **`TabPane`:**
  - It gets `mode: MarkdownMode | null` and the bridge.
  - In `"rich"` it hides the slot and the preview, and renders `RichEditor` (in Suspense, with an empty editor-coloured fallback).
  - In `"markdown"` it behaves as today.
- **`useWorkspace`:**
  - When a Markdown Tab is shown with no `markdownMode`, it writes `effectiveMode(...)` onto it, but `"markdown"` if `tooLargeForRich`, plus the notice.
  - `toggleRichMarkdown`: flips the mode of the active Tab.
    - Going to `"rich"` is refused when the note is too large, with the notice.
    - Going to `"markdown"` calls `bridge.clearHistory(id)`.
  - `find`/`replace` on a Rich Tab set `"markdown"` first, then open the bar.
  - `onFallback` sets `"markdown"` and shows the notice.
  - A Language change away from markdown needs nothing, because `effectiveMode` returns `null`. A change back to markdown clears `markdownMode`, so the default applies again.
- **`StatusBar`:**
  - A `markdownMode?: { mode: MarkdownMode; onChange(m: MarkdownMode): void }` switch labelled `Rich` / `Markdown`, shown on Markdown Tabs.
  - The preview switch, line/column, wrap and similar items are hidden in Rich.

- [ ] **Step 1: Write failing tests.**
  - **RichEditor** (`bridge` faked in memory):
    - `opening_does_not_write`: mount with `"# Hi\n\n* a\n"`, wait, and `replace` is never called.
    - `typing_writes_markdown`: insert text through the Milkdown view; after the debounce, `replace` gets Markdown containing it.
    - `outside_change_rerenders_without_writing`
    - `read_only_refuses_edits`
    - `ctrl_click_opens_link` and `plain_click_does_not`
    - `image_shows_alt_text`
    - `unkeepable_note_falls_back`
    - `two_rich_tabs_in_a_split_are_independent`
  - **useWorkspace:**
    - `first_show_writes_default_mode`
    - `toggle_refuses_rich_when_too_large`
    - `toggle_to_markdown_clears_history`
    - `find_on_rich_switches_to_markdown`
    - `language_back_to_markdown_reapplies_default`
    - `switch_round_trip_keeps_text`
  - **StatusBar:** the switch shows on Markdown Tabs only, and the preview switch is hidden in Rich.
- [ ] **Step 2: Run** `pnpm vitest run src/rich src/app src/ui/StatusBar.test.tsx` and confirm it FAILS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck` and `pnpm lint`. Expect PASS.
- [ ] **Step 5: Commit.** `feat(rich): rich editor and the Rich/Markdown switch`

### Task 5: Toolbar, "/" menu, table controls, docs

**Files:**
- Create: `src/rich/RichToolbar.tsx`, `src/rich/SlashMenu.tsx`, `src/rich/TableControls.tsx`, `src/rich/commands.ts`
- Modify: `src/rich/RichEditor.tsx`, `src/ui/icons.tsx`, `CONTEXT.md`
- Test: `src/rich/RichToolbar.test.tsx`, `src/rich/SlashMenu.test.tsx`, `src/rich/TableControls.test.tsx`

**Interfaces:**
- **`commands.ts`** is a thin wrapper over Milkdown commands:
  - `setBlock(view, "paragraph"|"h1"|"h2"|"h3")`
  - `toggleMark(view, "bold"|"italic"|"strike"|"code")`
  - `setLink(view, href)`
  - `wrapList(view, "bullet"|"ordered"|"task")`
  - `insertBlock(view, "quote"|"code"|"rule"|"table")`, where a table is 3 columns × 2 rows with a header row
  - `table(view, "rowAbove"|"rowBelow"|"colLeft"|"colRight"|"delRow"|"delCol"|"delTable")`
  - `active(view): { block, marks:Set, inTable:boolean }`
- **`RichToolbar`:** the items are paragraph/H1/H2/H3, B, I, S, inline code, link, bullet list, numbered list, checklist, quote, code block, table and rule. It reflects `active()`. Every item is disabled when read-only. The keys are Mod+B, Mod+I, Mod+Shift+X, Mod+E and Mod+K. Mod+K asks for the URL through a small inline input, not `prompt()`.
- **`SlashMenu`:**
  - It opens on `/` typed at the start of an empty paragraph.
  - It filters as you type and offers the same block items.
  - ↑/↓ move, Enter inserts (removing the `/query` text), and Esc or a click outside closes it.
  - It's built on the existing `Menu` look, with tokens only.
- **`TableControls`:** shown while the cursor is in a table. It offers add row above/below, add column left/right, delete row, delete column and delete table.

- [ ] **Step 1: Write failing tests.** Each action is checked by the Markdown the editor serializes afterwards:
  - `toolbar_h2_bold_list_task`
  - `toolbar_disabled_when_read_only`
  - `mod_k_inserts_link`
  - `slash_filters_and_inserts_table`
  - `slash_escape_leaves_text`
  - `table_add_row_and_column`
  - `table_delete_table`
  - `new_table_is_3x2_with_header`
- [ ] **Step 2: Run** `pnpm vitest run src/rich` and confirm it FAILS.
- [ ] **Step 3: Implement.** Then the docs:
  - Add a **Rich editor** entry to `CONTEXT.md`: the two modes, the default and when it applies, never writing on open, the fallback notice, and Mod+Alt+M. Mention it in the **Markdown preview** entry: preview modes apply in Markdown mode only.
  - Add the new setting to the **Settings** entry.
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build`. Expect PASS. Then do a browser check (the controller does this) of the toolbar, the "/" menu and table editing, in light and dark and inside a Split.
- [ ] **Step 5: Commit.** `feat(rich): toolbar, slash menu and table controls`
