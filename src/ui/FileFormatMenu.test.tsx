import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FileFormat } from "../model/types";
import { FileFormatMenu, type FileFormatMenuProps } from "./FileFormatMenu";
import { EncodingPicker } from "./EncodingPicker";

const FMT: FileFormat = {
  encoding: "windows-1252",
  bom: false,
  lineEnding: "crlf",
  mixed: false,
};

function setup(over: Partial<FileFormatMenuProps> = {}) {
  const props: FileFormatMenuProps = {
    kind: "encoding",
    anchor: new DOMRect(500, 580, 80, 20),
    format: FMT,
    pending: false,
    readonly: false,
    unreadable: false,
    onReopenWithEncoding: vi.fn(),
    onConvertTo: vi.fn(),
    onConvert: vi.fn(),
    onDismiss: vi.fn(),
    ...over,
  };
  render(<FileFormatMenu {...props} />);
  return props;
}

const item = (name: RegExp | string) => screen.getByRole("menuitem", { name });

describe("FileFormatMenu", () => {
  it("encoding: reopen, convert to UTF-8 (with BOM) and Convert to…", () => {
    const p = setup();
    fireEvent.click(item(/^Convert to UTF-8$/));
    expect(p.onConvert).toHaveBeenCalledWith({ encoding: "utf-8", bom: false });
    fireEvent.click(item(/UTF-8 with BOM/));
    expect(p.onConvert).toHaveBeenCalledWith({ encoding: "utf-8", bom: true });
    fireEvent.click(item(/^Convert to…/));
    expect(p.onConvertTo).toHaveBeenCalled();
    fireEvent.click(item(/^Reopen with encoding…/));
    expect(p.onReopenWithEncoding).toHaveBeenCalled();
  });

  it("Reopen is disabled, with a reason, while there are pending edits", () => {
    const p = setup({ pending: true });
    const reopen = item(/^Reopen with encoding…/);
    expect(reopen).toHaveAttribute("aria-disabled", "true");
    expect(reopen).toHaveTextContent("Not while there are unsaved edits");
    fireEvent.click(reopen);
    expect(p.onReopenWithEncoding).not.toHaveBeenCalled();
  });

  it("an unreadable shadow disables everything", () => {
    setup({ unreadable: true });
    for (const el of screen.getAllByRole("menuitem")) {
      expect(el).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("line ending: converts and marks the current one", () => {
    const p = setup({ kind: "lineEnding" });
    expect(item(/Convert to CRLF/)).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item(/Convert to LF/));
    expect(p.onConvert).toHaveBeenCalledWith({
      lineEnding: "lf",
      mixed: false,
    });
  });

  it("a Mixed File can convert to either ending", () => {
    setup({ kind: "lineEnding", format: { ...FMT, mixed: true } });
    expect(item(/Convert to CRLF/)).not.toHaveAttribute("aria-disabled");
  });
});

describe("EncodingPicker", () => {
  it("filters the list and picks with Enter", () => {
    const onPick = vi.fn();
    render(
      <EncodingPicker
        title="Reopen with encoding"
        current="utf-8"
        onPick={onPick}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "1251" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("windows-1251");
  });
});

describe("EncodingPicker closing", () => {
  it("closes when the window loses focus", () => {
    const onClose = vi.fn();
    render(
      <EncodingPicker
        title="Convert to"
        current="utf-8"
        onPick={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.blur(window);
    expect(onClose).toHaveBeenCalled();
  });
});
