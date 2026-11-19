import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplitHandle } from "./SplitHandle";

/** The handle inside a 1000px-wide row starting at x=100. */
function setup(ratio = 0.5) {
  const onRatio = vi.fn();
  const r = render(
    <div data-testid="row">
      <SplitHandle ratio={ratio} onRatio={onRatio} />
    </div>,
  );
  const row = screen.getByTestId("row");
  row.getBoundingClientRect = () =>
    ({ left: 100, width: 1000, right: 1100 }) as DOMRect;
  const handle = screen.getByRole("separator", { name: "Resize preview" });
  return { ...r, onRatio, handle };
}

describe("SplitHandle", () => {
  it("reports its split as a percentage", () => {
    const { handle } = setup(0.4);
    expect(handle).toHaveAttribute("aria-valuenow", "40");
    expect(handle).toHaveAttribute("aria-valuemin", "20");
    expect(handle).toHaveAttribute("aria-valuemax", "80");
  });

  it("dragging sets the editor's share of the row, within 20–80%", () => {
    const { handle, onRatio } = setup();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 600 });
    fireEvent.pointerMove(handle, { pointerId: 1, buttons: 1, clientX: 400 });
    expect(onRatio).toHaveBeenLastCalledWith(0.3);
    fireEvent.pointerMove(handle, { pointerId: 1, buttons: 1, clientX: 120 });
    expect(onRatio).toHaveBeenLastCalledWith(0.2);
    fireEvent.pointerMove(handle, { pointerId: 1, buttons: 1, clientX: 1090 });
    expect(onRatio).toHaveBeenLastCalledWith(0.8);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    onRatio.mockClear();
    fireEvent.pointerMove(handle, { pointerId: 1, buttons: 1, clientX: 500 });
    expect(onRatio).not.toHaveBeenCalled();
  });

  it("arrow keys step it, and a double-click resets it to half", () => {
    const { handle, onRatio } = setup(0.5);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onRatio).toHaveBeenLastCalledWith(0.45);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onRatio).toHaveBeenLastCalledWith(0.55);
    fireEvent.doubleClick(handle);
    expect(onRatio).toHaveBeenLastCalledWith(0.5);
  });
});
