import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuickHit, QuickResult } from "../library/api";
import { QUICK_DEBOUNCE_MS, QUICK_POLL_MS, QuickOpen } from "./QuickOpen";

const hit = (rel: string, positions: number[]): QuickHit => {
  const name = rel.split("/").pop()!;
  return {
    entry: { name, path: `C:/Lib/${rel}`, isDir: false, link: null },
    rel,
    positions,
    score: 0,
  };
};

const TABS = [
  { id: "t1", title: "todo.md", detail: "C:/Lib", icon: "markdown" as const },
  {
    id: "t2",
    title: "Untitled",
    detail: "Scratchpad",
    icon: "scratchpad" as const,
  },
];

function setup(search: (q: string) => Promise<QuickResult>) {
  const p = {
    search: vi.fn(search),
    onOpen: vi.fn(),
    onActivate: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <QuickOpen
      {...p}
      tabs={TABS}
      treeLabel={(path) => (path.startsWith("C:/Work") ? "Work" : null)}
      platform="windows"
    />,
  );
  const input = screen.getByLabelText("Search files by name");
  const type = async (text: string) => {
    fireEvent.change(input, { target: { value: text } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUICK_DEBOUNCE_MS);
    });
  };
  return { ...p, input, type };
}

const names = () =>
  screen.getAllByRole("option").map((o) => o.textContent ?? "");

describe("QuickOpen", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lists the open tabs while the query is empty", () => {
    const { search, input, onActivate } = setup(async () => ({
      hits: [],
      ready: true,
    }));
    expect(names()).toEqual(["todo.mdC:/Lib", "UntitledScratchpad"]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledWith("t2");
    expect(search).not.toHaveBeenCalled();
  });

  it("searches as you type and opens the chosen file", async () => {
    const hits = [
      hit("notes/plan.md", [6, 7, 8, 9]),
      hit("work/old/plan.txt", [9, 10, 11, 12]),
    ];
    const { search, input, type, onOpen } = setup(async () => ({
      hits,
      ready: true,
    }));
    await type("plan");
    expect(search).toHaveBeenLastCalledWith("plan");
    expect(names()).toEqual(["plan.mdnotes", "plan.txtwork/old"]);
    // The matched letters are marked.
    const first = screen.getAllByRole("option")[0];
    expect(first.querySelector("mark")?.textContent).toBe("plan");

    // Mod+P again moves down, like the arrow.
    fireEvent.keyDown(input, { key: "p", code: "KeyP", ctrlKey: true });
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(hits[1].entry);
  });

  it("labels hits in an added folder with its name", async () => {
    const h = hit("a/b.md", [2]);
    h.entry.path = "C:/Work/a/b.md";
    const { type } = setup(async () => ({ hits: [h], ready: true }));
    await type("b");
    expect(names()).toEqual(["b.mdWork/a"]);
  });

  it("asks again while the index is building", async () => {
    let ready = false;
    const { search, type } = setup(async () => ({
      hits: ready ? [hit("x.md", [0])] : [],
      ready,
    }));
    await type("x");
    expect(screen.getByText("Searching…")).toBeTruthy();
    ready = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUICK_POLL_MS);
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(names()).toEqual(["x.md"]);
  });

  it("says when nothing matches, and Escape closes", async () => {
    const { input, type, onClose } = setup(async () => ({
      hits: [],
      ready: true,
    }));
    await type("zzz");
    expect(screen.getByText("No matching files")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps keys from reaching the app behind it", () => {
    const { input } = setup(async () => ({ hits: [], ready: true }));
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    fireEvent.keyDown(input, { key: "w", code: "KeyW", ctrlKey: true });
    window.removeEventListener("keydown", behind);
    expect(behind).not.toHaveBeenCalled();
  });
});
