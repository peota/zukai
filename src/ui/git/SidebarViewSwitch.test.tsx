import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarViewSwitch } from "./SidebarViewSwitch";

/** The dot adds "Uncommitted changes" to the Git segment's name. */
const seg = (name: "Files" | "Git") =>
  screen.getByRole("radio", { name: new RegExp(`^${name}`) });

describe("SidebarViewSwitch", () => {
  it("has Files and Git segments, the chosen one checked", () => {
    const onView = vi.fn();
    render(<SidebarViewSwitch view="files" dirty={false} onView={onView} />);
    const group = screen.getByRole("radiogroup", { name: "Sidebar view" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["Files", "Git"]);
    expect(seg("Files")).toHaveAttribute("aria-checked", "true");
    expect(seg("Git")).toHaveAttribute("aria-checked", "false");
    // Only the chosen segment is in the Tab order.
    expect(seg("Files")).toHaveAttribute("tabindex", "0");
    expect(seg("Git")).toHaveAttribute("tabindex", "-1");
    fireEvent.click(seg("Git"));
    expect(onView).toHaveBeenCalledWith("git");
  });

  it("shows the uncommitted dot on Git only when dirty", () => {
    const { rerender } = render(
      <SidebarViewSwitch view="files" dirty={false} onView={vi.fn()} />,
    );
    expect(screen.queryByTitle("Uncommitted changes")).toBeNull();
    rerender(<SidebarViewSwitch view="files" dirty onView={vi.fn()} />);
    const dot = screen.getByTitle("Uncommitted changes");
    expect(seg("Git").contains(dot)).toBe(true);
  });

  it("arrow keys move between the segments", () => {
    const onView = vi.fn();
    const { rerender } = render(
      <SidebarViewSwitch view="files" dirty={false} onView={onView} />,
    );
    fireEvent.keyDown(seg("Files"), { key: "ArrowRight" });
    expect(onView).toHaveBeenLastCalledWith("git");
    rerender(<SidebarViewSwitch view="git" dirty={false} onView={onView} />);
    expect(seg("Git")).toHaveFocus();
    fireEvent.keyDown(seg("Git"), { key: "ArrowLeft" });
    expect(onView).toHaveBeenLastCalledWith("files");
    rerender(<SidebarViewSwitch view="files" dirty={false} onView={onView} />);
    expect(seg("Files")).toHaveFocus();
    // Wraps around, like a native radio group.
    fireEvent.keyDown(seg("Files"), { key: "ArrowLeft" });
    expect(onView).toHaveBeenLastCalledWith("git");
    fireEvent.keyDown(seg("Files"), { key: "ArrowDown" });
    expect(onView).toHaveBeenCalledTimes(3);
  });
});
