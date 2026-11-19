import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TabBar, type TabBarItem, type TabBarProps } from "./TabBar";

beforeAll(() => {
  // jsdom has no layout; TabBar scrolls the active Tab into view.
  Element.prototype.scrollIntoView = vi.fn();
});

function setup(
  tabs: TabBarItem[] = [
    { id: "a", title: "First", active: true },
    { id: "b", title: "Second", active: false },
  ],
  over: Partial<TabBarProps> = {},
) {
  const props = {
    tabs,
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onNew: vi.fn(),
    onMove: vi.fn(),
    onRename: vi.fn(),
    onContextMenu: vi.fn(),
    onUnpin: vi.fn(),
    onCloseSplit: vi.fn(),
    ...over,
  };
  render(<TabBar {...props} />);
  return props;
}

const FILE_TABS: TabBarItem[] = [
  { id: "a", title: "First", active: true },
  {
    id: "f",
    title: "config.json",
    active: false,
    file: { missing: false, path: "C:/data/config.json" },
  },
  {
    id: "m",
    title: "old-notes.md",
    active: false,
    file: { missing: true, path: "C:/data/old-notes.md" },
  },
];

/** jsdom has no layout: give each Tab a 100px-wide box, left to right. */
function layOut() {
  screen.getAllByRole("tab").forEach((el, i) => {
    el.getBoundingClientRect = () =>
      ({
        left: i * 100,
        right: i * 100 + 100,
        width: 100,
        top: 0,
        bottom: 28,
        height: 28,
        x: i * 100,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  });
}

describe("TabBar", () => {
  it("a pinned Tab shows a pin instead of the close button; the pin unpins", () => {
    const p = setup([
      { id: "a", title: "First", active: true, pinned: true },
      { id: "b", title: "Second", active: false },
    ]);
    expect(screen.queryByRole("button", { name: "Close First" })).toBeNull();
    const pin = screen.getByRole("button", { name: "Unpin First" });
    // Shown even when the pinned Tab isn't active or hovered.
    expect(pin.className).not.toContain("invisible");
    fireEvent.click(pin);
    expect(p.onUnpin).toHaveBeenCalledWith("a");
    expect(p.onClose).not.toHaveBeenCalled();
    expect(p.onActivate).not.toHaveBeenCalled();
    // Middle-click still closes it (it stays under Pinned).
    fireEvent(
      screen.getAllByRole("tab")[0],
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(p.onClose).toHaveBeenCalledWith("a");
  });

  it("shows a dot for an unsaved Tab and names it in the close button", () => {
    setup([
      {
        id: "a",
        title: "a.json",
        active: false,
        file: { missing: false, path: "C:/d/a.json" },
        unsaved: true,
      },
    ]);
    expect(
      screen.getByRole("button", { name: "Close a.json (unsaved)" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("unsaved-dot")).toBeInTheDocument();
    expect(screen.getByRole("tab")).toHaveAttribute(
      "title",
      "C:/d/a.json (unsaved)",
    );
  });

  it("a pinned unsaved Tab shows the dot beside the pin", () => {
    setup([
      {
        id: "a",
        title: "a.json",
        active: true,
        pinned: true,
        file: { missing: false, path: "C:/d/a.json" },
        unsaved: true,
      },
    ]);
    expect(screen.getByTestId("unsaved-dot")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Unpin a.json (unsaved)" }),
    ).toBeInTheDocument();
  });

  it("a clean Tab shows no dot", () => {
    setup();
    expect(screen.queryByTestId("unsaved-dot")).toBeNull();
    expect(screen.getByRole("button", { name: "Close First" })).toBeVisible();
  });

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

  it("a File Tab shows its file icon and its path on hover", () => {
    setup(FILE_TABS);
    const icon = (t: Element) =>
      t.querySelector("[data-icon]")?.getAttribute("data-icon");
    const tab = screen.getByText("config.json").closest("[role=tab]")!;
    expect(icon(tab)).toBe("data");
    expect(tab).toHaveAttribute("title", "C:/data/config.json");
    const scratch = screen.getByText("First").closest("[role=tab]")!;
    expect(icon(scratch)).toBe("scratchpad");
  });

  it("a missing File's title is struck through", () => {
    setup(FILE_TABS);
    expect(screen.getByText("old-notes.md").className).toMatch(/line-through/);
    expect(screen.getByText("config.json").className).not.toMatch(
      /line-through/,
    );
  });

  it("renaming a File edits only the stem; the extension stays", async () => {
    const onRename = vi.fn().mockResolvedValue(null);
    setup(FILE_TABS, { onRename });
    fireEvent.doubleClick(screen.getByText("config.json"));
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("config");
    expect(screen.getByText(".json")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "settings" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(onRename).toHaveBeenCalledWith("f", "settings");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("a File rename error shows inline and keeps the field open", async () => {
    const onRename = vi.fn().mockResolvedValue("settings.json already exists");
    setup(FILE_TABS, { onRename });
    fireEvent.doubleClick(screen.getByText("config.json"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "settings" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "settings.json already exists",
    );
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an unchanged File stem doesn't rename", async () => {
    const onRename = vi.fn().mockResolvedValue(null);
    setup(FILE_TABS, { onRename });
    fireEvent.doubleClick(screen.getByText("config.json"));
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("a locked Tab can't be renamed", () => {
    const p = setup([
      { id: "a", title: "First", active: true },
      { ...FILE_TABS[1], locked: true },
    ]);
    fireEvent.doubleClick(screen.getByText("config.json"));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(p.onRename).not.toHaveBeenCalled();
  });

  it("right-click opens the context menu for a Tab or the empty bar", () => {
    const p = setup();
    fireEvent.contextMenu(screen.getByText("Second"), {
      clientX: 5,
      clientY: 6,
    });
    expect(p.onContextMenu).toHaveBeenCalledWith("b", 5, 6);
    fireEvent.contextMenu(screen.getByRole("tablist"), {
      clientX: 7,
      clientY: 8,
    });
    expect(p.onContextMenu).toHaveBeenLastCalledWith(null, 7, 8);
  });

  it("dragging a Tab with the pointer moves it", () => {
    const p = setup([
      { id: "a", title: "First", active: true },
      { id: "b", title: "Second", active: false },
      { id: "c", title: "Third", active: false },
    ]);
    layOut();
    const first = screen.getByText("First").closest("[role=tab]")!;
    fireEvent.pointerDown(first, { button: 0, pointerId: 1, clientX: 50 });
    fireEvent.pointerMove(first, { pointerId: 1, buttons: 1, clientX: 120 });
    fireEvent.pointerMove(first, { pointerId: 1, buttons: 1, clientX: 260 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 260 });
    // Its centre (50 + 210) is past Third's (250): last place.
    expect(p.onMove).toHaveBeenCalledWith("a", 2);
    fireEvent.click(first);
    expect(p.onActivate).not.toHaveBeenCalled();
  });

  it("reportsADragBelowTheBar", () => {
    const onDragOut = vi.fn();
    const onDropOut = vi.fn();
    const onDragOutEnd = vi.fn();
    const p = setup(undefined, { onDragOut, onDropOut, onDragOutEnd });
    layOut();
    const second = screen.getByText("Second").closest("[role=tab]")!;
    fireEvent.pointerDown(second, { button: 0, pointerId: 1, clientX: 150 });
    fireEvent.pointerMove(second, {
      pointerId: 1,
      buttons: 1,
      clientX: 160,
      clientY: 200,
    });
    expect(onDragOut).toHaveBeenCalledWith("b", 160, 200);
    fireEvent.pointerUp(second, { pointerId: 1, clientX: 160, clientY: 200 });
    expect(onDropOut).toHaveBeenCalledWith("b", 160, 200);
    expect(p.onMove).not.toHaveBeenCalled();
    expect(onDragOutEnd).not.toHaveBeenCalled();
  });

  it("a drag that returns to the bar, or Esc, ends the drag-out", () => {
    const onDragOutEnd = vi.fn();
    const onDropOut = vi.fn();
    setup(undefined, { onDragOutEnd, onDropOut, onDragOut: vi.fn() });
    layOut();
    const second = screen.getByText("Second").closest("[role=tab]")!;
    fireEvent.pointerDown(second, { button: 0, pointerId: 1, clientX: 150 });
    fireEvent.pointerMove(second, {
      pointerId: 1,
      buttons: 1,
      clientX: 160,
      clientY: 200,
    });
    fireEvent.pointerMove(second, {
      pointerId: 1,
      buttons: 1,
      clientX: 160,
      clientY: 0,
    });
    expect(onDragOutEnd).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(second, {
      pointerId: 1,
      buttons: 1,
      clientX: 160,
      clientY: 200,
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDragOutEnd).toHaveBeenCalledTimes(2);
    fireEvent.pointerUp(second, { pointerId: 1 });
    expect(onDropOut).not.toHaveBeenCalled();
  });

  it("a small pointer wobble is still a click", () => {
    const p = setup();
    layOut();
    const second = screen.getByText("Second").closest("[role=tab]")!;
    fireEvent.pointerDown(second, { button: 0, pointerId: 1, clientX: 150 });
    fireEvent.pointerMove(second, { pointerId: 1, buttons: 1, clientX: 152 });
    fireEvent.pointerUp(second, { pointerId: 1, clientX: 152 });
    fireEvent.click(second);
    expect(p.onMove).not.toHaveBeenCalled();
    expect(p.onActivate).toHaveBeenCalledWith("b");
  });

  it("Esc cancels a pointer drag", () => {
    const p = setup();
    layOut();
    const first = screen.getByText("First").closest("[role=tab]")!;
    fireEvent.pointerDown(first, { button: 0, pointerId: 1, clientX: 50 });
    fireEvent.pointerMove(first, { pointerId: 1, buttons: 1, clientX: 200 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 200 });
    expect(p.onMove).not.toHaveBeenCalled();
    // The click that ends the cancelled drag doesn't activate the Tab.
    fireEvent.click(first);
    expect(p.onActivate).not.toHaveBeenCalled();
  });

  it("a press released outside the Tab never turns into a drag later", () => {
    const p = setup();
    layOut();
    const first = screen.getByText("First").closest("[role=tab]")!;
    fireEvent.pointerDown(first, { button: 0, pointerId: 1, clientX: 50 });
    // Moved off vertically and released over the editor.
    fireEvent.pointerUp(document.body, { pointerId: 1, clientX: 50 });
    // A later hover (no button) and even a held move don't drag.
    fireEvent.pointerMove(first, { pointerId: 1, buttons: 0, clientX: 200 });
    fireEvent.pointerMove(first, { pointerId: 1, buttons: 1, clientX: 260 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 260 });
    expect(p.onMove).not.toHaveBeenCalled();
    expect(first).not.toHaveAttribute("style");
  });

  it("a hover with no button held drops a pending press", () => {
    const p = setup();
    layOut();
    const first = screen.getByText("First").closest("[role=tab]")!;
    fireEvent.pointerDown(first, { button: 0, pointerId: 1, clientX: 50 });
    fireEvent.pointerMove(first, { pointerId: 1, buttons: 0, clientX: 200 });
    expect(first).not.toHaveAttribute("style");
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 260 });
    expect(p.onMove).not.toHaveBeenCalled();
  });

  it("shows the parent folder after a File's title when given", () => {
    setup([
      { id: "a", title: "First", active: true },
      {
        id: "f",
        title: "config.json",
        active: false,
        folder: "api",
        file: { missing: false, path: "C:/api/config.json" },
      },
    ]);
    const tab = screen.getByText("config.json").closest("[role=tab]")!;
    expect(tab).toHaveTextContent("config.json · api");
  });

  it("rendersAJoinedTab", () => {
    const p = setup(
      [
        { id: "a", title: "First", active: true },
        { id: "b", title: "Second", active: false },
        { id: "c", title: "Third", active: false },
      ],
      { splits: [{ a: "a", b: "b", focus: "a" }] },
    );
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "First | Second" })).toBeTruthy();
    fireEvent.click(screen.getByText("Second"));
    expect(p.onActivate).toHaveBeenCalledWith("b");
    fireEvent.click(
      screen.getByRole("button", { name: "Close First | Second" }),
    );
    expect(p.onCloseSplit).toHaveBeenCalledWith("a");
    expect(p.onClose).not.toHaveBeenCalled();
    fireEvent(
      screen.getByRole("tab", { name: "First | Second" }),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(p.onCloseSplit).toHaveBeenCalledTimes(2);
    fireEvent.doubleClick(screen.getByText("First"));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("dragsAJoinedTabAsOne", () => {
    const p = setup(
      [
        { id: "a", title: "First", active: true },
        { id: "b", title: "Second", active: false },
        { id: "c", title: "Third", active: false },
      ],
      { splits: [{ a: "a", b: "b", focus: "a" }] },
    );
    layOut();
    const joined = screen.getByRole("tab", { name: "First | Second" });
    fireEvent.pointerDown(joined, { button: 0, pointerId: 1, clientX: 50 });
    fireEvent.pointerMove(joined, { pointerId: 1, buttons: 1, clientX: 120 });
    fireEvent.pointerMove(joined, { pointerId: 1, buttons: 1, clientX: 160 });
    fireEvent.pointerUp(joined, { pointerId: 1, clientX: 160 });
    expect(p.onMove).toHaveBeenCalledWith("a", 1);
  });
});
