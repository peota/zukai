import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FileFormat } from "../model/types";
import { StatusBar, type StatusBarProps } from "./StatusBar";
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
  it("a Scratchpad shows UTF-8 and the platform ending, not clickable", () => {
    setup();
    expect(screen.getByText("UTF-8").tagName).not.toBe("BUTTON");
    expect(screen.getByText("CRLF").tagName).not.toBe("BUTTON");
    expect(screen.getByText("Ln 3, Col 17")).toBeInTheDocument();
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
