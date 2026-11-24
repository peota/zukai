import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FileFormat } from "../model/types";
import { StatusBar, fileSize, type StatusBarProps } from "./StatusBar";
import { encodingLabel } from "./encodings";

const fmt = (over: Partial<FileFormat> = {}): FileFormat => ({
  encoding: "utf-8",
  bom: false,
  lineEnding: "lf",
  mixed: false,
  ...over,
});

function setup(over: Partial<StatusBarProps> = {}) {
  const props: StatusBarProps = {
    line: 3,
    col: 17,
    language: "json",
    saveStatus: "saved",
    onPickLanguage: vi.fn(),
    platformLineEnding: "crlf",
    onEncodingMenu: vi.fn(),
    onLineEndingMenu: vi.fn(),
    showFormat: false,
    onFormat: vi.fn(),
    ...over,
  };
  render(<StatusBar {...props} />);
  return props;
}

describe("encodingLabel", () => {
  it("names the common encodings", () => {
    expect(encodingLabel(fmt())).toBe("UTF-8");
    expect(encodingLabel(fmt({ bom: true }))).toBe("UTF-8 BOM");
    expect(encodingLabel(fmt({ encoding: "utf-16le", bom: true }))).toBe(
      "UTF-16 LE",
    );
    expect(encodingLabel(fmt({ encoding: "utf-16be", bom: true }))).toBe(
      "UTF-16 BE",
    );
    expect(encodingLabel(fmt({ encoding: "windows-1252" }))).toBe(
      "Windows-1252",
    );
    expect(encodingLabel(fmt({ encoding: "shift_jis" }))).toBe("SHIFT_JIS");
  });
});

describe("StatusBar git chip", () => {
  it("shows the branch with an icon and opens the Git view on click", () => {
    const onClick = vi.fn();
    setup({ git: { branch: "main", state: "none", onClick } });
    const chip = screen.getByRole("button", { name: /main/ });
    expect(chip.querySelector("svg")).not.toBeNull();
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("names a rebase or merge in progress", () => {
    setup({ git: { branch: "feat", state: "rebasing", onClick: vi.fn() } });
    expect(screen.getByRole("button", { name: /feat/ }).textContent).toContain(
      "rebasing",
    );
    // A rebase isn't an error: the word is in the chip's own ink.
    expect(screen.getByText("rebasing").className).not.toContain("text-danger");
  });

  it("names the branch in its tooltip, for a truncated name", () => {
    setup({ git: { branch: "feat/long", state: "none", onClick: vi.fn() } });
    expect(
      screen.getByRole("button", { name: /feat\/long/ }).getAttribute("title"),
    ).toBe("feat/long: show in Git");
  });

  it("is absent without the git prop", () => {
    setup();
    expect(screen.queryByRole("button", { name: /main/ })).toBeNull();
    expect(document.querySelector("[data-git-chip]")).toBeNull();
  });
});

describe("StatusBar", () => {
  it("the gear opens Settings, with its shortcut in the tooltip", () => {
    const p = setup({ onSettings: vi.fn(), settingsHint: "Ctrl+," });
    const gear = screen.getByRole("button", { name: "Settings" });
    expect(gear.getAttribute("title")).toBe("Settings (Ctrl+,)");
    fireEvent.click(gear);
    expect(p.onSettings).toHaveBeenCalled();
  });

  it("a Markdown Tab's preview switch shows and sets the mode", () => {
    const onChange = vi.fn();
    setup({
      language: "markdown",
      preview: { mode: "split", onChange, hint: "Ctrl+Shift+V" },
    });
    const group = screen.getByRole("radiogroup", { name: "Markdown preview" });
    expect(group.getAttribute("title")).toBe("Markdown preview (Ctrl+Shift+V)");
    expect(screen.getByRole("radio", { name: "Split" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Preview" }));
    expect(onChange).toHaveBeenCalledWith("only");
    fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
    expect(onChange).toHaveBeenCalledWith("edit");
  });

  it("other Tabs have no preview switch", () => {
    setup();
    expect(
      screen.queryByRole("radiogroup", { name: "Markdown preview" }),
    ).toBeNull();
  });

  it("a Scratchpad shows UTF-8 and the platform ending, not clickable", () => {
    setup();
    expect(screen.getByText("UTF-8").tagName).not.toBe("BUTTON");
    expect(screen.getByText("CRLF").tagName).not.toBe("BUTTON");
    expect(screen.getByText("Ln 3, Col 17")).toBeInTheDocument();
  });

  it("a Canvas shows the Kind label only", () => {
    setup({
      kindLabel: "Canvas",
      showFormat: true,
      notice: "Saved elsewhere",
      file: { format: fmt(), readonly: false },
    });
    expect(screen.getByText("Canvas")).toBeInTheDocument();
    expect(screen.queryByText("Ln 3, Col 17")).toBeNull();
    expect(screen.queryByText("JSON")).toBeNull();
    expect(screen.queryByText("UTF-8")).toBeNull();
    expect(screen.queryByText("LF")).toBeNull();
    expect(screen.queryByText("Format")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // Status messages still show.
    expect(screen.getByText("Saved elsewhere")).toBeInTheDocument();
  });

  it("an Image shows its size, format and file size, read-only", () => {
    setup({
      kindLabel: "Image",
      file: { format: fmt(), readonly: true },
      image: { width: 1920, height: 1080, format: "PNG", bytes: 2_516_582 },
    });
    expect(screen.getByText("1920 × 1080")).toBeInTheDocument();
    expect(screen.getByText("PNG")).toBeInTheDocument();
    expect(screen.getByText("2.4 MB")).toBeInTheDocument();
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByText("Image")).toBeNull();
    expect(screen.queryByText("UTF-8")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("file sizes read naturally", () => {
    expect(fileSize(512)).toBe("512 B");
    expect(fileSize(1536)).toBe("1.5 KB");
    expect(fileSize(10 * 1024 * 1024)).toBe("10 MB");
  });

  it("a File shows its encoding and line ending as menu buttons", () => {
    const p = setup({
      file: { format: fmt({ encoding: "windows-1252" }), readonly: false },
    });
    fireEvent.click(screen.getByRole("button", { name: "Windows-1252" }));
    expect(p.onEncodingMenu).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "LF" }));
    expect(p.onLineEndingMenu).toHaveBeenCalled();
  });

  it("shows CRLF and Mixed", () => {
    setup({
      file: {
        format: fmt({ lineEnding: "crlf", mixed: true }),
        readonly: false,
      },
    });
    expect(screen.getByRole("button", { name: "Mixed" })).toBeInTheDocument();
  });

  it("shows CRLF for a CRLF File", () => {
    setup({
      platformLineEnding: "lf",
      file: { format: fmt({ lineEnding: "crlf" }), readonly: false },
    });
    expect(screen.getByRole("button", { name: "CRLF" })).toBeInTheDocument();
  });

  it("a read-only File shows Read-only in place of Ln, Col", () => {
    setup({ file: { format: fmt(), readonly: true } });
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByText(/Ln 3/)).toBeNull();
  });

  it("the Format chip shows only when showFormat is true", () => {
    setup({ showFormat: false });
    expect(screen.queryByRole("button", { name: /Format/ })).toBeNull();
  });

  it("the Format chip opens Beautify and Minify", () => {
    const p = setup({ showFormat: true });
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Beautify/ }));
    expect(p.onFormat).toHaveBeenCalledWith("beautify");
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Minify/ }));
    expect(p.onFormat).toHaveBeenCalledWith("minify");
  });

  it("dismissing the Format menu hands focus back", () => {
    const onFormatClose = vi.fn();
    setup({ showFormat: true, onFormatClose });
    fireEvent.click(screen.getByRole("button", { name: "Format" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onFormatClose).toHaveBeenCalledTimes(1);
  });

  it("shows the notice", () => {
    setup({ notice: "Open files, not folders" });
    expect(screen.getByText("Open files, not folders")).toBeInTheDocument();
  });
  it("a Markdown Tab's Rich / Markdown switch shows and sets the mode", () => {
    const onChange = vi.fn();
    setup({
      language: "markdown",
      markdownMode: { mode: "markdown", onChange, hint: "Ctrl+Shift+M" },
      preview: { mode: "edit", onChange: vi.fn() },
    });
    const group = screen.getByRole("radiogroup", { name: "Markdown editor" });
    expect(group.getAttribute("title")).toBe("Markdown editor (Ctrl+Shift+M)");
    expect(screen.getByRole("radio", { name: "Markdown" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Rich" }));
    expect(onChange).toHaveBeenCalledWith("rich");
    // Markdown mode keeps the preview switch and the position.
    expect(
      screen.getByRole("radiogroup", { name: "Markdown preview" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ln 3, Col 17")).toBeInTheDocument();
  });

  it("other Tabs have no Rich / Markdown switch", () => {
    setup();
    expect(
      screen.queryByRole("radiogroup", { name: "Markdown editor" }),
    ).toBeNull();
  });

  it("Rich hides the preview switch and the position", () => {
    const onChange = vi.fn();
    setup({
      language: "markdown",
      markdownMode: { mode: "rich", onChange },
      preview: { mode: "edit", onChange: vi.fn() },
    });
    expect(screen.getByRole("radio", { name: "Rich" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.queryByRole("radiogroup", { name: "Markdown preview" }),
    ).toBeNull();
    expect(screen.queryByText(/^Ln /)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Markdown" }));
    expect(onChange).toHaveBeenCalledWith("markdown");
  });
});

describe("StatusBar Ask button", () => {
  it("is absent until Ask is ready", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
  });

  it("toggles the Ask panel and shows whether it's open", () => {
    const onToggle = vi.fn();
    setup({ ask: { open: false, onToggle, hint: "Ctrl+J" } });
    const button = screen.getByRole("button", { name: "Ask" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("title", "Ask (Ctrl+J)");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalled();
  });

  it("stays on a Canvas Tab", () => {
    setup({ kindLabel: "Canvas", ask: { open: true, onToggle: vi.fn() } });
    expect(screen.getByRole("button", { name: "Ask" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
