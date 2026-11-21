---
name: Zukai
description: A small, fast, local notebook for engineers, in quiet desktop chrome with one accent.
colors:
  accent-blue: "#2563eb"
  accent-blue-dark: "#5b8def"
  accent-violet: "#7c3aed"
  accent-violet-dark: "#a183f7"
  accent-green: "#15803d"
  accent-green-dark: "#4cc47a"
  accent-orange: "#c2410c"
  accent-orange-dark: "#f39a4c"
  accent-pink: "#db2777"
  accent-pink-dark: "#f27aae"
  accent-fg: "#ffffff"
  accent-fg-violet-dark: "#160b33"
  accent-fg-green-dark: "#06210f"
  accent-fg-orange-dark: "#2a1302"
  accent-fg-pink-dark: "#2e0818"
  paper-chrome: "#f4f4f5"
  paper-editor: "#ffffff"
  paper-surface: "#ffffff"
  paper-sunken: "#f4f4f5"
  paper-hairline: "#e4e4e7"
  paper-hairline-strong: "#d4d4d8"
  paper-text: "#18181b"
  paper-muted: "#52525b"
  paper-faint: "#6e6e78"
  solar-light-chrome: "#f1ece1"
  solar-light-editor: "#fbf8f2"
  solar-light-surface: "#fffdf9"
  solar-light-sunken: "#f1ece1"
  solar-light-hairline: "#e3dccd"
  solar-light-hairline-strong: "#d3cab8"
  solar-light-text: "#2a251e"
  solar-light-muted: "#5c5446"
  solar-light-faint: "#6b6252"
  graphite-chrome: "#18181b"
  graphite-editor: "#1f1f23"
  graphite-surface: "#27272b"
  graphite-sunken: "#141416"
  graphite-hairline: "#2c2c31"
  graphite-hairline-strong: "#3a3a40"
  graphite-text: "#e7e7ea"
  graphite-muted: "#a1a1aa"
  graphite-faint: "#85858f"
  midnight-chrome: "#0e121a"
  midnight-editor: "#131925"
  midnight-surface: "#1b2232"
  midnight-sunken: "#0b0e15"
  midnight-hairline: "#212a3b"
  midnight-hairline-strong: "#2d384d"
  midnight-text: "#e1e6ef"
  midnight-muted: "#98a2b6"
  midnight-faint: "#7f899d"
  solar-dark-chrome: "#1a1815"
  solar-dark-editor: "#211f1b"
  solar-dark-surface: "#2b2823"
  solar-dark-sunken: "#151310"
  solar-dark-hairline: "#322e28"
  solar-dark-hairline-strong: "#423d35"
  solar-dark-text: "#ebe4d8"
  solar-dark-muted: "#ada392"
  solar-dark-faint: "#938a7a"
  danger: "#be123c"
  danger-dark: "#f87171"
  warn-bg: "#fdf3d8"
  warn-fg: "#7a5208"
  err-bg: "#fde6e4"
  err-fg: "#a12a20"
  warn-bg-dark: "#3a2f17"
  warn-fg-dark: "#f2c86b"
  err-bg-dark: "#3d2020"
  err-fg-dark: "#f5a3a3"
  syn-keyword: "#8b3fd9"
  syn-string: "#2f7d4f"
  syn-number: "#b4580f"
  syn-function: "#1d63c9"
  syn-type: "#a3480f"
  syn-comment: "#8a8a93"
  syn-keyword-dark: "#c79bf2"
  syn-string-dark: "#9fd49b"
  syn-number-dark: "#f0b46e"
  syn-function-dark: "#7fb6ff"
  syn-type-dark: "#f2a77a"
  syn-comment-dark: "#73737d"
typography:
  display:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Inter Variable, system-ui, sans-serif"
    fontSize: "27.75px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Inter Variable, system-ui, sans-serif"
    fontSize: "20.25px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Inter Variable, system-ui, sans-serif"
    fontSize: "16.8px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Inter Variable, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  ui:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Inter Variable, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  sidebar:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Inter Variable, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  caption:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Inter Variable, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, -apple-system, BlinkMacSystemFont, Inter Variable, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.06em"
  code:
    fontFamily: "JetBrains Mono, Cascadia Code, ui-monospace, SF Mono, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
    fontFeature: "liga 0"
rounded:
  xs: "4px"
  sm: "5px"
  md: "6px"
  track: "7px"
  lg: "8px"
  float: "10px"
  dialog: "12px"
  full: "999px"
spacing:
  hair: "1px"
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "16px"
  row: "30px"
  tabbar: "40px"
  statusbar: "28px"
  sidebar: "260px"
  column: "720px"
components:
  button-primary:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
    typography: "{typography.ui}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.paper-muted}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.paper-faint}"
    rounded: "{rounded.sm}"
    size: "24px"
  bar-button-primary:
    backgroundColor: "{colors.paper-text}"
    textColor: "{colors.paper-editor}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
    typography: "{typography.caption}"
  toolbar-button:
    backgroundColor: "transparent"
    textColor: "{colors.paper-muted}"
    rounded: "{rounded.md}"
    size: "28px"
  input-search:
    backgroundColor: "{colors.paper-sunken}"
    textColor: "{colors.paper-text}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.paper-muted}"
    typography: "{typography.ui}"
    padding: "0 6px 0 12px"
    height: "34px"
  tab-active:
    backgroundColor: "{colors.paper-editor}"
    textColor: "{colors.paper-text}"
  tree-row:
    backgroundColor: "transparent"
    textColor: "{colors.paper-text}"
    typography: "{typography.sidebar}"
    rounded: "{rounded.md}"
    height: "{spacing.row}"
  menu:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.paper-text}"
    rounded: "{rounded.float}"
    padding: "6px"
    typography: "{typography.ui}"
  menu-row:
    rounded: "{rounded.md}"
    padding: "6px 10px"
  status-chip:
    backgroundColor: "transparent"
    textColor: "{colors.paper-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "3px 8px"
  dialog:
    backgroundColor: "{colors.paper-surface}"
    textColor: "{colors.paper-text}"
    rounded: "{rounded.dialog}"
    width: "600px"
---

# Design System: Zukai

## Overview

**Creative North Star: "The Receding Frame"**

Zukai is the category standard for a desktop notes app, played straight at the craft level of Linear, Obsidian and VS Code / Zed. The chrome (tab bar, sidebar, status bar) is a quiet frame one ground step darker than the page; the note itself sits on the editor ground at a comfortable reading size, and everything around it steps back. Depth comes from three ground steps and 1px hairlines, not from boxes or shadows.

The system is a set of interchangeable palettes over one structure. Five themes (Paper and Solar Light for light; Graphite, Midnight and Solar Dark for dark) swap the neutral grounds and inks; one user-chosen accent (blue, violet, green, orange or pink) marks selection, focus, links, the caret, checks and pressed tools on every theme. No component ever names a theme. The type is the operating system's own UI face, roomy rather than dense, with JetBrains Mono reserved for code.

Motion is nearly absent: floating pieces fade and settle in, a folder chevron turns, a checkbox fills. Everything else is instant, because the user is mid-task and the material leads.

**Key Characteristics:**

- Three ground steps per theme: chrome, editor, raised surface.
- One accent, with every tint of it derived by color-mix so each theme and accent pair agrees.
- 1px hairlines for every docked separation; shadows only on things that float.
- System UI face at 13px in chrome, 14px in the sidebar, 15px/1.65 in notes; mono only for code.
- Lucide line icons at one stroke weight; 30px rows with 6px rounded selection pills.

## Colors

Tinted neutrals in five palettes, a single user accent, and quiet status and syntax hues that live only where they carry meaning.

### Primary

- **Accent** (the user's choice; default Accent Blue, `#2563eb` on light grounds, `#5b8def` on dark): selection pills' active icon, keyboard focus, links, the caret, checked boxes, the pressed state of toolbar tools and find toggles, the active tab's icon, the Settings tab underline, drop targets. Each accent has a light-ground and a dark-ground value; on dark grounds violet, green, orange and pink take a near-black foreground of their own hue instead of white.
- **Accent derivations** (computed, never hand-picked): soft at 22% (text selection, editor selection, current-line number, match highlight in pickers), tint at 12% (pressed tool background, selected table cell, table-controls pill), 42% for the current search match, 14% for selection matches, 70% for the focus ring, 40% for a link's underline.

### Neutral

Each theme defines the same nine roles; the frontmatter carries all five sets.

- **Chrome** (Paper `#f4f4f5`, Graphite `#18181b`): tab bar, sidebar, status bar, the window background.
- **Editor** (Paper `#ffffff`, Graphite `#1f1f23`): the note and code ground, the active tab, the rich toolbar.
- **Surface** (Paper `#ffffff`, Graphite `#27272b`): raised floats: menus, pickers, find bar, dialog, notices, the selected segment of a segmented control.
- **Sunken** (Paper `#f4f4f5`, Graphite `#141416`): inputs, inline code, code blocks, table headers, kbd keys.
- **Hairline / Hairline Strong**: every 1px separator; strong for scrollbar thumbs, blockquote rules, split dividers and the swatch outline.
- **Text / Muted / Faint**: primary ink; secondary ink for inactive tabs, tree folders, status bar; faint for icons at rest, placeholders, hints, list markers and section labels.
- **Row hover / Row selected** (ink at 5% and 8% alpha on Paper and Graphite; 6% and 10% of warm brown on Solar Light): the only fills a list row takes.

Palette character: Paper is cool zinc; Solar Light is warm parchment (`#fbf8f2` page) for long reading; Graphite is neutral near-black; Midnight is blue-black; Solar Dark is warm and low-glare.

### Status and Syntax

- **Danger** (`#be123c` light, `#f87171` dark; text on a danger fill is `danger-fg`: white on light, `#2a0707` on dark): "Not saved", a refused rename, invalid regex, the delete confirmation.
- **Warn and Error bars** (amber and rose grounds with deep inks): the file bar for conflicts, missing files and unencodable text. Info bars use the chrome ground and muted ink.
- **Syntax** (keyword violet, string green, number and type amber-brown, function blue, comment gray): CodeMirror highlighting only, with lighter dark-scheme variants; Solar and Midnight retune only the comment gray.

### Named Rules

**The One Accent Rule.** The accent is the only hue in the chrome. It marks state (selected, focused, pressed, checked, linked) and nothing decorative; every lighter use is a color-mix of it, never a second hex.

**The Three Grounds Rule.** Chrome sits below the editor, which sits below raised surfaces. The active tab takes the editor ground and joins the page beneath it; nothing else gets a ground of its own.

**The Palette Swap Rule.** Every color comes from a `--z-*` token. A theme is a palette swap on `<html>` (`data-theme`, `data-palette`, `data-accent`); a component never branches on which theme is active.

## Typography

**Body Font:** Segoe UI Variable Text (with Segoe UI, the Apple system face, Inter Variable and system-ui)
**Label/Mono Font:** JetBrains Mono (with Cascadia Code, ui-monospace, SF Mono)

**Character:** The platform's own UI face, so the app feels native on each OS, set roomy rather than dense; a tight, sturdy 650 weight for note headings. JetBrains Mono, shipped with the app, appears only where text is code, with ligatures off.

### Hierarchy

- **Display** (650, 1.85em of the 15px note body, 1.25, -0.02em): a note's H1, balanced wrapping.
- **Headline** (650, 1.35em, 1.25, -0.01em): H2 in notes.
- **Title** (650, 1.12em, 1.25): H3; H4 to H6 sit at body size in the same weight.
- **Body** (400, 15px, 1.65): Markdown preview and rich editor, prose capped at 70ch inside a 720px column; strong is 650.
- **UI** (400, 13px, 1.4): tabs, menus, dialog, toolbar fields, notices. The sidebar tree reads at 14px.
- **Caption** (400 or 500, 12px): status bar, menu hints and details, file-bar buttons, kbd keys.
- **Label** (600, 11px, 0.06em, uppercase): sidebar section headings (Recent, Pinned, Library, Scratchpads; each 28px tall, 8px below what precedes it) and the shortcut table's group headings, in faint ink. Menu headings use the same size at 0.04em without uppercase.
- **Code** (400, 14px default, 1.65): the text editor, adjustable in Settings; 0.87em for inline code and code blocks in notes.

### Named Rules

**The Two Faces Rule.** The system UI face for everything; JetBrains Mono only where the content is code: the text editor, inline code and code blocks, the find and replace fields and their toggles, and the rich editor's raw fallback.

**The Reading Column Rule.** Notes read at 15px/1.65 in a 720px column with prose at 70ch, identically in the preview and the rich editor, set 56px in from the editor's left edge.

## Layout

A fixed desktop shell, not a responsive page. Left to right: the Library sidebar (260px default, resizable from 180px to 480px by a 6px handle on its right edge, 16px per arrow-key step), then the main column. Top to bottom in the main column: a 40px tab bar, an optional file bar (8px by 16px), the rich toolbar (at least 36px, wrapping its hairline-separated groups in a narrow Split, its first tool inset 50px to align with the text), the editor, and a 28px status bar.

The tab bar holds tabs 34px tall, 120px to 220px wide (380px for a joined Split tab), 2px apart, rising from 6px top padding so the active tab meets the editor. The sidebar stacks a 32px search field, Pinned (up to 35% of the height), the Library tree, and Scratchpads (up to 40%), with 8px side padding and rows 30px tall. Note content gets 56px side padding, 32px top and 64px bottom; the text editor's lines get 14px left and 32px right padding inside a 14px vertical content inset.

Rhythm is a 4px base with 6px and 10px steps in dense controls: menu rows 6px by 10px inside a 6px panel inset, icon buttons 24px or 28px, settings rows at least 44px. Long content scrolls inside its region; the window itself never scrolls.

## Elevation & Depth

Flat by default. Docked regions separate by ground step and a 1px hairline (sidebar right edge, status bar top, toolbar bottom, file bar bottom). Shadows belong only to things that float above the layout. The dark scheme's float shadow carries a 7% white ring so edges hold on near-black grounds.

### Shadow Vocabulary

- **Float** (`0 0 0 1px rgb(0 0 0 / 0.06), 0 2px 4px rgb(0 0 0 / 0.04), 0 8px 24px rgb(0 0 0 / 0.1)` light; `0 0 0 1px rgb(255 255 255 / 0.07), 0 2px 4px rgb(0 0 0 / 0.3), 0 12px 32px rgb(0 0 0 / 0.45)` dark): menus, pickers, the find bar, the Settings dialog, inline rename errors, the delete confirmation, and a tab while it is dragged.
- **Tab** (`0 0 0 1px rgb(0 0 0 / 0.06), 0 1px 2px rgb(0 0 0 / 0.06)` light; `0 0 0 1px rgb(255 255 255 / 0.05)` dark): the selected segment of a segmented control.
- **Scrim** (`rgb(0 0 0 / 0.4)`): behind the Settings dialog only.

### Named Rules

**The Float-Only Shadow Rule.** If it is docked, it gets a hairline; if it floats, it gets the float shadow. Nothing in between.

## Shapes

Gently rounded, tightening as elements nest. Rows, buttons, inputs and toolbar tools take 6px; small icon buttons and status chips 5px; segmented-control tracks 7px around 5px thumbs; tables, code blocks, theme swatches, the sidebar search and tab tops 8px; floats 10px; the dialog 12px. Inline code takes 5px, drawn checkboxes 4px, the inline rename field 3px. Accent dots and scrollbar thumbs are full circles and capsules (10px track, 3px transparent border).

Borders are 1px hairlines; blockquotes carry a 3px strong-hairline rule on the left. Focus is a 2px outline in the accent at 70%, offset 1px; tree rows and list rows show keyboard position as a 1px inset accent-soft ring instead.

### Named Rules

**The Nested Radius Rule.** A shape inside another takes a smaller radius: a 10px menu holds 6px rows, a 7px track holds 5px thumbs, an 8px table's header corners are 7px.

## Components

### Buttons

Small and unobtrusive; never oversized.

- **Shape:** 6px corners, 4px by 10px padding, 13px (12px medium in file bars).
- **Primary:** accent ground with the accent foreground (Choose Library folder). In file bars the primary is the theme's ink on the page ground (Keep mine, Save to original path), hover at 90% opacity.
- **Secondary (file bar):** a translucent white ground with a 1px ink ring at 10%; hover goes opaque.
- **Ghost:** muted ink, row-hover fill and text ink on hover.
- **Icon buttons:** 24px (tab close, sidebar heading actions, settings gear) at 5px corners, or 28px (toolbar, new tab, dialog close) at 6px; faint at rest, text ink on a row fill on hover. A tab's close button shows only on the active tab or on hover.
- **Danger:** danger ground with `danger-fg` text, for the delete confirmation's Delete only.
- **Disabled:** 40% to 60% opacity, no hover.

### Segmented controls and chips

- **Segmented:** a row-hover track (7px corners, 2px inset; 6px and 1px in the status bar) holding text segments; the chosen one takes the surface ground, text ink and the Tab shadow. Used for Mode, Markdown default, Rich/Markdown and Edit/Split/Preview.
- **Status chips:** 12px muted text, 3px by 8px, 5px corners; row-hover on hover, row-selected while their menu is open.
- **Accent picker:** 18px filled dots in 28px hit targets; the chosen one gets a 2px ring in the text ink.
- **Theme swatches:** 84px tiles with a 48px miniature of the theme (chrome strip, page with two ink bars and an accent bar), 6px corners, a strong-hairline ring that becomes a 2px accent ring when chosen.

### Inputs / Fields

- **Style:** sunken ground, 1px hairline border, 6px corners (8px for the sidebar search, 7px for the shortcut search), 28px to 32px tall, 13px text, faint placeholder.
- **Focus:** the border turns accent. The font-size field uses an inset accent-soft ring instead.
- **Error:** danger border and danger text (invalid regex in Find).

### Navigation

- **Tab bar:** tabs sit on the chrome in muted ink with a 15px faint icon; hover takes the row-hover fill; the active tab takes the editor ground, text ink and an accent icon, with 8px top corners and an 8px concave flare at each bottom corner in the editor ground, so it joins the page as one shape (the flares drop while the tab is dragged). A Split shows as one tab with a hairline between its two titles. Dragging lifts the tab with the float shadow.
- **Library tree:** 30px rows, 6px corners, 14px chevrons that rotate 90 degrees in 150ms, 16px Lucide icons; the active file gets the row-selected fill and an accent icon; folders read in muted ink, files in text ink. Drop targets get a row-selected fill and a 1px inset accent ring. Nested rows carry 1px hairline indent guides under each ancestor's chevron. The heading's New file, New folder, New canvas, Collapse all and ⋯ buttons fade in (150ms) while the sidebar is hovered or holds focus, and stay up while the Library is empty or unavailable.
- **Recent, Pinned and Scratchpads:** the same row grammar; open items read muted, closed ones faint. The row-selected fill marks the active Tab only at its home (its tree row, or its Scratchpads row); in Recent and Pinned the active item takes text ink and an accent icon without a fill, so one Tab never shows two selected rows. Scratchpads dock at the sidebar's foot under a full-width hairline.
- **Settings tabs:** text tabs with a 2px accent underline when selected.

### Menus and pickers

The Float shadow on the surface ground, 10px corners, 6px inset, 13px text, 192px to 360px wide. Rows are 6px pills, 6px by 10px, row-selected on the active one; hints and details at 12px faint; a separator is a full-bleed hairline. Pickers (Language, Encoding) add a sunken search field and mark the highlighted row with accent-soft. They enter with the fade-in.

### Rich toolbar

A slim strip on the editor ground under a hairline: 28px icon tools in groups separated by a hairline and 6px, muted at rest; pressed tools take the accent tint and accent ink. Inside a table, an accent-tint pill (28px, 6px corners) offers table controls.

### Notes: tables, checklists, code

- **Tables:** rows, not boxes. A 1px hairline outline with 8px corners, a sunken header in muted 600 ink, hairline row rules, no cell grid, 7px by 14px cells, tabular numbers, row hover fill.
- **Checklists:** drawn 15px boxes with 4px corners and a 1.5px faint border; the accent border on hover; checked fills with the accent and draws a tick in the accent foreground, and the item text turns muted with a faint strike.
- **Code:** sunken blocks with 8px corners, a hairline border and 14px by 16px padding; inline code at 0.87em with 5px corners.
- **Links:** accent text with a 40% accent underline 3px below, full accent on hover.

### Notices

- **File bar:** a full-width strip under the tab bar (8px by 16px, 13px) in the warn, error or info pair, with its actions at the end; it fades in.
- **Inline error:** a small float (max 280px, 12px danger text) under a rename field.

### Icons

Lucide line icons, one stroke weight throughout: 1.6 at 16px (the default), absolute stroke below 16px; 1.8 for the small plus, close, more and search marks. Each file kind maps to one icon by extension. Icons rest in faint or muted ink and take the accent only to mark the active item.

## Do's and Don'ts

### Do:

- **Do** take every color from a `--z-*` token so all five themes and five accents work without component changes.
- **Do** derive every lighter accent use with color-mix from the accent (22% soft, 12% tint, 70% focus).
- **Do** separate docked regions with a 1px hairline and a ground step.
- **Do** keep list rows at 30px with 6px corners and only the row-hover and row-selected fills.
- **Do** use Lucide icons at stroke 1.6, 16px by default and 14px to 15px in dense chrome.
- **Do** keep keyboard focus visible: a 2px accent outline at 70%, offset 1px, or a 1px inset accent-soft ring on rows.
- **Do** limit motion to the 140ms fade-in (`cubic-bezier(0.16, 1, 0.3, 1)`, 2px rise and 0.99 scale), the 150ms chevron turn and the 120ms checkbox fill, and drop the fade under reduced motion.
- **Do** set note tables as rows: sunken header, hairline rules, tabular numbers.

### Don't:

- **Don't** add a second chrome hue; status and syntax colors appear only where they carry meaning.
- **Don't** put shadows on docked surfaces; the float shadow is for menus, pickers, the find bar, dialogs and a dragged tab.
- **Don't** use text glyphs as icons (check marks, triangles, warning signs, brace pairs); draw them or use Lucide. Platform key symbols in shortcut labels are notation, not icons.
- **Don't** set chrome in JetBrains Mono; mono is for code and code-search fields.
- **Don't** draw a cell grid in tables or glyph checkboxes in checklists.
- **Don't** build dashboard layouts, oversized buttons or extra sidebars; toolbars stay small and the editor area stays the largest thing on screen.
