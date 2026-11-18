import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ClosedEntry, TabState } from "../model/types";
import { TabContextMenu } from "./TabContextMenu";

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

function setup(tabId: string | null, closed: ClosedEntry[], tabCount = 2) {
  const props = {
    x: 10,
    y: 20,
    tabId,
    tabCount,
    closed,
    onClose: vi.fn(),
    onCloseOthers: vi.fn(),
    onReopen: vi.fn(),
    onReopenEntry: vi.fn(),
    onDismiss: vi.fn(),
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
});
