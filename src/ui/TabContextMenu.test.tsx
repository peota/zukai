import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ClosedEntry, TabState } from "../model/types";
import { TabContextMenu, type TabContextMenuProps } from "./TabContextMenu";

function entry(n: number, path?: string): ClosedEntry {
  const tab: TabState = {
    kind: "text",
    id: `c${n}`,
    title: `Closed ${n}`,
    renamed: false,
    language: "plaintext",
    languagePicked: false,
    languageGuessed: false,
    selection: { anchor: 0, head: 0 },
    scrollTop: 0,
    wrap: false,
    ...(path
      ? {
          file: {
            path,
            format: {
              encoding: "utf-8",
              bom: false,
              lineEnding: "lf",
              mixed: false,
            },
            fingerprint: null,
            held: null,
          },
        }
      : {}),
  };
  return { tab, index: 0, closedAt: 1000 - n };
}

function setup(
  tabId: string | null,
  closed: ClosedEntry[],
  tabCount = 2,
  pinned = false,
  canCloseAll = true,
  over: Partial<TabContextMenuProps> = {},
) {
  const props = {
    x: 10,
    y: 20,
    tabId,
    tabCount,
    closed,
    pinned,
    onTogglePin: vi.fn(),
    onClose: vi.fn(),
    onCloseOthers: vi.fn(),
    canCloseAll,
    onCloseAll: vi.fn(),
    onSaveAll: vi.fn(),
    onReopen: vi.fn(),
    onReopenEntry: vi.fn(),
    onDismiss: vi.fn(),
    splitCandidates: [{ id: "n", title: "notes" }],
    onSplitWith: vi.fn(),
    onUnsplit: vi.fn(),
    onSwap: vi.fn(),
    onOrientation: vi.fn(),
    onCloseSplit: vi.fn(),
    ...over,
  };
  render(<TabContextMenu {...props} />);
  return props;
}

function openRecent() {
  fireEvent.click(screen.getByRole("menuitem", { name: /Recently closed/ }));
  return screen.getByRole("menu", { name: "Recently closed" });
}

describe("TabContextMenu", () => {
  it("Close tab and Close other tabs act on the right-clicked Tab", () => {
    const p = setup("a", []);
    fireEvent.click(screen.getByRole("menuitem", { name: "Close tab" }));
    expect(p.onClose).toHaveBeenCalledWith("a");
    expect(p.onDismiss).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Close other tabs" }));
    expect(p.onCloseOthers).toHaveBeenCalledWith("a");
  });

  it("Pin tab pins the right-clicked Tab; on a pinned one it reads Unpin tab", () => {
    const p = setup("a", []);
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin tab" }));
    expect(p.onTogglePin).toHaveBeenCalledWith("a");
    expect(p.onDismiss).toHaveBeenCalled();
  });

  it("a pinned Tab's menu offers Unpin tab", () => {
    const p = setup("a", [], 2, true);
    expect(screen.queryByRole("menuitem", { name: "Pin tab" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin tab" }));
    expect(p.onTogglePin).toHaveBeenCalledWith("a");
  });

  it("Close all tabs closes them all, from a Tab or the empty bar", () => {
    const p = setup("a", []);
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    // After Close other tabs, with Save all between them.
    expect(items.indexOf("Close all tabs")).toBe(
      items.indexOf("Close other tabs") + 2,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Close all tabs" }));
    expect(p.onCloseAll).toHaveBeenCalledTimes(1);
    expect(p.onDismiss).toHaveBeenCalled();
  });

  it("Save all calls onSaveAll", () => {
    const p = setup("a", [], 2, false, true, {
      canSaveAll: true,
      onSaveAll: vi.fn(),
    });
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(items.indexOf("Save all")).toBe(items.indexOf("Close all tabs") - 1);
    fireEvent.click(screen.getByRole("menuitem", { name: "Save all" }));
    expect(p.onSaveAll).toHaveBeenCalledTimes(1);
  });

  it("Save all is disabled when nothing is unsaved", () => {
    const p = setup("a", [], 2, false, true, {
      canSaveAll: false,
      onSaveAll: vi.fn(),
    });
    const item = screen.getByRole("menuitem", { name: "Save all" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item);
    expect(p.onSaveAll).not.toHaveBeenCalled();
  });

  it("Close all tabs works on the empty bar", () => {
    const p = setup(null, []);
    fireEvent.click(screen.getByRole("menuitem", { name: "Close all tabs" }));
    expect(p.onCloseAll).toHaveBeenCalledTimes(1);
  });

  it("Close all tabs is disabled when only pinned Tabs are open", () => {
    const p = setup("a", [], 2, true, false);
    const item = screen.getByRole("menuitem", { name: "Close all tabs" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item);
    expect(p.onCloseAll).not.toHaveBeenCalled();
  });

  it("on the empty bar, the close items are disabled", () => {
    const p = setup(null, [entry(1)]);
    const close = screen.getByRole("menuitem", { name: "Close tab" });
    expect(close).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(close);
    expect(p.onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("menuitem", { name: "Close other tabs" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("Reopen closed tab calls onReopen, and is disabled with nothing closed", () => {
    const p = setup("a", [entry(1)]);
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Reopen closed tab/ }),
    );
    expect(p.onReopen).toHaveBeenCalled();
  });

  it("Reopen closed tab is disabled when nothing was closed", () => {
    setup("a", []);
    expect(
      screen.getByRole("menuitem", { name: /Reopen closed tab/ }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("lists the newest 20 entries, newest first, with File paths", () => {
    const closed = Array.from({ length: 25 }, (_, i) =>
      entry(i, i === 1 ? "C:\\notes\\todo.md" : undefined),
    );
    setup("a", closed);
    const list = openRecent();
    const items = within(list).getAllByRole("menuitem");
    expect(items).toHaveLength(20);
    expect(items[0]).toHaveTextContent("Closed 0");
    expect(items[19]).toHaveTextContent("Closed 19");
    expect(within(list).queryByText("Closed 20")).toBeNull();
    expect(
      within(items[1]).getByText("C:\\notes\\todo.md"),
    ).toBeInTheDocument();
  });

  it("clicking an entry reopens it by its Tab id", () => {
    const p = setup("a", [entry(0), entry(1), entry(2)]);
    const list = openRecent();
    fireEvent.click(within(list).getByText("Closed 2"));
    expect(p.onReopenEntry).toHaveBeenCalledWith("c2");
    expect(p.onDismiss).toHaveBeenCalled();
  });

  it("Close other tabs is disabled with only one Tab open", () => {
    const p = setup("a", [], 1);
    const others = screen.getByRole("menuitem", { name: "Close other tabs" });
    expect(others).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(others);
    expect(p.onCloseOthers).not.toHaveBeenCalled();
  });

  it("Esc dismisses the menu", () => {
    const p = setup("a", []);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(p.onDismiss).toHaveBeenCalled();
  });

  it("splitWithListsCandidates", () => {
    const p = setup("a", []);
    fireEvent.click(screen.getByRole("menuitem", { name: /Split with/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "notes" }));
    expect(p.onSplitWith).toHaveBeenCalledWith("a", "n");
  });

  it("Split with is disabled without candidates", () => {
    setup("a", [], 2, false, true, { splitCandidates: [] });
    expect(
      screen.getByRole("menuitem", { name: /Split with/ }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("joinedTabMenu", () => {
    const p = setup("a", [], 2, false, true, {
      split: { orientation: "row" },
    });
    expect(screen.queryByRole("menuitem", { name: "Close tab" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Side by side" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unsplit" }));
    expect(p.onUnsplit).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByRole("menuitem", { name: "Swap sides" }));
    expect(p.onSwap).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByRole("menuitem", { name: "Top and bottom" }));
    expect(p.onOrientation).toHaveBeenCalledWith("a", "column");
    fireEvent.click(screen.getByRole("menuitem", { name: "Close split" }));
    expect(p.onCloseSplit).toHaveBeenCalledWith("a");
  });
});
