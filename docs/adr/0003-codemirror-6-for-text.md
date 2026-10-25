# 3. CodeMirror 6 for Text Documents

Date: 2026-10-25
Status: Accepted

## Context

The text editor is what users see first and use most. It needs syntax highlighting for common developer formats, search, standard editing shortcuts, and light and dark themes. Above all it has to start fast.

The options we considered:
- **CodeMirror 6:** modular, with a core of a few hundred KB. It starts almost instantly, handles large files well, and has official language packages (JSON, XML, JavaScript/TypeScript, SQL, Markdown, Python and more). Search and replace, multiple cursors, folding and keymaps all come built in.
- **Monaco:** feels exactly like VS Code, but it's several MB, uses web workers, and starts noticeably slower. Most of that weight is language-service features a scratchpad doesn't need.

## Decision

Use CodeMirror 6 for Text Documents.

## Consequences

- Search within a Document comes from `@codemirror/search`: find and replace with case, regex and whole-word options, find next and previous, go to line, and select next occurrence. Its panel will be restyled, or replaced with our own bar that uses the same search engine.
- Searching across all Tabs isn't provided, and Zukai would have to build it. It's deferred.
- Zukai writes a single editor theme that reads the app's CSS color variables, so the editor follows the app's light and dark themes. Themes are switched on the fly without reloading the editor. Excalidraw's `theme` setting is switched at the same time.
- CodeMirror doesn't detect languages. Zukai sets a Text Document's Language from the File extension, or for a Scratchpad from a guess based on its content, and the user can override it in the status bar.
