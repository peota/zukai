import { describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { EditorHost, type EditorHostProps } from "./EditorHost";
import { undo } from "@codemirror/commands";
import { foldedRanges, syntaxTree } from "@codemirror/language";
import type { FileInfo, TabState } from "../model/types";
import { beautify } from "./jsonFormat";

function tab(id: string, over: Partial<TabState> = {}): TabState {
  return {
    id,
    kind: "text",
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

describe("EditorHost find bar", () => {
  it("opens prefilled from the selection, remembers per Tab, and F3 works after Esc", async () => {
    const { container, rerender } = setup({
      tabs: [tab("a", { selection: { anchor: 0, head: 4 } }), tab("b")],
      loadContent: (id) => Promise.resolve(`text of ${id} text`),
    });
    const v = await activeView(container, "text of a text");
    rerender({ findRequest: { mode: "find", seq: 1 } });
    const input = screen.getByRole("textbox", { name: "Find" });
    expect(input).toHaveValue("text");
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Replace" })).toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    expect(v.state.selection.main).toMatchObject({ from: 0, to: 4 });

    // F3 in the editor uses the last query with the bar closed.
    act(() => {
      fireEvent.keyDown(v.contentDOM, { key: "F3", code: "F3" });
    });
    expect(v.state.selection.main).toMatchObject({ from: 10, to: 14 });

    // With no selection, Mod+H reuses the Tab's last term, in replace mode.
    act(() => v.dispatch({ selection: { anchor: 5 } }));
    rerender({ findRequest: { mode: "replace", seq: 2 } });
    expect(screen.getByRole("textbox", { name: "Find" })).toHaveValue("text");
    expect(
      screen.getByRole("textbox", { name: "Replace" }),
    ).toBeInTheDocument();
  });

  it("F3 with no search yet opens the bar", async () => {
    const { container } = setup();
    const v = await activeView(container, "text of a");
    act(() => {
      fireEvent.keyDown(v.contentDOM, { key: "F3", code: "F3" });
    });
    expect(screen.getByRole("textbox", { name: "Find" })).toHaveValue("");
  });
});

const FILE: FileInfo = {
  path: "C:/x/a.json",
  format: { encoding: "utf-8", bom: false, lineEnding: "crlf", mixed: false },
  fingerprint: null,
  held: null,
};

const json = (id: string, over: Partial<TabState> = {}) =>
  tab(id, { language: "json", languagePicked: true, ...over });

describe("EditorHost format requests", () => {
  it("beautifyReplacesSelectionOnly", async () => {
    const { container, rerender } = setup({
      tabs: [json("a", { selection: { anchor: 2, head: 9 } })],
      loadContent: () => Promise.resolve('x {"a":1} y'),
    });
    const v = await activeView(container, 'x {"a":1} y');
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    expect(v.state.doc.toString()).toBe('x {\n  "a": 1\n} y');
  });

  it("beautifyWholeDocWhenNoSelection", async () => {
    const src = '{"a":[1,2],"b":{}}';
    const { container, rerender } = setup({
      tabs: [json("a")],
      loadContent: () => Promise.resolve(src),
    });
    const v = await activeView(container, src);
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    const want = beautify(src);
    expect(want.ok && v.state.doc.toString()).toBe(want.ok && want.text);
    // One undoable edit.
    act(() => void undo(v));
    expect(v.state.doc.toString()).toBe(src);
  });

  it("minifies the whole doc", async () => {
    const { container, rerender } = setup({
      tabs: [json("a")],
      loadContent: () => Promise.resolve('{\n  "a": 1\n}'),
    });
    const v = await activeView(container, '{\n  "a": 1\n}');
    rerender({ formatRequest: { seq: 1, kind: "minify" } });
    expect(v.state.doc.toString()).toBe('{"a":1}');
  });

  it("invalidJsonDoesNotChangeDoc", async () => {
    const src = '\n{"a" 1}';
    const onFormatResult = vi.fn();
    const { container, rerender } = setup({
      tabs: [json("a")],
      loadContent: () => Promise.resolve(src),
      onFormatResult,
    });
    const v = await activeView(container, src);
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    expect(v.state.doc.toString()).toBe(src);
    expect(onFormatResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, line: 2, col: 6 }),
    );
    expect(v.state.selection.main.head).toBe(v.state.doc.line(2).from + 5);
  });

  it("reports an error inside a selection at its document position", async () => {
    const src = "ab\ncd [1 2]";
    const onFormatResult = vi.fn();
    const { container, rerender } = setup({
      tabs: [json("a", { selection: { anchor: 6, head: 11 } })],
      loadContent: () => Promise.resolve(src),
      onFormatResult,
    });
    const v = await activeView(container, src);
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    expect(onFormatResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, line: 2, col: 7 }),
    );
    expect(v.state.selection.main.head).toBe(9);
  });

  it("keeps a whole document's trailing newline", async () => {
    const { container, rerender } = setup({
      tabs: [json("a")],
      loadContent: () => Promise.resolve('{"a":1}\n'),
    });
    const v = await activeView(container, '{"a":1}\n');
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    expect(v.state.doc.toString()).toBe('{\n  "a": 1\n}\n');
    rerender({ formatRequest: { seq: 2, kind: "minify" } });
    expect(v.state.doc.toString()).toBe('{"a":1}\n');
  });

  it("beautifies a line-wise selection inside an array in place", async () => {
    const src = '[\n  2,\n  {"a":1}\n]';
    const from = src.indexOf("  {");
    const to = src.indexOf("]");
    const { container, rerender } = setup({
      tabs: [json("a", { selection: { anchor: from, head: to } })],
      loadContent: () => Promise.resolve(src),
    });
    const v = await activeView(container, src);
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    expect(v.state.doc.toString()).toBe('[\n  2,\n  {\n    "a": 1\n  }\n]');
  });

  it("reports an error after a selection's leading whitespace correctly", async () => {
    const src = "ab\n  [1 2]";
    const onFormatResult = vi.fn();
    const { container, rerender } = setup({
      tabs: [json("a", { selection: { anchor: 3, head: src.length } })],
      loadContent: () => Promise.resolve(src),
      onFormatResult,
    });
    const v = await activeView(container, src);
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    expect(v.state.doc.toString()).toBe(src);
    expect(onFormatResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, line: 2, col: 6 }),
    );
    expect(v.state.selection.main.head).toBe(8);
  });
});

describe("EditorHost replace requests", () => {
  it("replaceRequestIsOneUndoStep", async () => {
    const { container, rerender, props } = setup({
      tabs: [tab("a", { selection: { anchor: 4, head: 8 } }), tab("b")],
    });
    const v = await activeView(container, "text of a");
    rerender({ replaceRequests: [{ seq: 1, id: "a", text: "the new" }] });
    expect(v.state.doc.toString()).toBe("the new");
    // Cursor kept, clamped to the new length.
    expect(v.state.selection.main).toMatchObject({ anchor: 4, head: 7 });
    expect(props.onChange).toHaveBeenLastCalledWith("a", "the new");
    act(() => void undo(v));
    expect(v.state.doc.toString()).toBe("text of a");
    // Re-rendering the same request applies nothing again.
    rerender({ tabs: [...props.tabs] });
    expect(v.state.doc.toString()).toBe("text of a");
  });

  it("a replace keeps the scroll offset and its echo is the new text", async () => {
    const { container, rerender, props } = setup();
    const v = await activeView(container, "text of a");
    v.scrollDOM.scrollTop = 120;
    vi.mocked(props.onChange).mockClear();
    rerender({ replaceRequests: [{ seq: 1, id: "a", text: "text of A" }] });
    expect(v.scrollDOM.scrollTop).toBe(120);
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(v.scrollDOM.scrollTop).toBe(120);
    // One echo, of exactly the replaced text (useWorkspace ignores it).
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith("a", "text of A");
  });

  it("applies a replace to a hidden view", async () => {
    const { container, rerender } = setup();
    const a = await activeView(container, "text of a");
    rerender({ activeId: "b" });
    await activeView(container, "text of b");
    expect(a.dom.parentElement!.style.display).toBe("none");
    rerender({ replaceRequests: [{ seq: 1, id: "a", text: "reloaded a" }] });
    expect(a.state.doc.toString()).toBe("reloaded a");
  });

  it("ignores a stale replace (older seq, or one the loaded text has)", async () => {
    const { container, rerender } = setup({
      // b's loaded text is newer than the request issued before it loaded.
      loadContent: (id) =>
        Promise.resolve(id === "b" ? "newer b" : `text of ${id}`),
      replaceRequests: [{ seq: 1, id: "b", text: "disk b" }],
    });
    const a = await activeView(container, "text of a");
    rerender({ activeId: "b" });
    const b = await activeView(container, "newer b");
    rerender({ tabs: [tab("a"), tab("b")] });
    expect(b.state.doc.toString()).toBe("newer b");

    rerender({ replaceRequests: [{ seq: 3, id: "a", text: "three" }] });
    expect(a.state.doc.toString()).toBe("three");
    rerender({ replaceRequests: [{ seq: 2, id: "a", text: "two" }] });
    expect(a.state.doc.toString()).toBe("three");
  });

  it("applies a replace that arrives while the view is loading", async () => {
    let resolve!: (s: string) => void;
    const { container, rerender } = setup({
      loadContent: () => new Promise<string>((r) => (resolve = r)),
    });
    rerender({ replaceRequests: [{ seq: 1, id: "a", text: "from disk" }] });
    await act(async () => resolve("old text"));
    await activeView(container, "from disk");
  });
});

describe("EditorHost read-only and Convert", () => {
  it("readOnlyFileRejectsInput", async () => {
    const { container, rerender, props } = setup({
      tabs: [json("a", { file: { ...FILE, held: "readonly" } })],
      loadContent: () => Promise.resolve('{"a":1}'),
    });
    const v = await activeView(container, '{"a":1}');
    expect(v.state.readOnly).toBe(true);
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    expect(v.state.doc.toString()).toBe('{"a":1}');
    rerender({ tabs: [json("a", { file: FILE })] });
    expect(v.state.readOnly).toBe(false);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("is read-only while the Tab's shadow can't be read", async () => {
    const { container, rerender } = setup({
      shadowUnreadable: new Set(["a"]),
    });
    const v = await activeView(container, "text of a");
    expect(v.state.readOnly).toBe(true);
    rerender({ shadowUnreadable: new Set() });
    expect(v.state.readOnly).toBe(false);
  });

  it("a Convert is undoable and reported both ways", async () => {
    const { container, rerender, props } = setup({
      tabs: [tab("a", { file: FILE })],
    });
    const v = await activeView(container, "text of a");
    rerender({
      convertRequest: { seq: 1, id: "a", patch: { lineEnding: "lf" } },
    });
    const lf = { ...FILE.format, lineEnding: "lf" as const };
    expect(props.onTabPatch).toHaveBeenLastCalledWith("a", {
      file: { ...FILE, format: lf },
    });
    rerender({ tabs: [tab("a", { file: { ...FILE, format: lf } })] });
    act(() => void undo(v));
    expect(props.onTabPatch).toHaveBeenLastCalledWith("a", {
      file: { ...FILE, format: FILE.format },
    });
  });
});

describe("EditorHost Convert before the view exists (final fix I2)", () => {
  it("holds a Convert until the view exists, then applies it undoably", async () => {
    let resolve!: (s: string) => void;
    const { container, rerender, props } = setup({
      tabs: [tab("a", { file: FILE })],
      loadContent: () => new Promise<string>((r) => (resolve = r)),
    });
    rerender({
      convertRequest: { seq: 1, id: "a", patch: { lineEnding: "lf" } },
    });
    // No view yet: nothing is patched (a patch now couldn't be undone, and
    // the Tab's text isn't known).
    expect(props.onTabPatch).not.toHaveBeenCalled();
    await act(async () => resolve("loaded"));
    const v = await activeView(container, "loaded");
    const lf = { ...FILE.format, lineEnding: "lf" as const };
    await waitFor(() =>
      expect(props.onTabPatch).toHaveBeenLastCalledWith("a", {
        file: { ...FILE, format: lf },
      }),
    );
    rerender({ tabs: [tab("a", { file: { ...FILE, format: lf } })] });
    act(() => void undo(v));
    expect(props.onTabPatch).toHaveBeenLastCalledWith("a", {
      file: { ...FILE, format: FILE.format },
    });
  });

  it("drops a held Convert for a Tab that closed", async () => {
    let resolve!: (s: string) => void;
    const { rerender, props } = setup({
      tabs: [tab("a", { file: FILE }), tab("b")],
      loadContent: (id) =>
        id === "a"
          ? new Promise<string>((r) => (resolve = r))
          : Promise.resolve("b text"),
    });
    rerender({
      convertRequest: { seq: 1, id: "a", patch: { lineEnding: "lf" } },
    });
    rerender({ tabs: [tab("b")], activeId: "b" });
    await act(async () => resolve("loaded"));
    expect(props.onTabPatch).not.toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ file: expect.anything() }),
    );
  });
});

describe("EditorHost folding", () => {
  it("foldKeysFoldJsonObject", async () => {
    const src = '{\n  "a": {\n    "b": 1\n  }\n}';
    const { container } = setup({
      tabs: [json("a", { selection: { anchor: 4, head: 4 } })],
      loadContent: () => Promise.resolve(src),
    });
    const v = await activeView(container, src);
    await waitFor(() => expect(syntaxTree(v.state).length).toBe(src.length));
    const press = (key: string, keyCode: number) =>
      act(() => {
        fireEvent.keyDown(v.contentDOM, {
          key,
          keyCode,
          ctrlKey: true,
          shiftKey: true,
        });
      });
    press("{", 219);
    expect(foldedRanges(v.state).size).toBe(1);
    press("}", 221);
    expect(foldedRanges(v.state).size).toBe(0);
    expect(container.querySelector(".cm-foldGutter")).not.toBeNull();
  });
});
