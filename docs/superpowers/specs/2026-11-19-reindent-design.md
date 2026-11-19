# Zukai — Re-indent code

Date: 2026-11-19
Status: Approved 2026-11-19

## Intent

The owner wants VS Code's habit to work here: press **Shift+Alt+F** in a code file and have it tidied. Today that key only beautifies JSON.

## Approaches (decided 2026-11-19)

1. **Re-indent only. Chosen.** It fixes leading whitespace using each language's own indentation rules, with no new libraries and predictable results.
2. **Full formatter (Prettier, bundled and lazy-loaded).** Rejected for now. It's 1–2 MB, doesn't cover Python, SQL or shell, and rewrites whole files. It could be added later.

## Behaviour

- **Shift+Alt+F** in a text Tab:
  - **JSON:** Beautify, as today. Nothing changes.
  - **JavaScript, TypeScript, HTML, XML, CSS, SQL:** re-indents the selected lines, or the whole document when nothing is selected.
    - Only leading whitespace changes.
    - It is one undo step.
    - Selections and the cursor stay on the same text.
  - **Python, YAML, Markdown, shell, plain text:** nothing happens. *(My call: in Python and YAML indentation **is** the meaning, so re-indenting could change what the code does. Markdown lists and code blocks have the same problem. Plain text and shell have no indentation rules.)*
- **Read-only Tabs:** nothing happens, as with Format JSON.
- **Indentation width:** the editor's existing indent unit, the same one Tab uses.
- **Settings → Keyboard shortcuts:** the entry is renamed from "Format JSON" to **"Format JSON / re-indent code"**.
- The hidden CodeMirror key **Mod+Alt+\\** (re-indent selection) stays as it is. It isn't listed.

## Design

- **No new Command.** The existing `format` command keeps its "beautify" request.
- **The change is in `EditorHost`'s format effect.** JSON goes to `formatJson` as now. A language in `REINDENT_LANGUAGES` instead dispatches a re-indent built from `indentRange` (`@codemirror/language`) over the selected lines, or the whole document, with `userEvent: "input.indent"`.
- **The JSON Format menu's Minify** stays JSON-only.

## Testing

- Re-indent a badly indented JS snippet. Check the exact output, that it is one undo step, and that only the selected lines change when there is a selection.
- Python, YAML and plain text are left untouched.
- A read-only Tab is left untouched.
- JSON still beautifies.
- The Settings list shows the new label.
