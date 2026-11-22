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
    aiStatus: { config: null, hasKey: false, ready: false },
    onAiStatus: vi.fn(),
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
        uiFontSize: 14,
        wrapNewTabs: true,
        lineNumbers: false,
        autosaveFiles: false,
        revealActiveFile: true,
        previewSplit: 0.5,
        markdownDefault: "rich",
        terminalPosition: "bottom",
        terminalHeight: 280,
        terminalWidth: 480,
        askWidth: 400,
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
    expect(
      screen.getByRole("spinbutton", { name: "Editor font size" }),
    ).toHaveValue(18);
    expect(
      screen.getByRole("checkbox", { name: "Word wrap in new tabs" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Line numbers" }),
    ).not.toBeChecked();
    const autosave = screen.getByRole("checkbox", {
      name: "Save files automatically",
    });
    expect(autosave).not.toBeChecked();
    expect(autosave).toHaveAccessibleDescription(
      "Scratchpads always save themselves. When off, a file changes on disk only when you save it.",
    );
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
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Save files automatically" }),
    );
    expect(props.onSettings).toHaveBeenCalledWith({ autosaveFiles: true });
  });

  it("the font size steps, takes a typed number, and resets", () => {
    const { props, rerender } = setup({ fontSize: 15 });
    fireEvent.click(
      screen.getByRole("button", { name: "Editor font size larger" }),
    );
    expect(props.onFontSize).toHaveBeenLastCalledWith(16);
    fireEvent.click(
      screen.getByRole("button", { name: "Editor font size smaller" }),
    );
    expect(props.onFontSize).toHaveBeenLastCalledWith(14);
    const input = screen.getByRole("spinbutton", { name: "Editor font size" });
    fireEvent.change(input, { target: { value: "21" } });
    expect(props.onFontSize).toHaveBeenLastCalledWith(21);
    // A half-typed value isn't applied.
    vi.mocked(props.onFontSize).mockClear();
    fireEvent.change(input, { target: { value: "" } });
    expect(props.onFontSize).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Reset editor font size" }),
    );
    expect(props.onFontSize).toHaveBeenLastCalledWith(14);
    rerender(<SettingsDialog {...props} fontSize={14} />);
    expect(
      screen.getByRole("button", { name: "Reset editor font size" }),
    ).toBeDisabled();
  });

  it("the interface font size steps and resets through Settings", () => {
    const { props, rerender } = setup();
    const input = screen.getByRole("spinbutton", {
      name: "Interface font size",
    });
    expect(input).toHaveValue(14);
    fireEvent.click(
      screen.getByRole("button", { name: "Interface font size larger" }),
    );
    expect(props.onSettings).toHaveBeenLastCalledWith({ uiFontSize: 15 });
    fireEvent.change(input, { target: { value: "17" } });
    expect(props.onSettings).toHaveBeenLastCalledWith({ uiFontSize: 17 });
    fireEvent.change(input, { target: { value: "40" } });
    expect(props.onSettings).not.toHaveBeenLastCalledWith({ uiFontSize: 40 });
    rerender(
      <SettingsDialog
        {...props}
        settings={{ ...props.settings, uiFontSize: 16 }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reset interface font size" }),
    );
    expect(props.onSettings).toHaveBeenLastCalledWith({ uiFontSize: 14 });
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

  it("lists the Ask panel's shortcut only once an AI provider is ready", () => {
    const { unmount } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Keyboard shortcuts" }));
    expect(screen.queryByRole("row", { name: /Toggle Ask panel/ })).toBeNull();
    unmount();
    setup({
      aiStatus: {
        config: { provider: "anthropic", model: "claude-sonnet-5-5" },
        hasKey: true,
        ready: true,
      },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Keyboard shortcuts" }));
    const row = screen.getByRole("row", { name: /Toggle Ask panel/ });
    expect(within(row).getByText("Ctrl+J")).toBeInTheDocument();
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
