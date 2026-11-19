import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SaveChangesDialog } from "./SaveChangesDialog";

function setup() {
  const onChoose = vi.fn();
  render(<SaveChangesDialog name="config.json" onChoose={onChoose} />);
  return { onChoose };
}

describe("SaveChangesDialog", () => {
  it("asks about the File by name, with Save focused", () => {
    setup();
    const dialog = screen.getByRole("alertdialog", {
      name: "Save changes to config.json?",
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
  });

  it("each button answers with its choice", () => {
    const { onChoose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Don't save" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChoose.mock.calls).toEqual([["save"], ["discard"], ["cancel"]]);
  });

  it("Esc cancels", () => {
    const { onChoose } = setup();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("cancel");
  });

  it("keeps app shortcuts out while open", () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "Save" }), {
      key: "w",
      ctrlKey: true,
    });
    window.removeEventListener("keydown", onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
  });
});
