import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GIT_MIN_WIDTH } from "../../model/settings";
import { GitPanel } from "./GitPanel";
import { fakeGit, repo } from "./testing";

const LIB = "C:\\Lib";

function setup(width = 320) {
  const p = {
    width,
    onWidth: vi.fn(),
    onClose: vi.fn(),
    git: fakeGit({ statuses: { [LIB]: repo() } }),
    folders: [{ path: LIB, name: "Library" }],
    defaultFolder: LIB,
    unsavedUnder: vi.fn(() => 0),
    onSaveAll: vi.fn(),
    onOpenDiff: vi.fn(),
    onOpenFile: vi.fn(),
    onCopyPath: vi.fn(),
    onAddFromGit: vi.fn(),
  };
  render(<GitPanel {...p} />);
  return p;
}

describe("GitPanel", () => {
  it("is a titled panel holding the Git view", () => {
    setup();
    const panel = screen.getByRole("region", { name: "Git panel" });
    expect(within(panel).getByText("Git")).toBeTruthy();
    expect(within(panel).getByRole("region", { name: "Git" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Pull" })).toBeTruthy();
  });

  it("takes its width, never below the minimum", () => {
    setup(400);
    const panel = screen.getByRole("region", { name: "Git panel" });
    expect(panel.style.width).toBe("400px");
    expect(panel.style.minWidth).toBe(`${GIT_MIN_WIDTH}px`);
    expect(panel.style.maxWidth).toBe("70%");
  });

  it("× closes it", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close Git panel" }));
    expect(p.onClose).toHaveBeenCalledOnce();
  });

  it("its left edge resizes it: left arrow wider, right arrow narrower", () => {
    const p = setup(320);
    const edge = screen.getByRole("separator", { name: "Resize Git panel" });
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    expect(p.onWidth).toHaveBeenLastCalledWith(336);
    fireEvent.keyDown(edge, { key: "ArrowRight" });
    expect(p.onWidth).toHaveBeenLastCalledWith(304);
  });
});
