import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../model/settings";
import { SettingsDialog, type SettingsDialogProps } from "./SettingsDialog";

function setup(over: Partial<SettingsDialogProps> = {}) {
  const props: SettingsDialogProps = {
    settings: { ...DEFAULT_SETTINGS } as Settings,
    fontSize: 13,
    platform: "windows",
    onSettings: vi.fn(),
    onFontSize: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const r = render(<SettingsDialog {...props} />);
  return { ...r, props };
}

describe("SettingsDialog", () => {
  it("shows the current settings on the General tab", () => {
    setup({
      settings: {
        theme: "dark",
        lightTheme: "paper",
        darkTheme: "graphite",
        accent: "blue",
        wrapNewTabs: true,
        lineNumbers: false,
        previewSplit: 0.5,
        markdownDefault: "rich",
      },
      fontSize: 18,
    });
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("spinbutton", { name: "Font size" })).toHaveValue(
      18,
    );
    expect(
      screen.getByRole("checkbox", { name: "Word wrap in new tabs" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Line numbers" }),
    ).not.toBeChecked();
  });

  it("chooses how Markdown notes open", () => {
    const { props } = setup();
    expect(
      screen.getByRole("radiogroup", { name: "Open Markdown notes in" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Rich editor" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Markdown" }));
    expect(props.onSettings).toHaveBeenCalledWith({
      markdownDefault: "markdown",
    });
  });

  it("changes apply right away", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(props.onSettings).toHaveBeenCalledWith({ theme: "light" });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Word wrap in new tabs" }),
    );
    expect(props.onSettings).toHaveBeenCalledWith({ wrapNewTabs: true });
    fireEvent.click(screen.getByRole("checkbox", { name: "Line numbers" }));
    expect(props.onSettings).toHaveBeenCalledWith({ lineNumbers: false });
  });

  it("the font size steps, takes a typed number, and resets", () => {
    const { props, rerender } = setup({ fontSize: 15 });
    fireEvent.click(screen.getByRole("button", { name: "Larger" }));
    expect(props.onFontSize).toHaveBeenLastCalledWith(16);
    fireEvent.click(screen.getByRole("button", { name: "Smaller" }));
    expect(props.onFontSize).toHaveBeenLastCalledWith(14);
    const input = screen.getByRole("spinbutton", { name: "Font size" });
    fireEvent.change(input, { target: { value: "21" } });
    expect(props.onFontSize).toHaveBeenLastCalledWith(21);
    // A half-typed value isn't applied.
    vi.mocked(props.onFontSize).mockClear();
    fireEvent.change(input, { target: { value: "" } });
    expect(props.onFontSize).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(props.onFontSize).toHaveBeenLastCalledWith(14);
    rerender(<SettingsDialog {...props} fontSize={14} />);
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
  });

  it("lists shortcuts for the platform, searchable", () => {
    setup({ platform: "windows" });
    fireEvent.click(screen.getByRole("tab", { name: "Keyboard shortcuts" }));
    const row = screen.getByRole("row", { name: /Reopen closed tab/ });
    expect(within(row).getByText("Ctrl+Shift+T")).toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Search shortcuts" });
    fireEvent.change(search, { target: { value: "sidebar" } });
    expect(screen.queryByRole("row", { name: /Reopen closed tab/ })).toBeNull();
    expect(
      screen.getByRole("row", { name: /Show \/ hide sidebar/ }),
    ).toBeTruthy();
    // By keys too.
    fireEvent.change(search, { target: { value: "ctrl+shift+t" } });
    expect(screen.getByRole("row", { name: /Reopen closed tab/ })).toBeTruthy();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No shortcut matches")).toBeInTheDocument();
  });

  it("shows macOS keys on a Mac", () => {
    setup({ platform: "mac" });
    fireEvent.click(screen.getByRole("tab", { name: "Keyboard shortcuts" }));
    const row = screen.getByRole("row", { name: /Reopen closed tab/ });
    expect(within(row).getByText("⇧⌘T")).toBeInTheDocument();
  });

  it("Escape, the close button and a click outside close it", () => {
    const { props } = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(screen.getByTestId("settings-backdrop"));
    expect(props.onClose).toHaveBeenCalledTimes(3);
    // A click inside doesn't.
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(props.onClose).toHaveBeenCalledTimes(3);
  });

  it("keeps app shortcuts out while open", () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "w", ctrlKey: true });
    window.removeEventListener("keydown", onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
  });
});
