import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplitView } from "./SplitView";

describe("SplitView", () => {
  it("laysOutBothOrientations", () => {
    const onRatio = vi.fn();
    const r = render(
      <SplitView
        orientation="row"
        ratio={0.5}
        onRatio={onRatio}
        focus="b"
        first={<div data-testid="first" />}
        second={<div data-testid="second" />}
      />,
    );
    const half = (id: string) =>
      screen.getByTestId(id).parentElement as HTMLElement;
    const root = half("first").parentElement as HTMLElement;
    expect(root.className).toContain("flex-row");
    expect(half("first").style.flexBasis).toBe("50%");
    expect(half("first")).not.toHaveAttribute("data-focused");
    expect(half("second")).toHaveAttribute("data-focused");

    // Its divider sets the first half's share.
    const handle = screen.getByRole("separator");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onRatio).toHaveBeenLastCalledWith(0.55);

    r.rerender(
      <SplitView
        orientation="column"
        ratio={0.3}
        onRatio={onRatio}
        focus="a"
        first={<div data-testid="first" />}
        second={<div data-testid="second" />}
      />,
    );
    expect(root.className).toContain("flex-col");
    expect(root.className).not.toContain("flex-row");
    expect(half("first").style.flexBasis).toBe("30%");
    expect(half("first")).toHaveAttribute("data-focused");
    expect(half("second")).not.toHaveAttribute("data-focused");
    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
  });
});
