import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TabPane, type TabPaneProps } from "./TabPane";
import type { TabState } from "../model/types";

const seen = vi.hoisted(() => ({
  calls: [] as { id: string; goToPage: unknown; findRequest: unknown }[],
}));

vi.mock("../pdf/PdfHost", () => ({
  default: (p: {
    tab: { id: string };
    goToPage: unknown;
    findRequest: unknown;
  }) => {
    seen.calls.push({
      id: p.tab.id,
      goToPage: p.goToPage,
      findRequest: p.findRequest,
    });
    return null;
  },
}));
vi.mock("../ui/FileBar", () => ({ FileBar: () => null }));

const pdfTab = (id: string) =>
  ({
    id,
    kind: "pdf",
    title: id,
    file: { path: `/${id}.pdf`, held: "none" },
  }) as unknown as TabState;

function pane(
  id: string,
  focused: boolean,
  goToPage: TabPaneProps["goToPage"],
  findRequest: TabPaneProps["findRequest"] = null,
) {
  return (
    <TabPane
      {...({
        tab: pdfTab(id),
        focused,
        goToPage,
        findRequest,
        tabs: [],
        slotRef: () => {},
        reloadSeq: 0,
        onImageInfo: () => {},
      } as unknown as TabPaneProps)}
    />
  );
}

describe("TabPane go to page", () => {
  it("a request for PDF B never reaches PDF A when A's pane gets focus", async () => {
    // Split: A unfocused, B focused; the user goes to a page in B.
    const req = { tabId: "b", page: 7, seq: 1 };
    const { rerender } = render(pane("a", false, req));
    // Focus moves to A.
    rerender(pane("a", true, req));
    await vi.waitFor(() => expect(seen.calls.length).toBeGreaterThan(0));
    expect(seen.calls.every((c) => c.goToPage === null)).toBe(true);
  });

  it("a request for this Tab reaches it", async () => {
    seen.calls.length = 0;
    const req = { tabId: "a", page: 3, seq: 2 };
    render(pane("a", true, req));
    await vi.waitFor(() => expect(seen.calls.length).toBeGreaterThan(0));
    expect(seen.calls[seen.calls.length - 1]?.goToPage).toEqual(req);
  });
});

describe("TabPane find", () => {
  it("a find request for PDF B never reaches PDF A when A's pane gets focus", async () => {
    seen.calls.length = 0;
    // Split: A unfocused, B focused; the user presses Mod+F in B.
    const req = { mode: "find" as const, seq: 4, tabId: "b" };
    const { rerender } = render(pane("a", false, null, req));
    // Focus moves to A.
    rerender(pane("a", true, null, req));
    await vi.waitFor(() => expect(seen.calls.length).toBeGreaterThan(0));
    expect(seen.calls.every((c) => c.findRequest === null)).toBe(true);
  });

  it("a find request for this Tab reaches it", async () => {
    seen.calls.length = 0;
    const req = { mode: "find" as const, seq: 5, tabId: "a" };
    render(pane("a", true, null, req));
    await vi.waitFor(() => expect(seen.calls.length).toBeGreaterThan(0));
    expect(seen.calls[seen.calls.length - 1]?.findRequest).toEqual(req);
  });
});
