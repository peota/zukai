/** Test helpers: a RichEditor over a plain-string Tab text. */
import { act, render, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import { serializerCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { TextBridge } from "../editor/EditorHost";
import RichEditor, { type RichEditorProps } from "./RichEditor";
import { useRich, type RichHandle } from "./richContext";

export function fakeBridge(texts: Record<string, string>) {
  return {
    text: (id: string) => texts[id] ?? null,
    replace: vi.fn((id: string, text: string) => {
      texts[id] = text;
    }),
    onOutsideChange: () => () => {},
    clearHistory: vi.fn(),
    readOnly: () => false,
    ready: async () => {},
  } satisfies TextBridge;
}

/** Mounts a RichEditor on `text`; resolves once the editor exists. */
export async function mountRich(
  text: string,
  over: Partial<RichEditorProps> = {},
) {
  const bridge = fakeBridge({ a: text });
  let handle: RichHandle | null = null;
  function Grab() {
    handle = useRich();
    return null;
  }
  const props: RichEditorProps = {
    id: "a",
    bridge,
    readOnly: false,
    focused: true,
    fontSize: 14,
    onOpenLink: vi.fn(),
    onFallback: vi.fn(),
    ...over,
  };
  const r = render(
    <RichEditor {...props}>
      <Grab />
    </RichEditor>,
  );
  const rich = await waitFor(() => {
    expect(handle).not.toBeNull();
    return handle!;
  });
  // The handle is seen while rendering: let the editor's UI finish mounting
  // (its effects add the key and transaction listeners).
  await act(async () => {});
  const view: EditorView = rich.view;
  /** The Markdown the editor serializes now. */
  const md = () => rich.editor.ctx.get(serializerCtx)(view.state.doc);
  return { ...r, bridge, props, view, md };
}

/** The first position where `text` starts, plus `offset`. */
export function posOf(view: EditorView, text: string, offset = 0): number {
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText) {
      const i = node.text!.indexOf(text);
      if (i >= 0) found = pos + i;
    }
    return true;
  });
  if (found < 0) throw new Error(`no "${text}" in the doc`);
  return found + offset;
}

/** Selects `text` (or puts the cursor at its start + `offset`). */
export function select(view: EditorView, text: string, cursor?: number) {
  const from = posOf(view, text);
  const sel =
    cursor === undefined
      ? TextSelection.create(view.state.doc, from, from + text.length)
      : TextSelection.create(view.state.doc, from + cursor);
  view.dispatch(view.state.tr.setSelection(sel));
}

type MdNode = { type: string; value?: string; children?: MdNode[] };
const gfm = unified().use(remarkParse).use(remarkGfm);

/** The GFM tables in `md`, as rows of cell texts. */
export function tablesIn(md: string): string[][][] {
  const text = (n: MdNode): string =>
    n.value ?? (n.children ?? []).map(text).join("");
  const out: string[][][] = [];
  const walk = (n: MdNode) => {
    if (n.type === "table") {
      out.push((n.children ?? []).map((row) => (row.children ?? []).map(text)));
    }
    n.children?.forEach(walk);
  };
  walk(gfm.parse(md) as unknown as MdNode);
  return out;
}
