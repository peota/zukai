import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarToggle } from "./SidebarToggle";

describe("SidebarToggle", () => {
  it("hides an open sidebar and names the shortcut", () => {
    const onToggle = vi.fn();
    render(<SidebarToggle open platform="windows" onToggle={onToggle} />);
    const button = screen.getByRole("button", { name: "Hide sidebar" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("title", "Hide sidebar (Ctrl+B)");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("shows a hidden sidebar, with the Mac key", () => {
    render(<SidebarToggle open={false} platform="mac" onToggle={() => {}} />);
    const button = screen.getByRole("button", { name: "Show sidebar" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button.getAttribute("title")).toMatch(/^Show sidebar \(.+B\)$/);
  });
});
