import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  PdfFindBar,
  type PdfFindBarProps,
  type PdfFindState,
} from "./PdfFindBar";

const EMPTY: PdfFindState = {
  search: "",
  caseSensitive: false,
  wholeWord: false,
};

function setup(over: Partial<PdfFindBarProps> = {}) {
  const props: PdfFindBarProps = {
    initial: EMPTY,
    count: null,
    onQuery: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const view = render(<PdfFindBar {...props} />);
  const input = screen.getByRole("textbox", { name: "Find" });
  return { props, view, input };
}

describe("PdfFindBar", () => {
  it("searches as you type", () => {
    const { props, input } = setup();
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "spec" } });
    expect(props.onQuery).toHaveBeenLastCalledWith(
      { search: "spec", caseSensitive: false, wholeWord: false },
      { again: false, previous: false },
    );
  });

  it("enter_and_f3_step_through_matches", () => {
    const { props, input } = setup({ initial: { ...EMPTY, search: "spec" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "spec" }),
      { again: true, previous: false },
    );
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(props.onQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "spec" }),
      { again: true, previous: true },
    );
    fireEvent.keyDown(input, { key: "F3" });
    expect(props.onQuery).toHaveBeenLastCalledWith(expect.anything(), {
      again: true,
      previous: false,
    });
    fireEvent.keyDown(input, { key: "F3", shiftKey: true });
    expect(props.onQuery).toHaveBeenLastCalledWith(expect.anything(), {
      again: true,
      previous: true,
    });
  });

  it("toggles_search_again_with_the_new_options", () => {
    const { props } = setup({ initial: { ...EMPTY, search: "spec" } });
    fireEvent.click(screen.getByRole("button", { name: /Match case/ }));
    expect(props.onQuery).toHaveBeenLastCalledWith(
      { search: "spec", caseSensitive: true, wholeWord: false },
      { again: false, previous: false },
    );
    fireEvent.click(screen.getByRole("button", { name: /Whole word/ }));
    expect(props.onQuery).toHaveBeenLastCalledWith(
      { search: "spec", caseSensitive: true, wholeWord: true },
      { again: false, previous: false },
    );
  });

  it("shows_the_count", () => {
    const { props, view } = setup({
      initial: { ...EMPTY, search: "spec" },
      count: { current: 3, total: 41 },
    });
    expect(screen.getByText("3 of 41")).toBeInTheDocument();
    view.rerender(<PdfFindBar {...props} count={{ current: 0, total: 0 }} />);
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("no_count_without_a_search", () => {
    setup({ count: { current: 0, total: 0 } });
    expect(screen.queryByText("No results")).toBeNull();
  });

  it("escape_closes", () => {
    const { props, input } = setup();
    fireEvent.change(input, { target: { value: "spec" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledWith({
      search: "spec",
      caseSensitive: false,
      wholeWord: false,
    });
  });

  it("has_no_replace_and_no_regexp", () => {
    setup();
    expect(screen.queryByRole("textbox", { name: "Replace" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Toggle replace/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Regular expression/ }),
    ).toBeNull();
  });

  it("uses_the_find_bar_look", () => {
    const { view } = setup();
    // The same markup hook as the text editor's FindBar (and isEditorTarget).
    expect(view.container.querySelector("[data-find-bar]")).not.toBeNull();
  });
});
