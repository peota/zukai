import { describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { EditorHost, type EditorHostProps } from "./EditorHost";
import type { TabState } from "../model/types";

function tab(id: string, over: Partial<TabState> = {}): TabState {
  return {
    id,
    title: id,
    renamed: false,
    language: "plaintext",
    languagePicked: false,
    languageGuessed: false,
    selection: { anchor: 0, head: 0 },
    scrollTop: 0,
    wrap: false,
    ...over,
  };
}

function setup(over: Partial<EditorHostProps> = {}) {
  const props: EditorHostProps = {
    tabs: [tab("a"), tab("b")],
    activeId: "a",
    loadContent: (id) => Promise.resolve(`text of ${id}`),
    onChange: vi.fn(),
    onTabPatch: vi.fn(),
    onCursor: vi.fn(),
    isClosing: () => false,
    ...over,
  };
  const r = render(<EditorHost {...props} />);
  const rerender = (next: Partial<EditorHostProps>) => {
    Object.assign(props, next);
    r.rerender(<EditorHost {...props} />);
  };
  return { ...r, props, rerender };
}

function viewsIn(container: HTMLElement): EditorView[] {
  return [...container.querySelectorAll<HTMLElement>(".cm-editor")].map((el) =>
    EditorView.findFromDOM(el)!,
  );
}

async function activeView(container: HTMLElement, text: string) {
  return waitFor(() => {
    const v = viewsIn(container).find((x) => x.state.doc.toString() === text);
    expect(v).toBeDefined();
    return v!;
  });
}

describe("EditorHost", () => {
  it("creates the active view from loaded text and restores selection", async () => {
    const { container } = setup({
      tabs: [tab("a", { selection: { anchor: 2, head: 4 } }), tab("b")],
    });
    const v = await activeView(container, "text of a");
    expect(v.state.selection.main).toMatchObject({ anchor: 2, head: 4 });
    expect(viewsIn(container)).toHaveLength(1); // b is not created yet
  });

  it("reports every edit through onChange with the full text", async () => {
    const { container, props } = setup();
    const v = await activeView(container, "text of a");
    act(() =>
      v.dispatch({
        changes: { from: 0, insert: "X" },
        userEvent: "input.type",
      }),
    );
    expect(props.onChange).toHaveBeenLastCalledWith("a", "Xtext of a");
  });

  it("guesses the Language on the first paste, only once", async () => {
    const { container, props } = setup({
      loadContent: () => Promise.resolve(""),
    });
    const v = await activeView(container, "");
    act(() =>
      v.dispatch({
        changes: { from: 0, insert: '{"a":[1,2]}' },
        userEvent: "input.paste",
      }),
    );
    expect(props.onTabPatch).toHaveBeenCalledWith("a", {
      language: "json",
      languageGuessed: true,
    });
    vi.mocked(props.onTabPatch).mockClear();
    act(() =>
      v.dispatch({
        changes: { from: 0, insert: "<?xml?>" },
        userEvent: "input.paste",
      }),
    );
    expect(props.onTabPatch).not.toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ languageGuessed: true }),
    );
  });

  it("never guesses once a Language was picked by hand", async () => {
    const { container, props } = setup({
      tabs: [tab("a", { languagePicked: true, language: "sql" })],
      loadContent: () => Promise.resolve(""),
    });
    const v = await activeView(container, "");
    act(() =>
      v.dispatch({
        changes: { from: 0, insert: "[1]" },
        userEvent: "input.paste",
      }),
    );
    expect(props.onTabPatch).not.toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ languageGuessed: true }),
    );
  });

  it("makes a closing Tab read-only", async () => {
    const closing = new Set<string>();
    const { container, rerender } = setup({
      isClosing: (id) => closing.has(id),
    });
    const v = await activeView(container, "text of a");
    expect(v.state.readOnly).toBe(false);
    closing.add("a");
    rerender({ isClosing: (id) => closing.has(id) });
    expect(v.state.readOnly).toBe(true);
  });

  it("hides inactive views, toggles wrap and destroys closed Tabs", async () => {
    const { container, rerender, props } = setup();
    const a = await activeView(container, "text of a");
    rerender({ activeId: "b" });
    const b = await activeView(container, "text of b");
    expect(a.dom.parentElement!.style.display).toBe("none");
    expect(b.dom.parentElement!.style.display).toBe("");

    rerender({ tabs: [props.tabs[0], tab("b", { wrap: true })] });
    expect(b.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);

    rerender({ tabs: [tab("b", { wrap: true })] });
    expect(a.dom.isConnected).toBe(false);
    expect(viewsIn(container)).toEqual([b]);
  });
});
