import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storage from "./storage/api";
import * as files from "./files/api";
import * as lib from "./library/api";
import App from "./App";
import { toSessionFile } from "./model/session";
import { newTabState } from "./model/workspace";

const h = vi.hoisted(() => ({
  flushAll: null as null | (() => Promise<void>),
}));

vi.mock("./app/shortcuts", async (orig) => ({
  ...(await orig<typeof import("./app/shortcuts")>()),
  detectPlatform: () => "windows",
}));

// The editor itself has its own tests; here only the layout around it.
vi.mock("./editor/EditorHost", () => ({
  EditorHost: () => <div data-testid="editor" />,
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
  l.libraryRoot.mockResolvedValue({ root: R, available: true });
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
});
