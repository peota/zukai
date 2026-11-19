---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/styles/app.css"]
---

## Scope

The whole Zukai app shell: window/tab bar, Library sidebar, editors (text, rich Markdown, preview), status bar, menus, dialogs and file bars. Mode: Operate. Audience and job per PRODUCT.md.

## Constraints

- Canon chosen by the owner on the decision round (category standard, played straight). Craft bar: Linear, Obsidian, VS Code / Zed.
- Five themes: Graphite (dark), Midnight (dark), Solar Dark, Paper (light), Solar Light. Mode setting System/Light/Dark; System follows the OS between the chosen light and dark theme. Accent is its own setting (blue, violet, green, orange, pink) and works on every theme.
- Owner complaints to fix: fonts too dense and small, tables look bad, icons are ugly.
- Keep every behavior, shortcut, test and CONTEXT.md term.

## Direction contract

THESIS: A modern notes app done impeccably: graphite chrome that recedes, roomy legible type, one accent. Refuses the IDE-gray density of the incumbent (12.5px chrome, glyph checkboxes, bordered table soup).

OWN-WORLD: Neutral tinted grounds per theme with three surface steps (sidebar/tab bar, editor, raised); 1px hairlines; one user accent for selection, focus, links, checks. Rounded 6px selection pills, 8px floats, Lucide-weight 1.5px line icons at 16px. System UI face per OS (Segoe UI Variable / SF / Inter fallback), JetBrains Mono for code only.

STORY: Open, see the note at a comfortable size, find anything in the Library tree, switch tabs, read tables and checklists at a glance, change theme and accent in Settings.

FIRST VIEWPORT: Left 260px sidebar (search, Library tree, Pinned, Scratchpads); 40px tab bar with rounded-top tabs, active tab joined to the editor; quiet 36px rich toolbar; editor column max 720px at 15px/1.65; 28px status bar.

FORM: canon (category standard), seed: seed:ac6dbf0a9ee861c5.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
