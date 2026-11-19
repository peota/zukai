import { act, fireEvent } from "@testing-library/react";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { describe, expect, it, vi } from "vitest";
import { RICH_DEBOUNCE_MS } from "./RichEditor";
import { mountRich, select } from "./richTestKit";

/** A key through ProseMirror's own key handling (its keymaps). */
const press = (view: EditorView, key: string, mods: KeyboardEventInit = {}) =>
  act(() => {
    fireEvent.keyDown(view.dom, { key, ...mods });
  });

const typeText = (view: EditorView, text: string) =>
  act(() => view.dispatch(view.state.tr.insertText(text)));

const types = (view: EditorView) => {
  const out: string[] = [];
  view.state.doc.forEach((n) => out.push(n.type.name));
  return out;
};

/** No raw block anywhere: those only come from parsing. */
const noRaw = (view: EditorView) => {
  view.state.doc.descendants((n) => {
    expect(n.type.name).not.toBe("zukai_raw");
  });
};

describe("ordinary editing", () => {
  it("enter_at_end_of_paragraph_makes_a_paragraph", async () => {
    const { view, md } = await mountRich("one\n");
    act(() => select(view, "one", 3));
    press(view, "Enter");
    typeText(view, "two");
    expect(types(view)).toEqual(["paragraph", "paragraph"]);
    noRaw(view);
    expect(md()).toBe("one\n\ntwo\n");
  });

  it("enter_at_end_of_heading_makes_a_paragraph", async () => {
    const { view, md } = await mountRich("# One\n");
    act(() => select(view, "One", 3));
    press(view, "Enter");
    typeText(view, "two");
    expect(types(view)).toEqual(["heading", "paragraph"]);
    noRaw(view);
    expect(md()).toBe("# One\n\ntwo\n");
  });

  it("typing_into_a_new_empty_document_makes_a_paragraph", async () => {
    const { view, md } = await mountRich("");
    expect(types(view)).toEqual(["paragraph"]);
    act(() =>
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
      ),
    );
    typeText(view, "hi");
    press(view, "Enter");
    typeText(view, "there");
    expect(types(view)).toEqual(["paragraph", "paragraph"]);
    expect(md()).toBe("hi\n\nthere\n");
  });

  it("enter_on_an_empty_list_item_leaves_the_list_as_a_paragraph", async () => {
    const { view, md } = await mountRich("- a\n");
    act(() => select(view, "a", 1));
    press(view, "Enter");
    press(view, "Enter");
    typeText(view, "after");
    expect(types(view)).toEqual(["bullet_list", "paragraph"]);
    noRaw(view);
    expect(md()).toBe("- a\n\nafter\n");
  });

  it("enter_twice_in_a_quote_leaves_it_as_a_paragraph", async () => {
    const { view, md } = await mountRich("> q\n");
    act(() => select(view, "q", 1));
    press(view, "Enter");
    press(view, "Enter");
    typeText(view, "after");
    expect(types(view)).toEqual(["blockquote", "paragraph"]);
    expect(md()).toBe("> q\n\nafter\n");
  });

  it("leaving_a_code_block_or_a_table_makes_a_paragraph", async () => {
    const { view, md } = await mountRich(
      "```\nx\n```\n\n| a |\n| - |\n| cell |\n",
    );
    act(() => select(view, "x", 1));
    press(view, "Enter", { ctrlKey: true });
    typeText(view, "p1");
    act(() => select(view, "cell", 4));
    press(view, "Enter", { ctrlKey: true });
    typeText(view, "p2");
    noRaw(view);
    expect(types(view)).toEqual([
      "code_block",
      "paragraph",
      "table",
      "paragraph",
    ]);
    expect(md()).toContain("p1");
    expect(md().endsWith("p2\n")).toBe(true);
  });

  it("backspace_joining_keeps_paragraphs", async () => {
    const { view, md } = await mountRich("one\n\ntwo\n");
    act(() => select(view, "two", 0));
    press(view, "Backspace");
    expect(types(view)).toEqual(["paragraph"]);
    expect(md()).toBe("onetwo\n");
  });

  it("raw_blocks_still_come_from_parsing", async () => {
    const { view, md } = await mountRich("---\na: 1\n---\n\n<div>x</div>\n");
    expect(types(view)).toEqual(["zukai_raw", "zukai_raw"]);
    expect(md()).toBe("---\na: 1\n---\n\n<div>x</div>\n");
  });

  it("toolbar_edit_reaches_the_tab_text", async () => {
    const { view, bridge, getByRole } = await mountRich("one\n");
    vi.useFakeTimers();
    try {
      act(() => select(view, "one"));
      fireEvent.click(getByRole("button", { name: "Bold" }));
      expect(bridge.text("a")).toBe("one\n");
      act(() => vi.advanceTimersByTime(RICH_DEBOUNCE_MS + 10));
      expect(bridge.text("a")).toBe("**one**\n");
      expect(bridge.replace).toHaveBeenCalledWith("a", "**one**\n");
    } finally {
      vi.useRealTimers();
    }
  });
});
