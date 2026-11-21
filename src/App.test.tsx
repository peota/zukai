import {
  act,
  fireEvent,
  getByRole,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storage from "./storage/api";
import * as files from "./files/api";
import * as lib from "./library/api";
import * as term from "./terminal/api";
import * as ask from "./ask/api";
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
        hidden: () => [],
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

vi.mock("./ask/api", () => ({
  aiStatus: vi.fn(() =>
    Promise.resolve({ config: null, hasKey: false, ready: false }),
  ),
  aiAsk: vi.fn(),
  aiCancel: vi.fn(),
  aiKeyRemove: vi.fn(),
  aiKeySet: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: () => Promise.resolve(),
    setTitle: () => Promise.resolve(),
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));

vi.mock("./terminal/api", () => ({
  terminalOpen: vi.fn(),
  terminalWrite: vi.fn(),
  terminalAck: vi.fn(),
  terminalResize: vi.fn(),
  terminalKill: vi.fn(),
}));

// The panel itself has its own tests; here only where App puts it.
vi.mock("./terminal/TerminalPanel", () => ({
  TerminalPanel: (p: { position: string; size: number; onNew(): void }) => (
    <div
      data-testid="terminal-panel"
      data-position={p.position}
      data-size={p.size}
    >
      <button onClick={p.onNew}>New terminal</button>
    </div>
  ),
}));

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
const tm = vi.mocked(term);

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
  tm.terminalOpen.mockResolvedValue(1);
  tm.terminalKill.mockResolvedValue(undefined);
  tm.terminalResize.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await h.flushAll?.().catch(() => {});
  h.flushAll = null;
});

const toggleTerminal = () =>
  fireEvent.keyDown(window, { key: "`", code: "Backquote", ctrlKey: true });
const newTerminal = () =>
  fireEvent.keyDown(window, {
    key: "~",
    code: "Backquote",
    ctrlKey: true,
    shiftKey: true,
  });
const modJ = () =>
  fireEvent.keyDown(window, { key: "j", code: "KeyJ", ctrlKey: true });
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
      // The title bar row leads: the sidebar toggle, the tabs, then the
      // window controls.
      const titleBar = workspace.firstElementChild!;
      expect(titleBar.hasAttribute("data-tauri-drag-region")).toBe(true);
      const toggle = titleBar.firstElementChild!.querySelector("button")!;
      expect(toggle.getAttribute("aria-label")).toBe("Show sidebar");
      expect(
        titleBar.firstElementChild?.nextElementSibling?.getAttribute("role"),
      ).toBe("tablist");
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
    expect(side.style.width).toBe("260px");
    await waitFor(() => expect(l.libraryList).toHaveBeenCalledWith(R));
    const hide = getByRole(root, "button", { name: "Hide sidebar" });
    expect(hide).toHaveAttribute("aria-expanded", "true");

    // The title bar button hides it, as Mod+B does.
    fireEvent.click(hide);
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

  it("appIgnoresShellKeysInsideTerminal", async () => {
    const r = render(<App />);
    await waitFor(() => r.getByTestId("editor"));
    const host = document.createElement("div");
    host.setAttribute("data-z-terminal", "");
    const ta = document.createElement("textarea");
    host.append(ta);
    document.body.append(host);
    ta.focus();
    act(() => {
      fireEvent.keyDown(ta, { key: "p", code: "KeyP", ctrlKey: true });
    });
    expect(r.queryByRole("dialog", { name: "Quick open" })).toBeNull();
    act(() => {
      fireEvent.keyDown(ta, { key: ",", code: "Comma", ctrlKey: true });
    });
    expect(r.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    host.remove();
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

  it("Mod+J does nothing until an AI provider is ready", async () => {
    const r = render(<App />);
    await waitFor(() => r.getByTestId("editor"));
    await waitFor(() => expect(ask.aiStatus).toHaveBeenCalled());
    await act(async () => {});
    act(() => modJ());
    await act(async () => {});
    expect(r.queryByRole("region", { name: "Ask" })).toBeNull();
    expect(r.container.querySelector('[aria-label="Ask"]')).toBeNull();
    expect(r.queryByLabelText("Ask")).toBeNull();
  });

  it("Mod+J shows and hides the Ask panel, right of the editor and terminal", async () => {
    vi.mocked(ask.aiStatus).mockResolvedValueOnce({
      config: { provider: "anthropic", model: "claude-sonnet-5-5" },
      hasKey: true,
      ready: true,
    });
    const r = render(<App />);
    await waitFor(() => r.getByTestId("editor"));
    await act(async () => {});
    act(() => modJ());
    const panel = await r.findByRole("region", { name: "Ask" });
    // The editor and the terminal share a column; Ask sits beside it.
    const main = r.container.querySelector("main")!;
    const row = main.parentElement!.parentElement!;
    expect(panel.parentElement).toBe(row);
    expect(row.lastElementChild).toBe(panel);
    expect(row.className).toContain("flex-row");
    act(() => modJ());
    await waitFor(() =>
      expect(r.queryByRole("region", { name: "Ask" })).toBeNull(),
    );
  });

  for (const how of ["Mod+J", "the close button"]) {
    it(`hiding the Ask panel with ${how} stops a running answer`, async () => {
      vi.mocked(ask.aiStatus).mockResolvedValueOnce({
        config: { provider: "anthropic", model: "claude-sonnet-5-5" },
        hasKey: true,
        ready: true,
      });
      // The answer never ends on its own.
      vi.mocked(ask.aiAsk).mockReturnValue(new Promise(() => {}));
      vi.mocked(ask.aiCancel).mockResolvedValue(undefined);
      h.texts.a = "alpha";
      const r = render(<App />);
      await waitFor(() => r.getByTestId("editor"));
      await act(async () => {});
      act(() => modJ());
      const question = await r.findByLabelText("Question");
      fireEvent.change(question, { target: { value: "What is this?" } });
      fireEvent.keyDown(question, { key: "Enter" });
      await waitFor(() => expect(ask.aiAsk).toHaveBeenCalled());
      const id = vi.mocked(ask.aiAsk).mock.calls[0][0];
      expect(ask.aiCancel).not.toHaveBeenCalled();
      if (how === "Mod+J") act(() => modJ());
      else fireEvent.click(r.getByRole("button", { name: "Close Ask panel" }));
      await waitFor(() =>
        expect(r.queryByRole("region", { name: "Ask" })).toBeNull(),
      );
      expect(ask.aiCancel).toHaveBeenCalledWith(id);
      // The question stays in the conversation when the panel comes back.
      act(() => modJ());
      expect(await r.findByText("What is this?")).toBeInTheDocument();
    });
  }

  it("removing the key closes the Ask panel, and a new key doesn't reopen it", async () => {
    const ready = {
      config: { provider: "anthropic" as const, model: "claude-sonnet-5-5" },
      hasKey: true,
      ready: true,
    };
    vi.mocked(ask.aiStatus).mockResolvedValueOnce(ready);
    vi.mocked(ask.aiKeyRemove).mockResolvedValueOnce({
      ...ready,
      hasKey: false,
      ready: false,
    });
    vi.mocked(ask.aiKeySet).mockResolvedValueOnce(ready);
    const r = render(<App />);
    await waitFor(() => r.getByTestId("editor"));
    await act(async () => {});
    act(() => modJ());
    await r.findByRole("region", { name: "Ask" });
    fireEvent.keyDown(window, { key: ",", code: "Comma", ctrlKey: true });
    fireEvent.click(await r.findByRole("tab", { name: "AI" }));
    fireEvent.click(r.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(r.queryByRole("region", { name: "Ask" })).toBeNull(),
    );
    fireEvent.change(r.getByLabelText("Key"), { target: { value: "sk-test" } });
    fireEvent.click(r.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(ask.aiKeySet).toHaveBeenCalled());
    await act(async () => {});
    expect(r.queryByRole("region", { name: "Ask" })).toBeNull();
  });

  it("toggleTerminalWithNoFolderShowsNotice", async () => {
    l.libraryRoot.mockResolvedValue({
      root: null,
      available: false,
      added: [],
    });
    const r = render(<App />);
    await waitFor(() => r.getByTestId("editor"));
    act(() => toggleTerminal());
    await waitFor(() =>
      expect(
        r.getByText("Choose a Library folder to open a terminal"),
      ).toBeTruthy(),
    );
    act(() => newTerminal());
    expect(tm.terminalOpen).not.toHaveBeenCalled();
  });

  it("Ctrl+` opens a terminal in the Library root, under the editor", async () => {
    const r = render(<App />);
    await waitFor(() => r.getByTestId("editor"));
    // Until the Library root is known there's no folder: press until it is.
    await waitFor(() => {
      act(() => toggleTerminal());
      expect(tm.terminalOpen).toHaveBeenCalledWith(
        R,
        80,
        24,
        expect.any(Function),
      );
    });
    expect(tm.terminalOpen).toHaveBeenCalledTimes(1);
    const panel = await r.findByTestId("terminal-panel");
    expect(panel).toHaveAttribute("data-position", "bottom");
    expect(panel).toHaveAttribute("data-size", "280");
    // Beside <main> in a column: across the workspace, above the status bar.
    const main = r.container.querySelector("main")!;
    expect(panel.parentElement).toBe(main.parentElement);
    expect(main.parentElement!.className).toContain("flex-col");
  });

  it("+ falls back to the default folder when the active terminal's is gone", async () => {
    const r = render(<App />);
    await waitFor(() => r.getByTestId("editor"));
    act(() => modB());
    const proj = await r.findByRole("treeitem", { name: "proj" });
    fireEvent.contextMenu(proj);
    fireEvent.click(r.getByRole("menuitem", { name: "Open in terminal" }));
    await waitFor(() =>
      expect(tm.terminalOpen).toHaveBeenCalledWith(
        `${R}\\proj`,
        80,
        24,
        expect.any(Function),
      ),
    );
    // The folder has since been deleted: opening there fails.
    tm.terminalOpen.mockRejectedValueOnce({ kind: "notFound" });
    tm.terminalOpen.mockResolvedValueOnce(2);
    const plus = await r.findByRole("button", { name: "New terminal" });
    fireEvent.click(plus);
    await waitFor(() => expect(tm.terminalOpen).toHaveBeenCalledTimes(3));
    expect(tm.terminalOpen.mock.calls.map((c) => c[0])).toEqual([
      `${R}\\proj`,
      `${R}\\proj`,
      R,
    ]);
    expect(r.queryByText(/Can't open a terminal/)).toBeNull();

    // When the default fails too, the notice shows.
    tm.terminalOpen.mockRejectedValue({ kind: "notFound" });
    fireEvent.click(plus);
    await waitFor(() =>
      expect(r.getByText(/Can't open a terminal/)).toBeTruthy(),
    );
    expect(tm.terminalOpen).toHaveBeenCalledTimes(4);
  });

  it("terminalCodeIsNotInStartupGraph", () => {
    // Every source module's text, keyed like "./app/useWorkspace.ts".
    const sources = import.meta.glob<string>(
      ["./**/*.ts", "./**/*.tsx", "!./**/*.test.*"],
      { query: "?raw", import: "default", eager: true },
    );
    const join = (dir: string, spec: string) => {
      const parts = dir.split("/");
      for (const seg of spec.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== ".") parts.push(seg);
      }
      return parts.join("/");
    };
    const resolveFile = (base: string) =>
      [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base].find(
        (f) => f in sources,
      );
    const seen = new Set<string>();
    const bad: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      // Static imports and re-exports; `import(` is a lazy chunk.
      const specs = [
        ...sources[file].matchAll(/\bfrom\s+["']([^"']+)["']/g),
        ...sources[file].matchAll(/\bimport\s+["']([^"']+)["']/g),
      ].map((m) => m[1]);
      for (const spec of specs) {
        if (spec.startsWith("@xterm/") || spec.includes("TerminalPanel")) {
          bad.push(`${file}: ${spec}`);
        }
        if (spec.startsWith(".")) {
          const dir = file.slice(0, file.lastIndexOf("/"));
          const next = resolveFile(join(dir, spec));
          if (next) visit(next);
        }
      }
    };
    visit("./App.tsx");
    // The walk really followed the graph (the panel's own modules included).
    expect(seen.size).toBeGreaterThan(20);
    expect(seen).toContain("./terminal/useTerminals.ts");
    expect(bad).toEqual([]);
  });
});
