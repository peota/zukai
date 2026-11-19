/** What the rich editor's own UI (toolbar, menus) reaches it through. */
import { createContext, useContext, useSyncExternalStore } from "react";
import type { Editor } from "@milkdown/kit/core";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

/**
 * Tags a transaction that isn't the user's (the mount, a re-parse after an
 * outside change): it never writes the Tab's text.
 */
export const PROGRAMMATIC = "zukaiProgrammatic";

export const isProgrammatic = (tr: Transaction) => !!tr.getMeta(PROGRAMMATIC);

/** The live Milkdown editor and its ProseMirror view. */
export interface RichHandle {
  editor: Editor;
  view: EditorView;
  /** Whether the Tab refuses edits now. */
  readOnly: boolean;
  /** Called after every transaction the view applied. */
  subscribe(cb: (tr: Transaction) => void): () => void;
}

export const RichContext = createContext<RichHandle | null>(null);

/** The enclosing RichEditor's editor and view (null outside one). */
export function useRich(): RichHandle | null {
  return useContext(RichContext);
}

/** The view's state, re-rendering on every transaction. */
export function useRichState(rich: RichHandle): EditorState {
  return useSyncExternalStore(rich.subscribe, () => rich.view.state);
}
