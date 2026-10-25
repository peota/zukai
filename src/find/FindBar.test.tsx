import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { searchPanelOpen } from "@codemirror/search";
import { FindBar, type FindState } from "./FindBar";
import { findExtension } from "./findExtension";

const EMPTY: FindState = {
  search: "",
  replace: "",
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
};

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
});

function setup(
  mode: "find" | "replace" = "find",
  initial = EMPTY,
  doc = "foo bar foo",
  cursor = 0,
) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [history(), findExtension(() => {})],
    }),
    parent,
  });
  const onClose = vi.fn<(s: FindState) => void>();
  render(
    <FindBar view={view} mode={mode} initial={initial} onClose={onClose} />,
  );
  const input = screen.getByRole("textbox", { name: "Find" });
  return { view, onClose, input };
}

const sel = (v: EditorView) => {
  const { from, to } = v.state.selection.main;
  return { from, to };
};

describe("FindBar", () => {
  it("counts matches as you type and selects the first one", () => {
    const { view, input } = setup();
    expect(searchPanelOpen(view.state)).toBe(true);
    fireEvent.change(input, { target: { value: "foo" } });
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(sel(view)).toEqual({ from: 0, to: 3 });
  });

  it("shows No results when nothing matches", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("Enter and Shift+Enter step through matches and wrap", () => {
    const { view, input } = setup();
    fireEvent.change(input, { target: { value: "foo" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sel(view)).toEqual({ from: 8, to: 11 });
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sel(view)).toEqual({ from: 0, to: 3 });
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(sel(view)).toEqual({ from: 8, to: 11 });
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
  });

  it("Enter still advances over empty regex matches", () => {
    const { view, input } = setup("find", { ...EMPTY, regexp: true });
    fireEvent.change(input, { target: { value: "\\b" } });
    expect(screen.getByText("1 of 6")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sel(view)).toEqual({ from: 3, to: 3 });
    expect(screen.getByText("2 of 6")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByText("1 of 6")).toBeInTheDocument();
  });

  it("marks an invalid regex on the input", () => {
    const { input } = setup("find", { ...EMPTY, regexp: true });
    fireEvent.change(input, { target: { value: "(" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, { target: { value: "(o)" } });
    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  it("Esc closes with the current state and leaves the match selected", () => {
    const { view, input, onClose } = setup();
    fireEvent.change(input, { target: { value: "foo" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledWith({ ...EMPTY, search: "foo" });
    expect(sel(view)).toEqual({ from: 8, to: 11 });
    expect(searchPanelOpen(view.state)).toBe(false);
  });

  it("Replace All is a single undo step", () => {
    const { view, input } = setup("replace");
    fireEvent.change(input, { target: { value: "foo" } });
    const replace = screen.getByRole("textbox", { name: "Replace" });
    fireEvent.change(replace, { target: { value: "baz" } });
    fireEvent.click(screen.getByRole("button", { name: /^Replace all/ }));
    expect(view.state.doc.toString()).toBe("baz bar baz");
    undo(view);
    expect(view.state.doc.toString()).toBe("foo bar foo");
  });

  it("Replace replaces the current match and moves to the next", () => {
    const { view, input } = setup("replace");
    fireEvent.change(input, { target: { value: "foo" } });
    const replace = screen.getByRole("textbox", { name: "Replace" });
    fireEvent.change(replace, { target: { value: "baz" } });
    fireEvent.keyDown(replace, { key: "Enter" });
    expect(view.state.doc.toString()).toBe("baz bar foo");
    expect(sel(view)).toEqual({ from: 8, to: 11 });
  });

  it("treats plain text literally, in the search and the replacement", () => {
    const { view, input } = setup("replace");
    fireEvent.change(input, { target: { value: "." } });
    expect(screen.getByText("No results")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "foo" } });
    const replace = screen.getByRole("textbox", { name: "Replace" });
    const text = String.raw`$&\n$1`;
    fireEvent.change(replace, { target: { value: text } });
    fireEvent.click(screen.getByRole("button", { name: /^Replace all/ }));
    expect(view.state.doc.toString()).toBe(`${text} bar ${text}`);
  });

  it("keeps working after the document shrinks while the bar is open", () => {
    const { view, input } = setup("replace", EMPTY, "foo bar foo", 11);
    fireEvent.change(input, { target: { value: "foo" } });
    const replace = screen.getByRole("textbox", { name: "Replace" });
    fireEvent.change(replace, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^Replace all/ }));
    expect(view.state.doc.toString()).toBe(" bar ");
    fireEvent.change(input, { target: { value: "bar" } });
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText("No results")).toBeInTheDocument();
    // Edits made in the editor itself are followed too.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length } });
    fireEvent.change(input, { target: { value: "zz" } });
    expect(view.state.selection.main.head).toBe(0);
  });

  it("Replace steps past empty matches", () => {
    const { view, input } = setup(
      "replace",
      { ...EMPTY, regexp: true },
      "a\nb",
    );
    fireEvent.change(input, { target: { value: "^" } });
    const replace = screen.getByRole("textbox", { name: "Replace" });
    fireEvent.change(replace, { target: { value: "> " } });
    fireEvent.keyDown(replace, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /^Replace$/ }));
    expect(view.state.doc.toString()).toBe("> a\n> b");
  });

  it("Replace keeps regex groups", () => {
    const { view, input } = setup("replace", { ...EMPTY, regexp: true });
    fireEvent.change(input, { target: { value: "f(o+)" } });
    const replace = screen.getByRole("textbox", { name: "Replace" });
    fireEvent.change(replace, { target: { value: "<$1|$&>" } });
    fireEvent.keyDown(replace, { key: "Enter" });
    expect(view.state.doc.toString()).toBe("<oo|foo> bar foo");
    expect(sel(view)).toEqual({ from: 13, to: 16 });
  });

  it("F3 and Shift+F3 step from inside the bar", () => {
    const { view, input } = setup();
    fireEvent.change(input, { target: { value: "foo" } });
    const ev = new KeyboardEvent("keydown", {
      key: "F3",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(sel(view)).toEqual({ from: 8, to: 11 });
    fireEvent.keyDown(input, { key: "F3", shiftKey: true });
    expect(sel(view)).toEqual({ from: 0, to: 3 });
  });

  it("Alt+C, Alt+W and Alt+R flip their toggles", () => {
    const { input } = setup();
    const button = (name: RegExp) => screen.getByRole("button", { name });
    for (const [code, name] of [
      ["KeyC", /Match case/],
      ["KeyW", /Whole word/],
      ["KeyR", /Regular expression/],
    ] as const) {
      expect(button(name)).toHaveAttribute("aria-pressed", "false");
      fireEvent.keyDown(input, { key: "x", code, altKey: true });
      expect(button(name)).toHaveAttribute("aria-pressed", "true");
    }
  });

  it("toggles change the matches", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "FOO" } });
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Match case/ }));
    expect(screen.getByText("No results")).toBeInTheDocument();
  });
});
