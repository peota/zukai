import { fireEvent, render, screen, within } from "@testing-library/react";
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

describe("StatusBar Git button", () => {
  const git = (over: Partial<NonNullable<StatusBarProps["git"]>> = {}) => ({
    branch: "main",
    state: "none" as const,
    open: false,
    dirty: false,
    onToggle: vi.fn(),
    ...over,
  });

  it("shows the branch with an icon and toggles the Git panel on click", () => {
    const g = git();
    setup({ git: g });
    const chip = screen.getByRole("button", { name: /main/ });
    expect(chip.querySelector("svg")).not.toBeNull();
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(g.onToggle).toHaveBeenCalledOnce();
  });

  it("looks pressed while the panel is open", () => {
    setup({ git: git({ open: true }) });
    const chip = screen.getByRole("button", { name: /main/ });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.className).toContain("bg-row-sel");
  });

  it("says Git outside a repo", () => {
    setup({ git: git({ branch: undefined }) });
    const chip = screen.getByRole("button", { name: /^Git/ });
    expect(chip.getAttribute("title")).toBe("Git");
  });

  it("names a rebase or merge in progress", () => {
    setup({ git: git({ branch: "feat", state: "rebasing" }) });
    expect(screen.getByRole("button", { name: /feat/ }).textContent).toContain(
      "rebasing",
    );
    // A rebase isn't an error: the word is in the chip's own ink.
    expect(screen.getByText("rebasing").className).not.toContain("text-danger");
  });

  it("names the branch and the shortcut in its tooltip", () => {
    setup({ git: git({ branch: "feat/long", hint: "Ctrl+Shift+G" }) });
    expect(
      screen.getByRole("button", { name: /feat\/long/ }).getAttribute("title"),
    ).toBe("feat/long: Git (Ctrl+Shift+G)");
  });

  it("carries the amber dot while anything is uncommitted", () => {
    setup({ git: git({ dirty: true }) });
    expect(
      screen.getByRole("img", { name: "Uncommitted changes" }),
    ).toBeTruthy();
  });

  it("has no dot with everything committed", () => {
    setup({ git: git() });
    expect(
      screen.queryByRole("img", { name: "Uncommitted changes" }),
    ).toBeNull();
  });

  it("sits beside Agent, before it", () => {
    setup({
      git: git(),
      agent: { open: false, onOpen: vi.fn(), hint: "Ctrl+J" },
    });
    const g = screen.getByRole("button", { name: /main/ });
    const a = screen.getByRole("button", { name: "Agent" });
    expect(g.parentElement).toBe(a.parentElement);
    expect(
      g.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("is absent without the git prop", () => {
    setup();
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

  describe("a PDF", () => {
    const pdf = {
      page: 12,
      pages: 340,
      zoom: 1.25,
      fitted: false,
      bytes: 4_404_019,
    };
    const pdfProps = (over: Partial<StatusBarProps> = {}) => ({
      kindLabel: "PDF",
      file: { format: fmt(), readonly: true },
      pdf,
      onGoToPage: vi.fn(),
      onZoom: vi.fn(),
      onOpenDefault: vi.fn(),
      ...over,
    });
    const pdfBar = (over: Partial<StatusBarProps> = {}) =>
      setup(pdfProps(over));
    /** Rendered, with `rerender` and its props. */
    const renderBar = (over: Partial<StatusBarProps>) => {
      const props: StatusBarProps = {
        line: 1,
        col: 1,
        language: "plaintext",
        saveStatus: "saved",
        onPickLanguage: vi.fn(),
        platformLineEnding: "lf",
        onEncodingMenu: vi.fn(),
        onLineEndingMenu: vi.fn(),
        showFormat: false,
        onFormat: vi.fn(),
        ...over,
      };
      return { ...render(<StatusBar {...props} />), props };
    };

    it("shows the page, zoom and file size", () => {
      pdfBar();
      expect(screen.getByText("PDF")).toBeInTheDocument();
      expect(screen.getByText("Page 12 / 340")).toBeInTheDocument();
      expect(screen.getByText("125%")).toBeInTheDocument();
      expect(screen.getByText("4.2 MB")).toBeInTheDocument();
    });

    it("clicking the page, typing past the end and Enter goes to the last page", () => {
      const p = pdfBar();
      fireEvent.click(screen.getByText("Page 12 / 340"));
      const input = screen.getByRole("spinbutton", { name: "Go to page" });
      fireEvent.change(input, { target: { value: "999" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(p.onGoToPage).toHaveBeenCalledWith(340);
      expect(screen.getByText("Page 12 / 340")).toBeInTheDocument();
    });

    it("clamps a page below 1", () => {
      const p = pdfBar();
      fireEvent.click(screen.getByText("Page 12 / 340"));
      const input = screen.getByRole("spinbutton", { name: "Go to page" });
      fireEvent.change(input, { target: { value: "0" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(p.onGoToPage).toHaveBeenCalledWith(1);
    });

    it("Esc and blur cancel", () => {
      const p = pdfBar();
      fireEvent.click(screen.getByText("Page 12 / 340"));
      let input = screen.getByRole("spinbutton", { name: "Go to page" });
      fireEvent.change(input, { target: { value: "5" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("spinbutton")).toBeNull();
      fireEvent.click(screen.getByText("Page 12 / 340"));
      input = screen.getByRole("spinbutton", { name: "Go to page" });
      fireEvent.change(input, { target: { value: "5" } });
      fireEvent.blur(input);
      expect(screen.queryByRole("spinbutton")).toBeNull();
      expect(p.onGoToPage).not.toHaveBeenCalled();
    });

    it("the go to page signal opens the input", () => {
      const props: StatusBarProps = {
        line: 1,
        col: 1,
        language: "plaintext",
        saveStatus: "saved",
        onPickLanguage: vi.fn(),
        platformLineEnding: "lf",
        onEncodingMenu: vi.fn(),
        onLineEndingMenu: vi.fn(),
        showFormat: false,
        onFormat: vi.fn(),
        kindLabel: "PDF",
        pdf,
        onGoToPage: vi.fn(),
        pageInputSignal: 0,
      };
      const { rerender } = render(<StatusBar {...props} />);
      expect(screen.queryByRole("spinbutton")).toBeNull();
      rerender(<StatusBar {...props} pageInputSignal={1} />);
      expect(
        screen.getByRole("spinbutton", { name: "Go to page" }),
      ).toBeInTheDocument();
    });

    it("previous and next page buttons go one page back and on", () => {
      const p = pdfBar();
      fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
      expect(p.onGoToPage).toHaveBeenLastCalledWith(11);
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      expect(p.onGoToPage).toHaveBeenLastCalledWith(13);
    });

    it("previous is disabled on the first page, next on the last", () => {
      const { rerender, props } = renderBar({
        ...pdfProps(),
        pdf: { ...pdf, page: 1 },
      });
      expect(
        screen.getByRole("button", { name: "Previous page" }),
      ).toBeDisabled();
      expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
      rerender(<StatusBar {...props} pdf={{ ...pdf, page: 340 }} />);
      expect(
        screen.getByRole("button", { name: "Previous page" }),
      ).toBeEnabled();
      expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    });

    it("zoom out and zoom in step the zoom", () => {
      const onZoom = vi.fn();
      pdfBar({ onZoom });
      fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
      expect(onZoom).toHaveBeenLastCalledWith("out");
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      expect(onZoom).toHaveBeenLastCalledWith("in");
    });

    it("the zoom opens a menu of zooms", () => {
      const onZoom = vi.fn();
      pdfBar({ onZoom });
      const zoom = screen.getByRole("button", { name: "Zoom" });
      expect(zoom).toHaveTextContent("125%");
      fireEvent.click(zoom);
      const menu = screen.getByRole("menu", { name: "Zoom" });
      const items = within(menu).getAllByRole("menuitem");
      expect(items.map((i) => i.textContent)).toEqual([
        "Fit width",
        "50%",
        "75%",
        "100%",
        "125%",
        "150%",
        "200%",
        "300%",
      ]);
      fireEvent.click(within(menu).getByText("200%"));
      expect(onZoom).toHaveBeenLastCalledWith(2);
      expect(screen.queryByRole("menu")).toBeNull();
      fireEvent.click(zoom);
      fireEvent.click(screen.getByText("Fit width"));
      expect(onZoom).toHaveBeenLastCalledWith("fit");
    });

    it("the zoom menu checks the current zoom, or Fit width when fitted", () => {
      const checked = () =>
        screen
          .getAllByRole("menuitem")
          .filter((i) => i.querySelector("svg"))
          .map((i) => i.textContent);
      const { rerender, props } = renderBar(pdfProps());
      fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
      expect(checked()).toEqual(["125%"]);
      rerender(
        <StatusBar {...props} pdf={{ ...pdf, zoom: 1.25, fitted: true }} />,
      );
      expect(checked()).toEqual(["Fit width"]);
      rerender(<StatusBar {...props} pdf={{ ...pdf, zoom: 1.1 }} />);
      expect(checked()).toEqual([]);
    });

    it("Open with default app calls onOpenDefault", () => {
      const p = pdfBar();
      fireEvent.click(screen.getByText("Open with default app"));
      expect(p.onOpenDefault).toHaveBeenCalled();
    });
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

describe("StatusBar Agent button", () => {
  it("opens the agent menu from its own box", () => {
    const onOpen = vi.fn();
    setup({ agent: { open: false, onOpen, hint: "Ctrl+J" } });
    const button = screen.getByRole("button", { name: "Agent" });
    expect(button).toHaveAttribute("title", "Agent (Ctrl+J)");
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("data-z-agent-menu");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ right: expect.any(Number) }),
    );
  });

  it("shows it's open, on a Canvas Tab too", () => {
    setup({
      kindLabel: "Canvas",
      agent: { open: true, onOpen: vi.fn(), hint: "Ctrl+J" },
    });
    expect(screen.getByRole("button", { name: "Agent" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
