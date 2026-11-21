import { loadHidden } from "./hiddenText";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import {
  EditorSelection,
  EditorState,
  type Extension,
} from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import {
  EditorHost,
  reindent,
  type EditorHostProps,
  type TextBridge,
} from "./EditorHost";
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
  it("showing a Tab leaves the keyboard in a sidebar text field", async () => {
    const side = document.createElement("div");
    side.setAttribute("data-z-sidebar", "");
    const input = document.createElement("input");
    side.append(input);
    document.body.append(side);
    try {
      const { container, rerender } = setup();
      const a = await activeView(container, "text of a");
      expect(a.hasFocus).toBe(true);
      input.focus();
      rerender({ activeId: "b" });
      await activeView(container, "text of b");
      expect(document.activeElement).toBe(input);
    } finally {
      side.remove();
    }
  });

  it("shows the text at fontSize, and Mod+wheel asks to zoom", async () => {
    const onZoom = vi.fn();
    const { container, rerender } = setup({ fontSize: 18, onZoom });
    const view = await activeView(container, "text of a");
    const size = () => getComputedStyle(view.dom).fontSize;
    expect(size()).toBe("18px");
    // A theme change, so CodeMirror re-measures and the gutter follows.
    rerender({ fontSize: 12 });
    expect(size()).toBe("12px");
    // A Tab created later starts at the current size.
    rerender({ tabs: [tab("a"), tab("b")], activeId: "b" });
    const later = await activeView(container, "text of b");
    expect(getComputedStyle(later.dom).fontSize).toBe("12px");
    rerender({ activeId: "a" });

    const scroller = container.querySelector(".cm-scroller")!;
    const wheel = (deltaY: number, ctrlKey = true) => {
      const e = new WheelEvent("wheel", {
        deltaY,
        ctrlKey,
        bubbles: true,
        cancelable: true,
      });
      scroller.dispatchEvent(e);
      return e;
    };
    expect(wheel(-100).defaultPrevented).toBe(true);
    expect(onZoom).toHaveBeenLastCalledWith(1);
    wheel(100);
    expect(onZoom).toHaveBeenLastCalledWith(-1);
    // A trackpad pinch sends small steps: one zoom per notch's worth.
    onZoom.mockClear();
    for (let i = 0; i < 4; i++) wheel(-20);
    expect(onZoom).not.toHaveBeenCalled();
    wheel(-20);
    expect(onZoom).toHaveBeenCalledTimes(1);
    // A plain wheel scrolls.
    onZoom.mockClear();
    expect(wheel(-100, false).defaultPrevented).toBe(false);
    expect(onZoom).not.toHaveBeenCalled();
  });

  it("hides and shows line numbers, in open and new views", async () => {
    const { container, rerender } = setup({ lineNumbers: false });
    await activeView(container, "text of a");
    const gutter = () => container.querySelector(".cm-lineNumbers");
    expect(gutter()).toBeNull();
    rerender({ lineNumbers: true });
    expect(gutter()).not.toBeNull();
    rerender({ lineNumbers: false });
    expect(gutter()).toBeNull();
    rerender({ activeId: "b" });
    await activeView(container, "text of b");
    expect(container.querySelectorAll(".cm-lineNumbers")).toHaveLength(0);
  });

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

describe("EditorHost re-indent (Shift+Alt+F on code)", () => {
  const code = (
    id: string,
    language: TabState["language"],
    over: Partial<TabState> = {},
  ) => tab(id, { language, languagePicked: true, ...over });
  /** Waits until the Language's parser covers the whole text. */
  const parsed = (v: EditorView) =>
    waitFor(() => expect(syntaxTree(v.state).length).toBe(v.state.doc.length));

  it("reindents_javascript_whole_doc", async () => {
    const src = "function f() {\nreturn 1;\n    }\n";
    const { container, rerender } = setup({
      tabs: [code("a", "javascript")],
      loadContent: () => Promise.resolve(src),
    });
    const v = await activeView(container, src);
    await parsed(v);
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    expect(v.state.doc.toString()).toBe("function f() {\n  return 1;\n}\n");
    // One undoable edit.
    act(() => void undo(v));
    expect(v.state.doc.toString()).toBe(src);
  });

  it("reindent_selected_lines_only", async () => {
    const src = "if (a) {\nx();\ny();\n}";
    // A selection inside line 2 only.
    const { container, rerender } = setup({
      tabs: [code("a", "javascript", { selection: { anchor: 10, head: 11 } })],
      loadContent: () => Promise.resolve(src),
    });
    const v = await activeView(container, src);
    await parsed(v);
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    const lines = v.state.doc.toString().split("\n");
    expect(lines[1]).toBe("  x();");
    expect(lines[2]).toBe("y();");
  });

  it("reindent_leaves_python_yaml_plain_alone", async () => {
    for (const language of ["python", "yaml", "plaintext"] as const) {
      const src = "a:\n      b\n  c\n";
      const { container, rerender, unmount } = setup({
        tabs: [code("a", language)],
        loadContent: () => Promise.resolve(src),
      });
      const v = await activeView(container, src);
      if (language !== "plaintext") await parsed(v);
      rerender({ formatRequest: { seq: 1, kind: "beautify" } });
      expect(v.state.doc.toString()).toBe(src);
      unmount();
    }
  });

  it("reindent_skips_read_only", async () => {
    const src = "function f() {\nreturn 1;\n}";
    const { container, rerender } = setup({
      tabs: [code("a", "javascript", { file: { ...FILE, held: "readonly" } })],
      loadContent: () => Promise.resolve(src),
    });
    const v = await activeView(container, src);
    expect(v.state.readOnly).toBe(true);
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    expect(v.state.doc.toString()).toBe(src);
  });

  it("two_selections_on_one_line_indent_it_once", async () => {
    const src = "if (a) {\nfoo(); foo();\n}";
    const { container, rerender } = setup({
      tabs: [code("a", "javascript")],
      loadContent: () => Promise.resolve(src),
    });
    const v = await activeView(container, src);
    await parsed(v);
    // Both `foo`s selected (as after Ctrl+D).
    act(() =>
      v.dispatch({
        selection: EditorSelection.create([
          EditorSelection.range(9, 12),
          EditorSelection.range(16, 19),
        ]),
      }),
    );
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    expect(v.state.doc.toString()).toBe("if (a) {\n  foo(); foo();\n}");
  });

  it("sql_is_left_alone", async () => {
    const src = "SELECT a,\n       b\nFROM t\nWHERE x = 1\n  AND y = 2;";
    const { container, rerender } = setup({
      tabs: [code("a", "sql")],
      loadContent: () => Promise.resolve(src),
    });
    const v = await activeView(container, src);
    await parsed(v);
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    expect(v.state.doc.toString()).toBe(src);
  });

  it("html_keeps_pre_textarea_and_comment_text", async () => {
    const src =
      "<div>\n<p>x</p>\n<pre>\n      kept\n</pre>\n<textarea>\n   kept\n</textarea>\n<!--\n     kept\n-->\n</div>";
    const { container, rerender } = setup({
      tabs: [code("a", "html")],
      loadContent: () => Promise.resolve(src),
    });
    const v = await activeView(container, src);
    await parsed(v);
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    const out = v.state.doc.toString();
    expect(out).toContain("\n  <p>x</p>");
    expect(out).toContain("\n      kept\n</pre>");
    expect(out).toContain("\n   kept\n</textarea>");
    expect(out).toContain("\n     kept\n-->");
  });

  it("xml_keeps_comment_and_cdata_text", async () => {
    const src =
      "<a>\n<b/>\n<!--\n     kept\n-->\n<![CDATA[\n    kept\n]]>\n</a>";
    const { container, rerender } = setup({
      tabs: [code("a", "xml")],
      loadContent: () => Promise.resolve(src),
    });
    const v = await activeView(container, src);
    await parsed(v);
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    const out = v.state.doc.toString();
    expect(out).toContain("\n  <b/>");
    expect(out).toContain("\n     kept\n-->");
    expect(out).toContain("\n    kept\n]]>");
  });

  it("reindents_csharp_braces", async () => {
    const src = "class A {\nvoid F() {\nif (x) {\nG();\n}\n        }\n}\n";
    const { container, rerender } = setup({
      tabs: [code("a", "csharp")],
      loadContent: () => Promise.resolve(src),
    });
    const v = await activeView(container, src);
    await parsed(v);
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    expect(v.state.doc.toString()).toBe(
      "class A {\n  void F() {\n    if (x) {\n      G();\n    }\n  }\n}\n",
    );
  });

  it("csharp_keeps_comment_and_string_text", async () => {
    const src = [
      "class A {",
      "/*",
      "      kept comment",
      "*/",
      'string s = @"',
      "     kept verbatim",
      '";',
      'string r = """',
      "       kept raw {",
      '    """;',
      "int y;",
      "}",
    ].join("\n");
    const { container, rerender } = setup({
      tabs: [code("a", "csharp")],
      loadContent: () => Promise.resolve(src),
    });
    const v = await activeView(container, src);
    await parsed(v);
    rerender({ formatRequest: { seq: 1, kind: "beautify" } });
    const out = v.state.doc.toString();
    expect(out).toContain('\n  string s = @"');
    expect(out).toContain("\n      kept comment\n");
    expect(out).toContain("\n     kept verbatim\n");
    expect(out).toContain('\n       kept raw {\n    """;');
    // A brace inside the raw string doesn't throw off what follows.
    expect(out.endsWith("\n  int y;\n}")).toBe(true);
  });
});

describe("reindent", () => {
  const viewOf = (doc: string, extensions: Extension = []) =>
    new EditorView({ state: EditorState.create({ doc, extensions }) });

  it("changes nothing until the Tab's own Language is loaded", () => {
    // No Language yet: the first line must not be stripped.
    const bare = viewOf("    <div>\n  x\n");
    expect(reindent(bare, "html")).toBe(false);
    expect(bare.state.doc.toString()).toBe("    <div>\n  x\n");
    // Another Language's rules aren't used either.
    const other = viewOf("function f() {\nreturn 1;\n}", javascript());
    expect(reindent(other, "css")).toBe(false);
    expect(other.state.doc.toString()).toBe("function f() {\nreturn 1;\n}");
    bare.destroy();
    other.destroy();
  });

  it("re-indents the whole of a long file", () => {
    const block = "function f() {\nreturn 1;\n}\n";
    const src = block.repeat(4000);
    const v = viewOf(src, javascript());
    expect(reindent(v, "javascript")).toBe(true);
    const out = v.state.doc.toString();
    expect(out.endsWith("function f() {\n  return 1;\n}\n")).toBe(true);
    expect(out).not.toContain("\nreturn 1;");
    v.destroy();
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

describe("EditorHost with two shown views", () => {
  const made: HTMLElement[] = [];
  afterEach(() => {
    for (const d of made.splice(0)) d.remove();
  });
  function slotDiv() {
    const d = document.createElement("div");
    d.style.position = "relative";
    document.body.append(d);
    made.push(d);
    return d;
  }

  it("twoViewsKeepTheirOwnUndo", async () => {
    const sa = slotDiv();
    const sb = slotDiv();
    const slots = new Map([
      ["a", sa],
      ["b", sb],
    ]);
    const { container, rerender } = setup({
      activeId: "a",
      shown: ["a", "b"],
      slots,
    });
    await waitFor(() => {
      expect(sa.querySelectorAll(".cm-editor")).toHaveLength(1);
      expect(sb.querySelectorAll(".cm-editor")).toHaveLength(1);
    });
    const a = viewsIn(sa)[0]!;
    const b = viewsIn(sb)[0]!;
    expect(a.state.doc.toString()).toBe("text of a");
    expect(b.state.doc.toString()).toBe("text of b");

    act(() =>
      b.dispatch({
        changes: { from: 0, insert: "X" },
        userEvent: "input.type",
      }),
    );
    act(() => {
      undo(a);
    });
    expect(b.state.doc.toString()).toBe("Xtext of b");

    rerender({ shown: ["a"], slots: new Map() });
    expect(viewsIn(sb)).toHaveLength(0);
    expect(viewsIn(container)).toContain(b);
    rerender({ shown: ["a", "b"], slots });
    expect(viewsIn(sb)).toEqual([b]);
    expect(viewsIn(sa)).toEqual([a]);
    act(() => {
      undo(b);
    });
    expect(b.state.doc.toString()).toBe("text of b");
  });

  it("onlyTheActiveViewTakesFocus", async () => {
    const sa = slotDiv();
    const sb = slotDiv();
    setup({
      activeId: "b",
      shown: ["a", "b"],
      slots: new Map([
        ["a", sa],
        ["b", sb],
      ]),
    });
    await waitFor(() => {
      expect(sa.querySelectorAll(".cm-editor")).toHaveLength(1);
      expect(sb.querySelectorAll(".cm-editor")).toHaveLength(1);
    });
    await waitFor(() => expect(sb.contains(document.activeElement)).toBe(true));
    expect(sa.contains(document.activeElement)).toBe(false);
  });

  it("findBarSitsInTheFocusedSlot", async () => {
    const sa = slotDiv();
    const sb = slotDiv();
    const { rerender } = setup({
      activeId: "b",
      shown: ["a", "b"],
      slots: new Map([
        ["a", sa],
        ["b", sb],
      ]),
    });
    await waitFor(() =>
      expect(sb.querySelectorAll(".cm-editor")).toHaveLength(1),
    );
    rerender({ findRequest: { mode: "find", seq: 1 } });
    const input = screen.getByRole("textbox", { name: "Find" });
    expect(sb.contains(input)).toBe(true);
    expect(sa.contains(input)).toBe(false);
  });

  it("switching the active half focuses it and reports its cursor", async () => {
    const sa = slotDiv();
    const sb = slotDiv();
    const slots = new Map([
      ["a", sa],
      ["b", sb],
    ]);
    const { rerender, props } = setup({
      activeId: "a",
      shown: ["a", "b"],
      slots,
    });
    await waitFor(() => {
      expect(sa.querySelectorAll(".cm-editor")).toHaveLength(1);
      expect(sb.querySelectorAll(".cm-editor")).toHaveLength(1);
    });
    await waitFor(() => expect(sa.contains(document.activeElement)).toBe(true));
    vi.mocked(props.onCursor).mockClear();
    const b = viewsIn(sb)[0]!;
    act(() => b.dispatch({ selection: { anchor: 3 } }));
    vi.mocked(props.onCursor).mockClear();
    rerender({ activeId: "b" });
    expect(sb.contains(document.activeElement)).toBe(true);
    expect(props.onCursor).toHaveBeenCalledWith(1, 4);
  });

  it("a slot removed from the DOM keeps the saved scroll offset", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const sa = slotDiv();
      const sb = slotDiv();
      const { rerender, props } = setup({
        activeId: "a",
        shown: ["a", "b"],
        slots: new Map([
          ["a", sa],
          ["b", sb],
        ]),
      });
      await vi.waitFor(() => {
        expect(sa.querySelectorAll(".cm-editor")).toHaveLength(1);
        expect(sb.querySelectorAll(".cm-editor")).toHaveLength(1);
      });
      const b = viewsIn(sb)[0]!;
      b.scrollDOM.scrollTop = 120;
      b.scrollDOM.dispatchEvent(new Event("scroll"));
      expect(b.scrollDOM.scrollTop).toBe(120);
      // Like a browser: a detached scroller reads 0.
      let top = 120;
      Object.defineProperty(b.scrollDOM, "scrollTop", {
        configurable: true,
        get: () => (b.scrollDOM.isConnected ? top : 0),
        set: (n: number) => {
          top = n;
        },
      });
      vi.mocked(props.onTabPatch).mockClear();
      sb.remove(); // Unsplit: React detaches the slot with the wrapper in it
      rerender({ shown: ["a"], slots: new Map([["a", sa]]) });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      const patches = vi
        .mocked(props.onTabPatch)
        .mock.calls.filter(([id]) => id === "b")
        .map(([, patch]) => patch.scrollTop)
        .filter((n) => n !== undefined);
      expect(patches).toEqual([120]);
      // Shown again in a new slot, the view returns to the saved offset.
      const sb2 = slotDiv();
      rerender({
        shown: ["a", "b"],
        slots: new Map([
          ["a", sa],
          ["b", sb2],
        ]),
      });
      expect(b.scrollDOM.scrollTop).toBe(120);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Mod+wheel over a view in its slot asks to zoom", async () => {
    const sa = slotDiv();
    const onZoom = vi.fn();
    setup({ shown: ["a"], slots: new Map([["a", sa]]), onZoom });
    await waitFor(() => expect(viewsIn(sa)).toHaveLength(1));
    const e = new WheelEvent("wheel", {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    sa.querySelector(".cm-scroller")!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onZoom).toHaveBeenLastCalledWith(1);
  });
});

describe("EditorHost text bridge", () => {
  function withBridge(over: Partial<EditorHostProps> = {}) {
    let bridge: TextBridge | null = null;
    const bridgeRef = vi.fn((b: TextBridge | null) => (bridge = b));
    const r = setup({ bridgeRef, ...over });
    return { ...r, bridgeRef, bridge: () => bridge! };
  }

  it("bridge_reads_and_replaces_outside_history", async () => {
    const { container, props, bridge, bridgeRef, rerender } = withBridge();
    const v = await activeView(container, "text of a");
    const b = bridge();
    expect(b.text("a")).toBe("text of a");
    expect(b.text("b")).toBeNull();
    expect(b.readOnly("a")).toBe(false);
    act(() => b.replace("a", "# rich a"));
    expect(v.state.doc.toString()).toBe("# rich a");
    expect(b.text("a")).toBe("# rich a");
    expect(props.onChange).toHaveBeenLastCalledWith("a", "# rich a");
    act(() => void undo(v));
    expect(v.state.doc.toString()).toBe("# rich a");
    // Writing the same text again changes nothing.
    vi.mocked(props.onChange).mockClear();
    act(() => b.replace("a", "# rich a"));
    expect(props.onChange).not.toHaveBeenCalled();
    rerender({ fontSize: 15 });
    expect(bridgeRef).toHaveBeenCalledTimes(1);
  });

  it("bridge_hands_over_a_stable_object_and_null_on_unmount", async () => {
    const { container, bridgeRef, rerender, unmount } = withBridge();
    await activeView(container, "text of a");
    const first = bridgeRef.mock.calls[0][0];
    expect(first).not.toBeNull();
    rerender({ activeId: "b" });
    await activeView(container, "text of b");
    expect(bridgeRef).toHaveBeenCalledTimes(1);
    unmount();
    expect(bridgeRef).toHaveBeenLastCalledWith(null);
  });

  it("bridge_reports_outside_changes_only", async () => {
    const { container, rerender, bridge } = withBridge();
    const v = await activeView(container, "text of a");
    const heard = vi.fn();
    const stop = bridge().onOutsideChange("a", heard);
    rerender({ replaceRequests: [{ seq: 1, id: "a", text: "from disk" }] });
    expect(heard).toHaveBeenLastCalledWith("from disk");
    heard.mockClear();
    act(() => bridge().replace("a", "from rich"));
    expect(heard).not.toHaveBeenCalled();
    // Typing in the plain editor is an outside change too.
    act(() =>
      v.dispatch({
        changes: { from: 0, insert: "X" },
        userEvent: "input.type",
      }),
    );
    expect(heard).toHaveBeenLastCalledWith("Xfrom rich");
    stop();
    heard.mockClear();
    rerender({ replaceRequests: [{ seq: 2, id: "a", text: "again" }] });
    expect(heard).not.toHaveBeenCalled();
  });

  it("bridge_refuses_read_only", async () => {
    const { container, props, bridge } = withBridge({
      tabs: [tab("a", { file: { ...FILE, held: "readonly" } })],
    });
    const v = await activeView(container, "text of a");
    expect(bridge().readOnly("a")).toBe(true);
    act(() => bridge().replace("a", "nope"));
    expect(v.state.doc.toString()).toBe("text of a");
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("bridge_hidden_reads_the_views_hidden_ranges", async () => {
    const { container, bridge } = withBridge();
    const v = await activeView(container, "text of a");
    expect(bridge().hidden("a")).toEqual([]);
    expect(bridge().hidden("nope")).toEqual([]);
    act(() => v.dispatch({ effects: loadHidden([[0, 4]]) }));
    expect(bridge().hidden("a")).toEqual([[0, 4]]);
  });

  it("bridge_clear_history", async () => {
    const { container, bridge } = withBridge();
    const v = await activeView(container, "text of a");
    act(() =>
      v.dispatch({
        changes: { from: 0, insert: "X" },
        userEvent: "input.type",
      }),
    );
    act(() => bridge().clearHistory("a"));
    act(() => void undo(v));
    expect(v.state.doc.toString()).toBe("Xtext of a");
    // History still works for what comes next.
    act(() =>
      v.dispatch({
        changes: { from: 0, insert: "Y" },
        userEvent: "input.type",
      }),
    );
    act(() => void undo(v));
    expect(v.state.doc.toString()).toBe("Xtext of a");
  });

  it("bridge_ready_waits_for_load", async () => {
    let resolve!: (s: string) => void;
    const { container, bridge } = withBridge({
      loadContent: () => new Promise<string>((r) => (resolve = r)),
    });
    let done = false;
    const ready = bridge()
      .ready("a")
      .then(() => (done = true));
    await act(async () => {});
    expect(done).toBe(false);
    expect(bridge().text("a")).toBeNull();
    await act(async () => resolve("loaded a"));
    await ready;
    expect(bridge().text("a")).toBe("loaded a");
    await activeView(container, "loaded a");
    // Once loaded, ready resolves at once.
    await expect(bridge().ready("a")).resolves.toBeUndefined();
  });

  it("bridge_throwing_subscriber_breaks_nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let resolve!: (s: string) => void;
      const { container, props, bridge } = withBridge({
        loadContent: () => new Promise<string>((r) => (resolve = r)),
      });
      const heard = vi.fn();
      bridge().onOutsideChange("a", () => {
        throw new Error("subscriber failed");
      });
      bridge().onOutsideChange("a", heard);
      const ready = bridge().ready("a");
      await act(async () => resolve("loaded a"));
      // Loading still finishes: ready resolves and the view shows.
      await expect(ready).resolves.toBeUndefined();
      const v = await activeView(container, "loaded a");
      expect(v.dom.parentElement!.style.display).toBe("");
      expect(heard).toHaveBeenLastCalledWith("loaded a");
      // A later edit still reaches onChange, the other subscriber and the
      // selection patch.
      act(() =>
        v.dispatch({
          changes: { from: 0, insert: "X" },
          selection: { anchor: 1 },
          userEvent: "input.type",
        }),
      );
      expect(props.onChange).toHaveBeenLastCalledWith("a", "Xloaded a");
      expect(heard).toHaveBeenLastCalledWith("Xloaded a");
      await waitFor(() =>
        expect(props.onTabPatch).toHaveBeenCalledWith("a", {
          selection: { anchor: 1, head: 1 },
        }),
      );
      expect(error).not.toHaveBeenCalledWith(
        "load scratchpad failed",
        expect.anything(),
      );
    } finally {
      error.mockRestore();
    }
  });

  it("bridge_ready_rejects_when_the_tab_closes_first", async () => {
    const { rerender, bridge } = withBridge({
      loadContent: () => new Promise<string>(() => {}),
    });
    const ready = bridge().ready("a");
    rerender({ tabs: [tab("b")], activeId: "b" });
    await expect(ready).rejects.toThrow(/closed/);
  });
});
