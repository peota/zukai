import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../model/settings";
import { SettingsDialog, type SettingsDialogProps } from "./SettingsDialog";
import type { Updater } from "../app/useUpdater";

function openSection(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
}

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
  it("shows the current settings, section by section", () => {
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
        gitSync: true,
        revealActiveFile: true,
        previewSplit: 0.5,
        markdownDefault: "rich",
        terminalPosition: "bottom",
        terminalHeight: 280,
        terminalWidth: 480,
        gitWidth: 320,
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
    openSection("Editor");
    expect(
      screen.getByRole("checkbox", { name: "Word wrap in new tabs" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Line numbers" }),
    ).not.toBeChecked();
    openSection("Files");
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
    openSection("Editor");
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
    openSection("Editor");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Word wrap in new tabs" }),
    );
    expect(props.onSettings).toHaveBeenCalledWith({ wrapNewTabs: true });
    fireEvent.click(screen.getByRole("checkbox", { name: "Line numbers" }));
    expect(props.onSettings).toHaveBeenCalledWith({ lineNumbers: false });
    openSection("Files");
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

  it("moves between sections with the arrow keys", () => {
    setup();
    const appearance = screen.getByRole("tab", { name: "Appearance" });
    expect(appearance).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(appearance, { key: "ArrowDown" });
    expect(screen.getByRole("tab", { name: "Editor" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "Editor" }), {
      key: "ArrowUp",
    });
    fireEvent.keyDown(appearance, { key: "ArrowUp" });
    expect(screen.getByRole("tab", { name: "About" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
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

  it("has no AI tab", () => {
    setup();
    expect(screen.queryByRole("tab", { name: "AI" })).toBeNull();
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

describe("SettingsDialog About", () => {
  const updater = (over: Partial<Updater> = {}): Updater => ({
    status: "idle",
    currentVersion: "0.1.0",
    newVersion: null,
    progress: null,
    error: null,
    canInstall: true,
    checkNow: vi.fn(() => Promise.resolve()),
    install: vi.fn(() => Promise.resolve()),
    ...over,
  });

  it("shows the version and checks on request", () => {
    const u = updater();
    setup({ updater: u, initialSection: "about" });
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(u.checkNow).toHaveBeenCalledWith(true);
  });

  it("marks About and installs an available update", () => {
    const u = updater({ status: "available", newVersion: "0.2.0" });
    setup({ updater: u });
    const tab = screen.getByRole("tab", { name: /About/ });
    expect(within(tab).getByLabelText("Update available")).toBeInTheDocument();
    fireEvent.click(tab);
    expect(screen.getByText(/Zukai 0\.2\.0 is available/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Install and restart" }),
    );
    expect(u.install).toHaveBeenCalled();
  });

  it("sends a package-manager install to the release page", () => {
    const onOpenReleases = vi.fn();
    setup({
      updater: updater({
        status: "available",
        newVersion: "0.2.0",
        canInstall: false,
      }),
      onOpenReleases,
      initialSection: "about",
    });
    expect(
      screen.queryByRole("button", { name: "Install and restart" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open release page" }));
    expect(onOpenReleases).toHaveBeenCalled();
  });

  it("shows download progress", () => {
    setup({
      updater: updater({
        status: "downloading",
        newVersion: "0.2.0",
        progress: 0.42,
      }),
      initialSection: "about",
    });
    expect(screen.getByText("Downloading 0.2.0… 42%")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Install and restart" }),
    ).toBeDisabled();
  });
});
