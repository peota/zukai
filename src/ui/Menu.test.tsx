import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Menu, type MenuItem } from "./Menu";

function setup(items: MenuItem[]) {
  const onDismiss = vi.fn();
  render(<Menu label="Test" x={0} y={0} items={items} onDismiss={onDismiss} />);
  return onDismiss;
}

describe("Menu accelerators and sections", () => {
  it("chooses the item whose accel is pressed", () => {
    const onSelect = vi.fn();
    const onDismiss = setup([
      { label: "One" },
      { label: "Two", accel: "2", onSelect },
    ]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "2" });
    expect(onSelect).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledWith(true);
  });

  it("ignores the accel of a disabled item", () => {
    const onSelect = vi.fn();
    const onDismiss = setup([
      { label: "Two", accel: "2", disabled: true, onSelect },
    ]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "2" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("ignores an accel pressed with Ctrl, Meta or Alt", () => {
    const onSelect = vi.fn();
    const onDismiss = setup([{ label: "Two", accel: "2", onSelect }]);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "2", ctrlKey: true });
    fireEvent.keyDown(menu, { key: "2", metaKey: true });
    fireEvent.keyDown(menu, { key: "2", altKey: true });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("renders a section's text", () => {
    setup([{ label: "A", section: "Start an agent" }]);
    expect(screen.getByText("Start an agent")).toBeInTheDocument();
  });
});
