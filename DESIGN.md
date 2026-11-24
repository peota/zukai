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
  warn: "#b45309"
  warn-dark: "#d97706"
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
  statusbar: "32px"
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
  git-row:
    backgroundColor: "transparent"
    textColor: "{colors.paper-faint}"
    rounded: "{rounded.sm}"
    height: "22px"
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

<!-- impeccable:design-map -->
Name: Zukai
Colors: primary: accent-blue #2563eb; neutral: paper-chrome #f4f4f5; status: danger #be123c; syntax: syn-keyword #8b3fd9; primary: accent-blue-dark #5b8def; primary: accent-violet #7c3aed (+78 more in the sidecar)
Fonts: Segoe UI Variable Text (display, headline, title, body, ui, sidebar, caption, label); JetBrains Mono (code)
Spacing: hair 1px, xs 4px, sm 6px, md 10px, lg 16px, row 30px, tabbar 40px, statusbar 32px, sidebar 260px, column 720px
Radius: xs 4px, sm 5px, md 6px, track 7px, lg 8px, float 10px, dialog 12px, full 999px
North Star: "The Receding Frame"
Rules:
- The One Accent Rule. The accent is the only hue in the chrome.
- The Three Grounds Rule. Chrome sits below the editor, which sits below raised surfaces.
- The Palette Swap Rule. Every color comes from a `--z-*` token.
- The Two Faces Rule. The system UI face for everything; JetBrains Mono only where the content is code: the text editor, inline code and code blocks, the find and replace fields and their toggles, and the rich editor's raw fallback.
- The Reading Column Rule. Notes read at 15px/1.65 in a 720px column with prose at 70ch, identically in the preview and the rich editor, set 56px in from the editor's left edge.
- The Float-Only Shadow Rule. If it is docked, it gets a hairline; if it floats, it gets the float shadow.
- The Nested Radius Rule. A shape inside another takes a smaller radius: a 10px menu holds 6px rows, a 7px track holds 5px thumbs, an 8px table's header corners are 7px.
Elevation:
- Float: 0 0 0 1px rgb(0 0 0 / 0.06), 0 2px 4px rgb(0 0 0 / 0.04), 0 8px 24px rgb(0 0 0 / 0.1)
- Tab: 0 0 0 1px rgb(0 0 0 / 0.06), 0 1px 2px rgb(0 0 0 / 0.06)
- Scrim: rgb(0 0 0 / 0.4)
Don't:
- Don't add a second chrome hue; status and syntax colors appear only where they carry meaning.
- Don't put shadows on docked surfaces; the float shadow is for menus, pickers, the find bar, dialogs and a dragged tab.
- Don't use text glyphs as icons (check marks, triangles, warning signs, brace pairs); draw them or use Lucide.
- Don't set chrome in JetBrains Mono; mono is for code and code-search fields.
- Don't draw a cell grid in tables or glyph checkboxes in checklists.
- Don't build dashboard layouts, oversized buttons or extra sidebars; toolbars stay small and the editor area stays the largest thing on screen.
Full: .impeccable/design-full.md (read a section when you need its detail)
