import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TabBar } from "./TabBar";

beforeAll(() => {
  // jsdom has no layout; TabBar scrolls the active Tab into view.
  Element.prototype.scrollIntoView = vi.fn();
});

function setup() {
  const props = {
    tabs: [
      { id: "a", title: "First", active: true },
      { id: "b", title: "Second", active: false },
    ],
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onNew: vi.fn(),
    onMove: vi.fn(),
    onRename: vi.fn(),
  };
  render(<TabBar {...props} />);
  return props;
}

describe("TabBar", () => {
  it("clicking a Tab calls onActivate", () => {
    const p = setup();
    fireEvent.click(screen.getByText("Second"));
    expect(p.onActivate).toHaveBeenCalledWith("b");
  });

  it("middle-click calls onClose", () => {
    const p = setup();
    fireEvent(
      screen.getByText("Second"),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(p.onClose).toHaveBeenCalledWith("b");
    expect(p.onActivate).not.toHaveBeenCalled();
  });

  it("shows the close button on the active Tab", () => {
    setup();
    const close = screen.getByRole("button", { name: "Close First" });
    expect(close).toBeVisible();
    expect(close.className).not.toMatch(/(^|\s)invisible(\s|$)/);
  });

  it("double-click renames; Enter confirms", () => {
    const p = setup();
    fireEvent.doubleClick(screen.getByText("Second"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("Second");
    fireEvent.change(input, { target: { value: "Notes" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.onRename).toHaveBeenCalledWith("b", "Notes");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Esc cancels a rename without calling onRename", () => {
    const p = setup();
    fireEvent.doubleClick(screen.getByText("Second"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(p.onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("the + button calls onNew", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "New Tab" }));
    expect(p.onNew).toHaveBeenCalled();
  });
});
