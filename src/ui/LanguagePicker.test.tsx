import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LanguagePicker } from "./LanguagePicker";

const offer = { from: "note.md", to: "note.ts" };

function setup(rename: typeof offer | null) {
  const p = { onPick: vi.fn(), onClose: vi.fn(), onRename: vi.fn() };
  const r = render(
    <LanguagePicker open current="typescript" rename={rename} {...p} />,
  );
  return { ...p, ...r };
}

describe("LanguagePicker rename offer", () => {
  it("shows no rename row without an offer", () => {
    setup(null);
    expect(screen.queryByText(/Rename/)).toBeNull();
  });

  it("selects the rename row, and Enter renames", () => {
    const { onRename, onPick } = setup(offer);
    const row = screen.getByRole("option", {
      name: "Rename note.md → note.ts",
    });
    expect(row.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByLabelText("Filter languages"), {
      key: "Enter",
    });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("a click on the row renames; Escape only closes", () => {
    const { onRename, onClose } = setup(offer);
    fireEvent.keyDown(screen.getByLabelText("Filter languages"), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalled();
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByText("Rename note.md → note.ts"));
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("typing a filter hides the row and arrows move through languages", () => {
    const { onPick, onRename } = setup(offer);
    const input = screen.getByLabelText("Filter languages");
    fireEvent.change(input, { target: { value: "json" } });
    expect(screen.queryByText(/Rename/)).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("json");
    expect(onRename).not.toHaveBeenCalled();
  });

  it("a new offer after a pick clears the filter and selects the row", () => {
    const p = { onPick: vi.fn(), onClose: vi.fn(), onRename: vi.fn() };
    const { rerender } = render(
      <LanguagePicker open current="markdown" rename={null} {...p} />,
    );
    const input = screen.getByLabelText("Filter languages") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "type" } });
    rerender(
      <LanguagePicker open current="typescript" rename={offer} {...p} />,
    );
    expect(input.value).toBe("");
    expect(
      screen
        .getByRole("option", { name: "Rename note.md → note.ts" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
});
