import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storage from "./storage/api";
import * as files from "./files/api";
import * as lib from "./library/api";
import App from "./App";
import { toSessionFile } from "./model/session";
import { newTabState } from "./model/workspace";
import type { EditorHostProps } from "./editor/EditorHost";
import type { CanvasHostProps } from "./canvas/CanvasHost";
import type { SplitOrientation } from "./model/types";

const h = vi.hoisted(() => ({
  flushAll: null as null | (() => Promise<void>),
  /** The text the mocked editor host's bridge holds, by Tab id. */
  texts: {} as Record<string, string>,
  clearHistory: [] as string[],
  /** Each text the rich editor wrote through the bridge, by Tab id. */
  replaced: [] as [string, string][],
}));

vi.mock("./app/shortcuts", async (orig) => ({
  ...(await orig<typeof import("./app/shortcuts")>()),
  detectPlatform: () => "windows",
}));

// The editor itself has its own tests; here only the layout around it: a
// shown Tab's view sits in the slot App gives it.
vi.mock("./editor/EditorHost", async () => {
  const { createPortal } = await import("react-dom");
  const { useLayoutEffect, useState } = await import("react");
  return {
    EditorHost: (p: EditorHostProps) => {
      // A bridge over h.texts, for the rich editor.
      const [bridge] = useState(() => ({
        text: (id: string) => h.texts[id] ?? null,
        replace: (id: string, text: string) => {
          h.replaced.push([id, text]);
          h.texts[id] = text;
        },
        onOutsideChange: () => () => {},
        clearHistory: (id: string) => void h.clearHistory.push(id),
        readOnly: () => false,
        ready: async () => {},
      }));
      const { bridgeRef } = p;
      useLayoutEffect(() => {
        bridgeRef?.(bridge);
        return () => bridgeRef?.(null);
      }, [bridgeRef, bridge]);
      const ids = new Set(p.shown ?? []);
      if (p.activeId) ids.add(p.activeId);
      return [...ids].map((id) => {
        const slot = p.slots?.get(id);
        return slot
          ? createPortal(<div data-testid="editor" data-id={id} />, slot, id)
          : null;
      });
    },
  };
});

vi.mock("./canvas/CanvasHost", () => ({
  CanvasHost: (p: CanvasHostProps) =>
    p.tabs.find((t) => t.id === p.activeId)?.kind === "canvas" ? (
      <div data-testid="canvas" data-id={p.activeId} />
    ) : null,
}));

vi.mock("./storage/api", () => ({
  readScratchpad: vi.fn(),
  writeScratchpad: vi.fn(),
  deleteScratchpad: vi.fn(),
  closeScratchpad: vi.fn(),
  reopenScratchpad: vi.fn(),
  listScratchpads: vi.fn(),
  listClosedScratchpads: vi.fn(),
  purgeClosed: vi.fn(),
  readSession: vi.fn(),
  writeSession: vi.fn(),
  backupSession: vi.fn(),
  startupMark: vi.fn(),
}));

vi.mock("./files/api", async (orig) => ({
  ...(await orig<typeof import("./files/api")>()),
  shadowList: async () => [],
  fileWatch: async () => {},
  takeLaunchPaths: async () => ({ paths: [], folders: [], missing: [] }),
  grantsFilter: async (paths: string[]) => paths,
  onFileChanged: async () => () => {},
  onOpenPaths: async () => () => {},
  fileRead: vi.fn(),
  fileFingerprint: vi.fn(),
  fileFingerprintQuick: vi.fn(),
  fileChangeExtension: vi.fn(),
}));

vi.mock("./library/api", () => ({
  libraryRoot: vi.fn(),
  libraryUseDefault: vi.fn(),
  libraryChoose: vi.fn(),
  libraryRecreate: vi.fn(),
  libraryList: vi.fn(),
  libraryCreateFolder: vi.fn(),
  libraryCreateFile: vi.fn(),
  libraryRename: vi.fn(),
  libraryMove: vi.fn(),
  libraryCopyInto: vi.fn(),
  libraryTrash: vi.fn(),
  libraryReveal: vi.fn(),
  librarySearch: vi.fn(),
  libraryWatch: vi.fn(),
  libraryReserve: vi.fn(),
  libraryFollow: vi.fn(),
  librarySetDropTarget: vi.fn(),
  libraryResync: vi.fn(),
  onLibraryChanged: vi.fn(),
  onLibraryDropped: vi.fn(),
  onDragDrop: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: () => Promise.resolve(),
    setTitle: () => Promise.resolve(),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));

vi.mock("./app/exit", () => ({
  BEFORE_EXIT_EVENT: "zukai://before-exit",
  installExitHandshake: async (flushAll: () => Promise<void>) => {
    h.flushAll = flushAll;
    return () => {};
  },
}));

const s = vi.mocked(storage);
const f = vi.mocked(files);
const l = vi.mocked(lib);

const R = "C:\\L";

beforeEach(() => {
  vi.resetAllMocks();
  h.texts = {};
  h.clearHistory = [];
  h.replaced = [];
  Element.prototype.scrollIntoView = vi.fn();
  s.listScratchpads.mockResolvedValue([{ id: "a", ext: "txt" }]);
  s.listClosedScratchpads.mockResolvedValue([]);
  s.readSession.mockResolvedValue(null);
  s.readScratchpad.mockResolvedValue("alpha");
  s.writeScratchpad.mockResolvedValue(undefined);
  s.writeSession.mockResolvedValue(undefined);
  s.backupSession.mockResolvedValue(undefined);
  s.startupMark.mockResolvedValue(undefined);
  s.purgeClosed.mockResolvedValue(undefined);
  l.libraryRoot.mockResolvedValue({ root: R, available: true, added: [] });
  l.libraryWatch.mockResolvedValue(undefined);
  l.libraryResync.mockResolvedValue(false);
  l.librarySetDropTarget.mockResolvedValue(undefined);
  l.libraryList.mockResolvedValue([
    { name: "proj", path: `${R}\\proj`, isDir: true, link: null },
  ]);
  l.onLibraryChanged.mockResolvedValue(() => {});
  l.onLibraryDropped.mockResolvedValue(() => {});
  l.onDragDrop.mockResolvedValue(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await h.flushAll?.().catch(() => {});
  h.flushAll = null;
});

const modB = () =>
  fireEvent.keyDown(window, { key: "b", code: "KeyB", ctrlKey: true });

describe("App", () => {
  it("modBTogglesSidebarAndHiddenLayoutUnchanged", async () => {
    const { container, getByTestId } = render(<App />);
    await waitFor(() => getByTestId("editor"));
    const root = container.firstElementChild as HTMLElement;
    const workspace = root.querySelector<HTMLElement>("[data-z-workspace]")!;

    // Hidden: nothing of the sidebar is rendered, the workspace column is
    // the whole window, as before the Library.
    const hidden = () => {
      expect(root.querySelector("[data-z-sidebar]")).toBeNull();
      expect([...root.children]).toEqual([workspace]);
      expect(workspace.className).toContain("flex-1");
      expect(workspace.firstElementChild?.getAttribute("role")).toBe("tablist");
    };
    hidden();

    act(() => modB());
    const side = await waitFor(() => {
      const el = root.querySelector<HTMLElement>("[data-z-sidebar]");
      expect(el).not.toBeNull();
      return el!;
    });
    // Left of the tab bar and editor, at its default width.
    expect(root.firstElementChild).toBe(side);
    expect(side.nextElementSibling).toBe(workspace);
    expect(side.style.width).toBe("240px");
    await waitFor(() => expect(l.libraryList).toHaveBeenCalledWith(R));

    act(() => modB());
    hidden();
    // The same workspace column: the editor was never remounted.
    expect(root.querySelector("[data-z-workspace]")).toBe(workspace);
  });

  it("Mod+Shift+E opens the sidebar and focuses it", async () => {
    const { container, getByTestId } = render(<App />);
    await waitFor(() => getByTestId("editor"));
    act(() => {
      fireEvent.keyDown(window, {
        key: "E",
        code: "KeyE",
        ctrlKey: true,
        shiftKey: true,
      });
    });
    await waitFor(() => {
      const side = container.querySelector("[data-z-sidebar]");
      expect(side).not.toBeNull();
      expect(side!.contains(document.activeElement)).toBe(true);
    });
  });

  it("a Language that doesn't match the File offers its rename", async () => {
    const path = `${R}\\note.md`;
    const fmt = {
      encoding: "utf-8",
      bom: false,
      lineEnding: "lf",
      mixed: false,
    } as const;
    const print = { mtimeMs: 1, size: 2, hash: "h" };
    s.readSession.mockResolvedValue(
      JSON.stringify(
        toSessionFile({
          tabs: [
            {
              ...newTabState("n"),
              title: "note.md",
              language: "markdown",
              languageGuessed: true,
              file: { path, format: fmt, fingerprint: print, held: null },
            },
          ],
          activeId: "n",
          closed: [],
        }),
      ),
    );
    f.fileRead.mockResolvedValue({
      text: "# hi",
      format: fmt,
      readable: true,
      fingerprint: print,
    });
    f.fileFingerprint.mockResolvedValue(print);
    f.fileFingerprintQuick.mockResolvedValue(print);
    f.fileChangeExtension.mockResolvedValue(`${R}\\note.ts`);

    const r = render(<App />);
    await waitFor(() => r.getByTestId("editor"));
    const button = await waitFor(() => {
      const b = r.container.querySelector<HTMLElement>(
        "[data-language-button]",
      );
      expect(b?.textContent).toContain("Markdown");
      return b!;
    });

    // Matching the extension: no offer, and a pick closes the list.
    fireEvent.click(button);
    expect(r.queryByText(/Rename/)).toBeNull();
    fireEvent.mouseDown(r.getByRole("option", { name: "Markdown" }));
    expect(r.queryByRole("dialog", { name: "Language" })).toBeNull();

    // TypeScript on a .md: the list stays open on the rename.
    fireEvent.click(button);
    fireEvent.mouseDown(r.getByRole("option", { name: "TypeScript" }));
    const offer = r.getByRole("option", { name: "Rename note.md → note.ts" });
    expect(offer.getAttribute("aria-selected")).toBe("true");
    fireEvent.mouseDown(offer);
    await waitFor(() =>
      expect(f.fileChangeExtension).toHaveBeenCalledWith(path, "ts"),
    );
    expect(r.queryByRole("dialog", { name: "Language" })).toBeNull();
    await waitFor(() =>
      expect(r.getAllByText("note.ts").length).toBeGreaterThan(0),
    );
  });

  it("Ctrl+, opens Settings; its Theme drives the page; Esc closes it", async () => {
    const r = render(<App />);
    await waitFor(() => r.getByTestId("editor"));
    act(() => {
      fireEvent.keyDown(window, { key: ",", code: "Comma", ctrlKey: true });
    });
    const dialog = r.getByRole("dialog", { name: "Settings" });
    fireEvent.click(r.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(r.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(r.queryByRole("dialog", { name: "Settings" })).toBeNull();
    // The status bar gear opens it too.
    fireEvent.click(r.getByRole("button", { name: "Settings" }));
    expect(r.getByRole("dialog", { name: "Settings" })).toBeTruthy();
  });

  it("Close all tabs closes every unpinned Tab and leaves one fresh Tab", async () => {
    s.listScratchpads.mockResolvedValue([
      { id: "a", ext: "txt" },
      { id: "b", ext: "txt" },
    ]);
    s.closeScratchpad.mockResolvedValue(undefined);
    s.deleteScratchpad.mockResolvedValue(undefined);
    const r = render(<App />);
    await waitFor(() => expect(r.getAllByRole("tab")).toHaveLength(2));
    fireEvent.contextMenu(r.getAllByRole("tab")[0]);
    fireEvent.click(r.getByRole("menuitem", { name: "Close all tabs" }));
    await waitFor(() => {
      const tabs = r.getAllByRole("tab");
      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toHaveTextContent("Untitled");
    });
    expect(s.closeScratchpad).toHaveBeenCalledWith("a");
  });

  it("Ctrl+Shift+V shows a Markdown Tab's preview beside it, then alone", async () => {
    s.readScratchpad.mockResolvedValue("# Hello");
    s.readSession.mockResolvedValue(
      JSON.stringify(
        toSessionFile({
          tabs: [
            {
              ...newTabState("a"),
              title: "Hello",
              language: "markdown",
              languagePicked: true,
              markdownMode: "markdown",
            },
          ],
          activeId: "a",
          closed: [],
        }),
      ),
    );
    const r = render(<App />);
    await waitFor(() => r.getByTestId("editor"));
    const v = () =>
      fireEvent.keyDown(window, {
        key: "V",
        code: "KeyV",
        ctrlKey: true,
        shiftKey: true,
      });
    act(() => v());
    const preview = await r.findByRole("article", { name: "Markdown preview" });
    await waitFor(() =>
      expect(preview.querySelector("h1")?.textContent).toBe("Hello"),
    );
    // Split: the editor is still shown.
    expect(r.getByTestId("editor").closest(".hidden")).toBeNull();
    expect(r.getByRole("radio", { name: "Split" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    act(() => v());
    expect(r.getByTestId("editor").closest(".hidden")).not.toBeNull();
    act(() => v());
    expect(r.queryByRole("article", { name: "Markdown preview" })).toBeNull();
    // Back in Split, the divider resizes the editor's share.
    act(() => v());
    const handle = r.getByRole("separator", { name: "Resize preview" });
    const editorPane = () =>
      r.getByTestId("editor").parentElement as HTMLElement;
    expect(editorPane().style.flexBasis).toBe("50%");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(editorPane().style.flexBasis).toBe("45%");
    expect(handle).toHaveAttribute("aria-valuenow", "45");
    act(() => v());
    act(() => v());
    // The status bar switch does the same.
    fireEvent.click(r.getByRole("radio", { name: "Preview" }));
    expect(
      r.getByRole("article", { name: "Markdown preview" }),
    ).toBeInTheDocument();
  });
  it("a picked Markdown note opens in Rich, and the switch and keys work", async () => {
    s.readScratchpad.mockResolvedValue("# Hello");
    h.texts.a = "# Hello";
    s.readSession.mockResolvedValue(
      JSON.stringify(
        toSessionFile({
          tabs: [
            {
              ...newTabState("a"),
              title: "Hello",
              language: "markdown",
              languagePicked: true,
            },
          ],
          activeId: "a",
          closed: [],
        }),
      ),
    );
    const r = render(<App />);
    const rich = await waitFor(
      () => {
        const el = r.container.querySelector<HTMLElement>(".ProseMirror");
        expect(el?.textContent).toBe("Hello");
        return el!;
      },
      { timeout: 5000 },
    );
    // The plain editor's slot is hidden; there's no preview switch.
    expect(r.getByTestId("editor").closest(".hidden")).not.toBeNull();
    expect(r.getByRole("radio", { name: "Rich" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      r.queryByRole("radiogroup", { name: "Markdown preview" }),
    ).toBeNull();

    // Mod+B in the rich editor is bold there, not the sidebar.
    const root = r.container.firstElementChild as HTMLElement;
    act(() => {
      fireEvent.keyDown(rich, { key: "b", code: "KeyB", ctrlKey: true });
    });
    expect(root.querySelector("[data-z-sidebar]")).toBeNull();

    // Ctrl+Shift+M: back to the Markdown source, with a fresh undo.
    act(() => {
      fireEvent.keyDown(rich, {
        key: "M",
        code: "KeyM",
        ctrlKey: true,
        shiftKey: true,
      });
    });
    await waitFor(() =>
      expect(r.getByRole("radio", { name: "Markdown" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    expect(h.clearHistory).toEqual(["a"]);
    expect(r.getByTestId("editor").closest(".hidden")).toBeNull();
    expect(r.container.querySelector(".ProseMirror")).toBeNull();
    expect(
      r.getByRole("radiogroup", { name: "Markdown preview" }),
    ).toBeInTheDocument();

    // The status bar switch goes back to Rich; Ctrl+F leaves it for find.
    fireEvent.click(r.getByRole("radio", { name: "Rich" }));
    await waitFor(
      () => expect(r.container.querySelector(".ProseMirror")).not.toBeNull(),
      { timeout: 5000 },
    );
    act(() => {
      fireEvent.keyDown(window, { key: "f", code: "KeyF", ctrlKey: true });
    });
    await waitFor(() =>
      expect(r.getByRole("radio", { name: "Markdown" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    // Nothing was written: the note is as it was.
    expect(h.texts.a).toBe("# Hello");
    expect(s.writeScratchpad).not.toHaveBeenCalled();
  });

  it("an edit in Rich reaches Markdown when switched within the debounce, and switching back keeps it", async () => {
    s.readScratchpad.mockResolvedValue("# Hello\n\n- a\n");
    h.texts.a = "# Hello\n\n- a\n";
    s.readSession.mockResolvedValue(
      JSON.stringify(
        toSessionFile({
          tabs: [
            {
              ...newTabState("a"),
              title: "Hello",
              language: "markdown",
              languagePicked: true,
            },
          ],
          activeId: "a",
          closed: [],
        }),
      ),
    );
    const r = render(<App />);
    const rich = await waitFor(
      () => {
        const el = r.container.querySelector<HTMLElement>(".ProseMirror");
        expect(el?.textContent).toBe("Helloa");
        return el!;
      },
      { timeout: 5000 },
    );
    // An edit (the cursor is in the heading), then Ctrl+Shift+M at once:
    // well within the debounce, nothing written yet.
    fireEvent.click(r.getByRole("button", { name: "Heading 2" }));
    expect(h.replaced).toEqual([]);
    act(() => {
      fireEvent.keyDown(rich, {
        key: "M",
        code: "KeyM",
        ctrlKey: true,
        shiftKey: true,
      });
    });
    await waitFor(() =>
      expect(r.getByRole("radio", { name: "Markdown" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    // The plain editor's text has the edit.
    expect(h.texts.a).toBe("## Hello\n\n- a\n");
    expect(h.replaced).toEqual([["a", "## Hello\n\n- a\n"]]);
    expect(r.container.querySelector(".ProseMirror")).toBeNull();

    // Back to Rich: shown as it is, and nothing more is written.
    act(() => {
      fireEvent.keyDown(window, {
        key: "M",
        code: "KeyM",
        ctrlKey: true,
        shiftKey: true,
      });
    });
    await waitFor(
      () => {
        const h2 = r.container.querySelector(".ProseMirror h2");
        expect(h2?.textContent).toBe("Hello");
      },
      { timeout: 5000 },
    );
    await act(() => new Promise((done) => setTimeout(done, 450)));
    expect(h.texts.a).toBe("## Hello\n\n- a\n");
    expect(h.replaced).toHaveLength(1);
  });

  /** A Session with a text Tab "t" and a canvas "c" in one Split. */
  const splitSession = (orientation: SplitOrientation = "row") => {
    s.listScratchpads.mockResolvedValue([
      { id: "t", ext: "txt" },
      { id: "c", ext: "excalidraw" },
    ]);
    s.readSession.mockResolvedValue(
      JSON.stringify(
        toSessionFile({
          tabs: [
            { ...newTabState("t"), title: "notes" },
            { ...newTabState("c", "canvas"), title: "drawing" },
          ],
          activeId: "t",
          closed: [],
          splits: [{ a: "t", b: "c", orientation, ratio: 0.5, focus: "a" }],
        }),
      ),
    );
  };

  it("aCanvasBesideText", async () => {
    splitSession();
    const r = render(<App />);
    const editor = await waitFor(() => r.getByTestId("editor"));
    const canvas = r.getByTestId("canvas");
    expect(editor).toHaveAttribute("data-id", "t");
    expect(canvas).toHaveAttribute("data-id", "c");
    expect(editor.closest(".hidden")).toBeNull();
    const halves = r.container.querySelectorAll("[data-split-view] > div");
    expect(halves[0]).toHaveAttribute("data-focused");
    expect(r.queryByText("Canvas")).toBeNull();

    fireEvent.pointerDown(canvas);
    await waitFor(() => expect(r.getByText("Canvas")).toBeInTheDocument());
    // The text half stays shown beside it, and the focus line moves.
    expect(r.getByTestId("editor")).toHaveAttribute("data-id", "t");
    expect(halves[0]).not.toHaveAttribute("data-focused");
    expect(halves[2]).toHaveAttribute("data-focused");
  });

  it("keyboardFocusIntoTheOtherHalfActivatesIt", async () => {
    splitSession();
    const r = render(<App />);
    const canvas = await waitFor(() => r.getByTestId("canvas"));
    const halves = r.container.querySelectorAll("[data-split-view] > div");
    expect(halves[0]).toHaveAttribute("data-focused");
    const inner = document.createElement("button");
    canvas.parentElement!.appendChild(inner);
    act(() => inner.focus());
    await waitFor(() => expect(halves[2]).toHaveAttribute("data-focused"));
    expect(halves[0]).not.toHaveAttribute("data-focused");
  });

  it("topAndBottom", async () => {
    splitSession("column");
    const r = render(<App />);
    await waitFor(() => r.getByTestId("canvas"));
    const view = r.container.querySelector<HTMLElement>("[data-split-view]")!;
    expect(view.className).toContain("flex-col");
    expect(view.className).not.toContain("flex-row");
  });

  it("splitWithFromTheMenu", async () => {
    s.listScratchpads.mockResolvedValue([
      { id: "t", ext: "txt" },
      { id: "u", ext: "txt" },
    ]);
    s.readSession.mockResolvedValue(
      JSON.stringify(
        toSessionFile({
          tabs: [
            { ...newTabState("t"), title: "alpha" },
            { ...newTabState("u"), title: "beta" },
          ],
          activeId: "t",
          closed: [],
        }),
      ),
    );
    const r = render(<App />);
    await waitFor(() => expect(r.getAllByRole("tab")).toHaveLength(2));
    fireEvent.contextMenu(r.getAllByRole("tab")[0]);
    fireEvent.click(r.getByRole("menuitem", { name: /Split with/ }));
    fireEvent.click(r.getByRole("menuitem", { name: "beta" }));
    await waitFor(() => expect(r.getAllByRole("tab")).toHaveLength(1));
    expect(r.getByRole("tab", { name: "alpha | beta" })).toBeTruthy();
    await waitFor(() => expect(r.getAllByTestId("editor")).toHaveLength(2));
  });

  it("dropOnTheRightEdgeSplits", async () => {
    s.listScratchpads.mockResolvedValue([
      { id: "a", ext: "txt" },
      { id: "b", ext: "txt" },
    ]);
    s.readSession.mockResolvedValue(
      JSON.stringify(
        toSessionFile({
          tabs: [
            { ...newTabState("a"), title: "alpha" },
            { ...newTabState("b"), title: "beta" },
          ],
          activeId: "a",
          closed: [],
        }),
      ),
    );
    const r = render(<App />);
    await waitFor(() => expect(r.getAllByRole("tab")).toHaveLength(2));
    const main = r.container.querySelector("main")!;
    main.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 100,
        right: 900,
        bottom: 700,
        width: 900,
        height: 600,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    const beta = r.getByText("beta").closest("[role=tab]")!;
    const move = (x: number, y: number) =>
      fireEvent.pointerMove(beta, {
        pointerId: 1,
        buttons: 1,
        clientX: x,
        clientY: y,
      });
    // A drop in the middle does nothing.
    fireEvent.pointerDown(beta, { button: 0, pointerId: 1, clientX: 100 });
    move(110, 400);
    expect(main.querySelector("[data-split-drop]")).toBeNull();
    fireEvent.pointerUp(beta, { pointerId: 1, clientX: 450, clientY: 400 });
    expect(r.getAllByRole("tab")).toHaveLength(2);
    // The right third shows the zone; Esc clears it.
    fireEvent.pointerDown(beta, { button: 0, pointerId: 1, clientX: 100 });
    move(800, 400);
    expect(main.querySelector("[data-split-drop=row]")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(main.querySelector("[data-split-drop]")).toBeNull();
    fireEvent.pointerUp(beta, { pointerId: 1, clientX: 800, clientY: 400 });
    expect(r.getAllByRole("tab")).toHaveLength(2);
    // Dropping there splits: a first, b second.
    fireEvent.pointerDown(beta, { button: 0, pointerId: 1, clientX: 100 });
    move(800, 400);
    fireEvent.pointerUp(beta, { pointerId: 1, clientX: 800, clientY: 400 });
    await waitFor(() => expect(r.getAllByRole("tab")).toHaveLength(1));
    expect(r.getByRole("tab", { name: "alpha | beta" })).toBeTruthy();
    expect(main.querySelector("[data-split-drop]")).toBeNull();
    await waitFor(() => expect(r.getAllByTestId("editor")).toHaveLength(2));
    expect(r.getAllByTestId("editor")[1]).toHaveAttribute("data-id", "b");
  });
});
