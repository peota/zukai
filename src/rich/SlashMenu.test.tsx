import { act, fireEvent, screen } from "@testing-library/react";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { describe, expect, it } from "vitest";
import { mountRich, select, tablesIn } from "./richTestKit";

const menu = () => screen.queryByRole("listbox", { name: "Insert block" });
const options = () =>
  screen.queryAllByRole("option").map((o) => o.textContent ?? "");

/** Types `text` at the cursor, one character per transaction. */
function type(view: EditorView, text: string) {
  for (const ch of text) {
    act(() => view.dispatch(view.state.tr.insertText(ch)));
  }
}

/** A new empty paragraph after the one holding `text`, with the cursor. */
function newLineAfter(view: EditorView, text: string) {
  act(() => select(view, text, text.length));
  act(() => view.dispatch(view.state.tr.split(view.state.selection.from)));
}

describe("SlashMenu", () => {
  it("slash_filters_and_inserts_table", async () => {
    const { view, md } = await mountRich("intro\n");
    newLineAfter(view, "intro");
    type(view, "/");
    expect(menu()).not.toBeNull();
    expect(options().length).toBeGreaterThanOrEqual(11);
    type(view, "tab");
    expect(options()).toEqual(["Table"]);
    const ev = fireEvent.keyDown(view.dom, { key: "Enter" });
    expect(ev).toBe(false);
    expect(menu()).toBeNull();
    const text = md();
    expect(text).not.toContain("/tab");
    expect(text.startsWith("intro\n\n|")).toBe(true);
    expect(tablesIn(text)).toEqual([
      [
        ["", "", ""],
        ["", "", ""],
      ],
    ]);
  });

  it("slash_arrows_choose", async () => {
    const { view, md } = await mountRich("intro\n");
    newLineAfter(view, "intro");
    type(view, "/head");
    expect(options()).toEqual(["Heading 1", "Heading 2", "Heading 3"]);
    fireEvent.keyDown(view.dom, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Heading 2" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(view.dom, { key: "Enter" });
    type(view, "Title");
    expect(md()).toBe("intro\n\n## Title\n");
  });

  it("slash_escape_leaves_text", async () => {
    const { view, md } = await mountRich("intro\n");
    newLineAfter(view, "intro");
    type(view, "/he");
    expect(menu()).not.toBeNull();
    fireEvent.keyDown(view.dom, { key: "Escape" });
    expect(menu()).toBeNull();
    expect(md()).toBe("intro\n\n/he\n");
    // Typing on doesn't bring it back.
    type(view, "y");
    expect(menu()).toBeNull();
  });

  it("slash_click_outside_closes", async () => {
    const { view, md } = await mountRich("intro\n");
    newLineAfter(view, "intro");
    type(view, "/");
    expect(menu()).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(menu()).toBeNull();
    expect(md()).toBe("intro\n\n/\n");
  });

  it("slash_only_at_the_start_of_an_empty_paragraph", async () => {
    const { view } = await mountRich("intro\n\n```\ncode\n```\n\nsome `x`\n");
    // Mid-sentence.
    act(() => select(view, "intro", 5));
    type(view, "/");
    expect(menu()).toBeNull();
    // In a code block.
    act(() => select(view, "code", 4));
    act(() => view.dispatch(view.state.tr.split(view.state.selection.from)));
    type(view, "/");
    expect(menu()).toBeNull();
    // As inline code, in an empty paragraph.
    newLineAfter(view, "x");
    const code = view.state.schema.marks.inlineCode.create();
    act(() => view.dispatch(view.state.tr.addStoredMark(code)));
    type(view, "/");
    expect(menu()).toBeNull();
    // Before existing text.
    act(() => select(view, "intro", 0));
    type(view, "/");
    expect(menu()).toBeNull();
  });

  it("slash_not_offered_when_read_only", async () => {
    const { view } = await mountRich("\n", { readOnly: true });
    act(() =>
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
      ),
    );
    type(view, "/");
    expect(menu()).toBeNull();
  });
});
