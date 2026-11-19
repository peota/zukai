import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * The "Paper" editor theme. Every value is a CSS variable from app.css, so
 * the editor follows the OS light/dark switch live, like the rest of the UI.
 */
const paper = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--z-editor)",
    color: "var(--z-text)",
    fontFamily: "var(--z-font-mono)",
    // Set by EditorHost (Mod+wheel, Mod+= / Mod+-).
    fontSize: "var(--z-editor-font-size, 13px)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.6",
  },
  ".cm-content": {
    padding: "12px 0",
    caretColor: "var(--z-text)",
  },
  ".cm-line": { padding: "0 24px 0 12px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--z-text)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
    { backgroundColor: "var(--z-accent-soft)" },
  ".cm-gutters": {
    backgroundColor: "var(--z-editor)",
    color: "var(--z-faint)",
    border: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 4px 0 16px",
    minWidth: "32px",
  },
  // A quiet fold gutter: open markers appear while the gutter is hovered;
  // a folded line's marker always shows.
  ".cm-foldGutter .cm-gutterElement": {
    padding: "0 4px 0 2px",
    cursor: "pointer",
    color: "var(--z-faint)",
  },
  ".cm-foldGutter .cm-gutterElement:hover": { color: "var(--z-muted)" },
  ".z-fold-open": { opacity: "0", transition: "opacity 120ms" },
  ".cm-gutters:hover .z-fold-open": { opacity: "1" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--z-accent-soft)",
    border: "none",
    borderRadius: "3px",
    color: "var(--z-muted)",
    padding: "0 4px",
    margin: "0 2px",
  },
  ".cm-activeLine": { backgroundColor: "var(--z-active-line)" },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--z-active-line)",
    color: "var(--z-muted)",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--z-accent-soft)",
    outline: "none",
  },
  ".cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    color: "var(--z-danger)",
    backgroundColor: "transparent",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--z-selection-match)" },
});

const highlight = HighlightStyle.define([
  {
    tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword],
    color: "var(--z-syn-keyword)",
  },
  {
    tag: [t.string, t.special(t.string), t.regexp, t.character],
    color: "var(--z-syn-string)",
  },
  {
    tag: [t.number, t.bool, t.null, t.atom, t.constant(t.name)],
    color: "var(--z-syn-number)",
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta],
    color: "var(--z-faint)",
    fontStyle: "italic",
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
    color: "var(--z-syn-function)",
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.tagName],
    color: "var(--z-syn-type)",
  },
  { tag: [t.propertyName, t.attributeName], color: "var(--z-syn-function)" },
  { tag: t.heading, color: "var(--z-syn-keyword)", fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "var(--z-syn-function)" },
  { tag: t.url, color: "var(--z-syn-string)" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "var(--z-danger)" },
]);

export const zukaiTheme: Extension = [paper, syntaxHighlighting(highlight)];
