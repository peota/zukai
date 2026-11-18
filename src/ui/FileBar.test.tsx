import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FileInfo, TabState } from "../model/types";
import { FileBar } from "./FileBar";

function tabWith(held: FileInfo["held"], encoding = "utf-8"): TabState {
  return {
    id: "t",
    kind: "text",
    title: "config.json",
    renamed: false,
    language: "json",
    languagePicked: false,
    languageGuessed: true,
    selection: { anchor: 0, head: 0 },
    scrollTop: 0,
    wrap: false,
    file: {
      path: "C:\\data\\config.json",
      format: { encoding, bom: false, lineEnding: "lf", mixed: false },
      fingerprint: null,
      held,
    },
  };
}

function setup(tab: TabState, unreadable = false) {
  const props = {
    tab,
    unreadable,
    onKeepMine: vi.fn(),
    onLoadDisk: vi.fn(),
    onSaveAs: vi.fn(),
    onSaveToOriginal: vi.fn(),
    onReopenWithEncoding: vi.fn(),
    onConvertToUtf8: vi.fn(),
  };
  const view = render(<FileBar {...props} />);
  return { props, view };
}

describe("FileBar", () => {
  it("renders nothing for a File that isn't held, or a Scratchpad", () => {
    const { view } = setup(tabWith(null));
    expect(view.container).toBeEmptyDOMElement();
    const { file: _f, ...scratch } = tabWith(null);
    void _f;
    view.rerender(
      <FileBar
        tab={scratch}
        onKeepMine={vi.fn()}
        onLoadDisk={vi.fn()}
        onSaveAs={vi.fn()}
        onSaveToOriginal={vi.fn()}
        onReopenWithEncoding={vi.fn()}
        onConvertToUtf8={vi.fn()}
      />,
    );
    expect(view.container).toBeEmptyDOMElement();
  });

  it("conflict: amber bar, Load disk version and Keep mine", () => {
    const { props } = setup(tabWith("conflict"));
    expect(
      screen.getByText(
        "config.json was changed by another program while you were editing. Autosave is paused.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAttribute("data-kind", "warn");
    fireEvent.click(screen.getByRole("button", { name: "Load disk version" }));
    expect(props.onLoadDisk).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(props.onKeepMine).toHaveBeenCalledTimes(1);
  });

  it("missing: red bar, Save as… and Save to original path", () => {
    const { props } = setup(tabWith("missing"));
    expect(
      screen.getByText(
        "config.json was moved or deleted. Your text is still here, and nothing is saved until you choose.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAttribute("data-kind", "err");
    fireEvent.click(screen.getByRole("button", { name: "Save as…" }));
    expect(props.onSaveAs).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Save to original path" }),
    );
    expect(props.onSaveToOriginal).toHaveBeenCalledTimes(1);
  });

  it("unencodable: amber bar naming the encoding, Convert to UTF-8", () => {
    const { props } = setup(tabWith("unencodable", "windows-1252"));
    expect(
      screen.getByText(
        "Can't save: some characters can't be written in Windows-1252.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAttribute("data-kind", "warn");
    fireEvent.click(screen.getByRole("button", { name: "Convert to UTF-8" }));
    expect(props.onConvertToUtf8).toHaveBeenCalledTimes(1);
  });

  it("readonly: info bar, Reopen with encoding…", () => {
    const { props } = setup(tabWith("readonly"));
    expect(
      screen.getByText(
        "This file isn't readable as text, so it's open read-only to protect it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAttribute("data-kind", "info");
    fireEvent.click(
      screen.getByRole("button", { name: "Reopen with encoding…" }),
    );
    expect(props.onReopenWithEncoding).toHaveBeenCalledTimes(1);
  });

  it("an unreadable shadow shows an info bar with no actions", () => {
    setup(tabWith("conflict"), true);
    expect(
      screen.getByText("config.json has unsaved text that can't be read yet."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAttribute("data-kind", "info");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
