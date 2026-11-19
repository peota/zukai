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

describe("checklists", () => {
  /** A press on the box drawn left of the item's text. */
  const pressBox = (view: EditorView, n = 0) =>
    act(() => {
      const li = view.dom.querySelectorAll('li[data-item-type="task"]')[n];
      // jsdom lays nothing out: the item's box starts at 0, so a press left
      // of it is on the drawn checkbox.
      fireEvent.mouseDown(li, { clientX: -10, button: 0 });
    });

  it("clicking_the_box_ticks_and_unticks_it", async () => {
    const { view, bridge, md } = await mountRich("- [ ] a\n- [ ] b\n");
    vi.useFakeTimers();
    try {
      pressBox(view);
      expect(md()).toBe("- [x] a\n- [ ] b\n");
      act(() => vi.advanceTimersByTime(RICH_DEBOUNCE_MS + 10));
      expect(bridge.text("a")).toBe("- [x] a\n- [ ] b\n");
      pressBox(view);
      act(() => vi.advanceTimersByTime(RICH_DEBOUNCE_MS + 10));
      expect(bridge.text("a")).toBe("- [ ] a\n- [ ] b\n");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clicking_the_text_does_not_tick", async () => {
    const { view, md } = await mountRich("- [ ] a\n");
    // ProseMirror handles this press itself, and asks where it landed:
    // jsdom has no layout to say.
    const doc = document as { elementFromPoint?: unknown };
    doc.elementFromPoint = () => null;
    try {
      act(() => {
        const p = view.dom.querySelector('li[data-item-type="task"] p')!;
        fireEvent.mouseDown(p, { clientX: 20, button: 0 });
        fireEvent.mouseUp(p, { clientX: 20, button: 0 });
      });
    } finally {
      delete doc.elementFromPoint;
    }
    expect(md()).toBe("- [ ] a\n");
  });

  it("read_only_refuses_a_tick", async () => {
    const { view, bridge, md } = await mountRich("- [ ] a\n", {
      readOnly: true,
    });
    pressBox(view);
    expect(md()).toBe("- [ ] a\n");
    expect(bridge.replace).not.toHaveBeenCalled();
  });

  it("mod_enter_toggles_the_item", async () => {
    const { view, md } = await mountRich("- [ ] a\n  - [x] b\n");
    act(() => select(view, "b", 0));
    press(view, "Enter", { ctrlKey: true });
    expect(md()).toBe("- [ ] a\n  - [ ] b\n");
    act(() => select(view, "a", 1));
    press(view, "Enter", { ctrlKey: true });
    expect(md()).toBe("- [x] a\n  - [ ] b\n");
  });

  it("mod_enter_outside_a_checklist_is_unchanged", async () => {
    const { view, md } = await mountRich("- a\n\n```\ncode\n```\n");
    act(() => select(view, "a", 1));
    press(view, "Enter", { ctrlKey: true });
    expect(md()).not.toContain("[x]");
    expect(md()).not.toContain("[ ]");
    // In a code block it still leaves the block (exitCode).
    act(() => select(view, "code", 4));
    press(view, "Enter", { ctrlKey: true });
    expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
  });
});

describe("deleting a selected table", () => {
  const SRC = "before\n\n| a | b |\n| - | - |\n| c | d |\n\nafter\n";

  /** Every cell of the note's table selected, as a drag across it does. */
  const selectWholeTable = async (view: EditorView) => {
    const { CellSelection } = await import("@milkdown/kit/prose/tables");
    let at = -1;
    view.state.doc.forEach((n, off) => {
      if (n.type.name === "table") at = off;
    });
    const table = view.state.doc.nodeAt(at)!;
    const cells: number[] = [];
    table.descendants((n, p) => {
      if (n.type.spec.tableRole?.toString().includes("cell")) {
        cells.push(at + 1 + p);
      }
    });
    act(() =>
      view.dispatch(
        view.state.tr.setSelection(
          CellSelection.create(
            view.state.doc,
            cells[0],
            cells[cells.length - 1],
          ),
        ),
      ),
    );
  };

  for (const key of ["Delete", "Backspace"]) {
    it(`${key}_on_a_whole_table_removes_it`, async () => {
      const { view, md } = await mountRich(SRC);
      await selectWholeTable(view);
      press(view, key);
      expect(types(view)).not.toContain("table");
      expect(md()).toBe("before\n\nafter\n");
    });
  }

  it("delete_on_some_cells_still_only_clears_them", async () => {
    const { CellSelection } = await import("@milkdown/kit/prose/tables");
    const { view, md } = await mountRich(SRC);
    let at = -1;
    view.state.doc.forEach((n, off) => {
      if (n.type.name === "table") at = off;
    });
    // Just the first header cell.
    const cell = at + 2;
    act(() =>
      view.dispatch(
        view.state.tr.setSelection(
          CellSelection.create(view.state.doc, cell, cell),
        ),
      ),
    );
    press(view, "Delete");
    expect(types(view)).toContain("table");
    expect(md()).toContain("| c | d |");
  });

  it("read_only_keeps_the_table", async () => {
    const { view, md } = await mountRich(SRC, { readOnly: true });
    await selectWholeTable(view);
    press(view, "Delete");
    expect(md()).toContain("| a | b |");
  });
});
