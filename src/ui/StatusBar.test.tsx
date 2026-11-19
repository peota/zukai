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
    expect(screen.queryByText("{ } Format")).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "{ } Format" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Beautify/ }));
    expect(p.onFormat).toHaveBeenCalledWith("beautify");
    fireEvent.click(screen.getByRole("button", { name: "{ } Format" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Minify/ }));
    expect(p.onFormat).toHaveBeenCalledWith("minify");
  });

  it("dismissing the Format menu hands focus back", () => {
    const onFormatClose = vi.fn();
    setup({ showFormat: true, onFormatClose });
    fireEvent.click(screen.getByRole("button", { name: "{ } Format" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onFormatClose).toHaveBeenCalledTimes(1);
  });

  it("shows the notice", () => {
    setup({ notice: "Open files, not folders" });
    expect(screen.getByText("Open files, not folders")).toBeInTheDocument();
  });
});
