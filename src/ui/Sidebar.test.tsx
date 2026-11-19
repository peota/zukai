import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../library/api";
import { filterRows, visibleRows, type TreeState } from "../library/tree";
import { Sidebar, type SidebarProps } from "./Sidebar";

const ROOT = "C:\\Lib";
const p = (...s: string[]) => [ROOT, ...s].join("\\");
const dir = (path: string, link: Entry["link"] = null): Entry => ({
  name: path.slice(path.lastIndexOf("\\") + 1),
  path,
  isDir: true,
  link,
});
const file = (path: string, link: Entry["link"] = null): Entry => ({
  ...dir(path, link),
  isDir: false,
});

const IDEAS = dir(p("Ideas"));
const ROADMAP = dir(p("Roadmap"));
const EMPTY = dir(p("Empty"));
const OUTSIDE = dir(p("elsewhere"), "outside");
const TODO = file(p("todo.txt"));
const BAD = file(p("bad."));
const NOTES = file(p("Ideas", "notes.md"));
const FLOW = file(p("Ideas", "flow.excalidraw"));
const PIC = file(p("Ideas", "pic.png"));
const DATA = file(p("Ideas", "data.json"));

function makeTree(over: Partial<TreeState> = {}): TreeState {
  return {
    root: ROOT,
    children: {
      [ROOT]: [EMPTY, IDEAS, ROADMAP, OUTSIDE, BAD, TODO],
      [IDEAS.path]: [NOTES, FLOW, PIC, DATA],
      [EMPTY.path]: [],
    },
    expanded: new Set([IDEAS.path]),
    selected: null,
    added: [],
    ...over,
  };
}

function props(over: Partial<SidebarProps> = {}): SidebarProps {
  const tree = over.tree ?? makeTree();
  return {
    open: true,
    width: 240,
    onWidth: vi.fn(),
    root: ROOT,
    available: true,
    tree,
    rows: visibleRows(tree),
    searching: false,
    search: { query: "", results: [], ready: true },
    onSearch: vi.fn(),
    scratchpads: [
      { id: "s1", title: "Untitled", kind: "text" },
      { id: "s2", title: "Sketch", kind: "canvas" },
    ],
    activePath: FLOW.path,
    activeId: "f1",
    onOpen: vi.fn(),
    onToggle: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(async () => null),
    onMove: vi.fn(),
    onTrash: vi.fn(),
    onReveal: vi.fn(),
    onCopyPath: vi.fn(),
    onChooseRoot: vi.fn(),
    onRecreateRoot: vi.fn(),
    onScratchpadActivate: vi.fn(),
    onScratchpadMove: vi.fn(),
    pinned: [],
    onPinnedOpen: vi.fn(),
    onUnpin: vi.fn(),
    onLeave: vi.fn(),
    added: tree.added,
    onAddFolder: vi.fn(),
    onLocateFolder: vi.fn(),
    onRemoveFolder: vi.fn(),
    platform: "windows",
    ...over,
  };
}

function setup(over: Partial<SidebarProps> = {}) {
  const p = props(over);
  const r = render(<Sidebar {...p} />);
  return { p, ...r };
}

const row = (name: string) => screen.getByRole("treeitem", { name });
const tree = () => screen.getByRole("tree");
const iconOf = (el: HTMLElement) =>
  el.querySelector("[data-icon]")?.getAttribute("data-icon");
const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });

afterEach(() => {
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

/**
 * jsdom has no layout: hit-testing puts rows 26px tall, stacked from y=0,
 * in a 600px-tall tree; below that is outside the tree.
 */
function layOut() {
  document.elementFromPoint = (_x: number, y: number) => {
    if (y < 0 || y >= 600) return document.body;
    const items = screen.queryAllByRole("treeitem");
    return items[Math.floor(y / 26)] ?? tree();
  };
}
const yOf = (name: string) =>
  screen.getAllByRole("treeitem").findIndex((el) => el === row(name)) * 26 + 13;

describe("Sidebar", () => {
  it("rendersTreeWithIconsAndScratchpads", () => {
    const { p } = setup();
    expect(screen.getByPlaceholderText("Search Library")).toBeInTheDocument();
    expect(screen.getByText("LIBRARY")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New in Library" }),
    ).toBeInTheDocument();

    const names = screen
      .getAllByRole("treeitem")
      .map((el) => el.getAttribute("aria-label"));
    expect(names).toEqual([
      "Empty",
      "Ideas",
      "notes.md",
      "flow.excalidraw",
      "pic.png",
      "data.json",
      "Roadmap",
      "elsewhere",
      "bad.",
      "todo.txt",
    ]);
    expect(iconOf(row("Ideas"))).toBe("folder");
    expect(iconOf(row("notes.md"))).toBe("markdown");
    expect(iconOf(row("flow.excalidraw"))).toBe("canvas");
    expect(iconOf(row("pic.png"))).toBe("image");
    expect(iconOf(row("data.json"))).toBe("data");
    expect(iconOf(row("todo.txt"))).toBe("text");
    expect(row("Ideas")).toHaveAttribute("aria-expanded", "true");
    expect(row("Roadmap")).toHaveAttribute("aria-expanded", "false");
    expect(row("notes.md")).toHaveAttribute("aria-level", "2");

    // The active File is highlighted.
    expect(row("flow.excalidraw")).toHaveAttribute("aria-current", "true");
    expect(row("notes.md")).not.toHaveAttribute("aria-current");

    // Entries Rust can't act on are dimmed, explained, and inert.
    expect(row("elsewhere")).toHaveAttribute("aria-disabled", "true");
    expect(row("elsewhere").getAttribute("title")).toMatch(/outside/i);
    expect(iconOf(row("elsewhere"))).toBe("link");
    expect(row("bad.")).toHaveAttribute("aria-disabled", "true");
    expect(row("bad.").getAttribute("title")).toMatch(/dot or a space/i);
    fireEvent.click(row("bad."));
    fireEvent.click(row("elsewhere"));
    expect(p.onOpen).not.toHaveBeenCalled();
    expect(p.onToggle).not.toHaveBeenCalled();

    fireEvent.click(row("todo.txt"));
    expect(p.onOpen).toHaveBeenCalledWith(TODO);
    fireEvent.click(row("Roadmap"));
    expect(p.onToggle).toHaveBeenCalledWith(ROADMAP.path);

    // The Scratchpads list at the bottom.
    const scratchpads = screen.getByRole("list", { name: "Scratchpads" });
    expect(screen.getByText("SCRATCHPADS")).toBeInTheDocument();
    const items = within(scratchpads).getAllByRole("listitem");
    expect(items.map((el) => el.textContent)).toEqual(["Untitled", "Sketch"]);
    expect(iconOf(items[0])).toBe("scratchpad");
    expect(iconOf(items[1])).toBe("canvas");
    fireEvent.click(items[1]);
    expect(p.onScratchpadActivate).toHaveBeenCalledWith("s2");
  });

  it("highlights the active Scratchpad in its list", () => {
    setup({ activeId: "s1", activePath: null });
    const items = within(
      screen.getByRole("list", { name: "Scratchpads" }),
    ).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(items[1]).not.toHaveAttribute("aria-current");
  });

  it("symlinks inside the Library show a link glyph and stay usable", () => {
    const inner = file(p("alias.md"), "inside");
    const t = makeTree({
      children: { [ROOT]: [inner] },
      expanded: new Set(),
    });
    const { p: pr } = setup({ tree: t, rows: visibleRows(t) });
    expect(row("alias.md").querySelector("[data-link-glyph]")).not.toBeNull();
    expect(row("alias.md")).not.toHaveAttribute("aria-disabled");
    fireEvent.click(row("alias.md"));
    expect(pr.onOpen).toHaveBeenCalledWith(inner);
  });

  it("searchShowsSearchingUntilReady", () => {
    const { p, rerender } = setup();
    const box = screen.getByPlaceholderText("Search Library");
    fireEvent.change(box, { target: { value: "no" } });
    expect(p.onSearch).toHaveBeenCalledWith("no");

    const waiting = props({
      ...p,
      searching: true,
      search: { query: "no", results: [], ready: false },
      rows: [],
    });
    rerender(<Sidebar {...waiting} />);
    expect(screen.getByText("Searching…")).toBeInTheDocument();
    expect(screen.queryAllByRole("treeitem")).toHaveLength(0);

    const ready = props({
      ...p,
      searching: true,
      search: { query: "no", results: [NOTES], ready: true },
      rows: filterRows([NOTES], [ROOT]),
    });
    rerender(<Sidebar {...ready} />);
    expect(screen.queryByText("Searching…")).toBeNull();
    expect(
      screen
        .getAllByRole("treeitem")
        .map((el) => el.getAttribute("aria-label")),
    ).toEqual(["Ideas", "notes.md"]);

    rerender(
      <Sidebar
        {...props({
          ...p,
          searching: true,
          search: { query: "zzz", results: [], ready: true },
          rows: [],
        })}
      />,
    );
    expect(screen.getByText("No matches")).toBeInTheDocument();

    // Esc clears the filter.
    key(screen.getByPlaceholderText("Search Library"), "Escape");
    expect(p.onSearch).toHaveBeenLastCalledWith("");
  });

  it("keyboardNavigationAndF2Rename", () => {
    const { p } = setup();
    const t = tree();
    act(() => t.focus());
    // First focus starts on the active File.
    expect(row("flow.excalidraw")).toHaveAttribute("aria-selected", "true");
    key(t, "Home");
    expect(row("Empty")).toHaveAttribute("aria-selected", "true");
    key(t, "ArrowDown");
    key(t, "ArrowDown");
    expect(row("notes.md")).toHaveAttribute("aria-selected", "true");
    expect(row("Empty")).toHaveAttribute("aria-selected", "false");

    // Left on a child goes to its folder; Left on an open folder collapses.
    key(t, "ArrowLeft");
    expect(row("Ideas")).toHaveAttribute("aria-selected", "true");
    key(t, "ArrowLeft");
    expect(p.onToggle).toHaveBeenCalledWith(IDEAS.path);
    // Right on an open folder steps into it.
    key(t, "ArrowRight");
    expect(row("notes.md")).toHaveAttribute("aria-selected", "true");

    // Enter opens a File.
    key(t, "Enter");
    expect(p.onOpen).toHaveBeenCalledWith(NOTES);

    // Down to Roadmap; Right expands a closed folder.
    for (let i = 0; i < 4; i++) key(t, "ArrowDown");
    expect(row("Roadmap")).toHaveAttribute("aria-selected", "true");
    key(t, "ArrowRight");
    expect(p.onToggle).toHaveBeenLastCalledWith(ROADMAP.path);
    // Down stops at the end; Up moves back.
    for (let i = 0; i < 10; i++) key(t, "ArrowDown");
    expect(row("todo.txt")).toHaveAttribute("aria-selected", "true");
    key(t, "ArrowUp");
    expect(row("bad.")).toHaveAttribute("aria-selected", "true");

    // F2 on a disabled entry does nothing.
    key(t, "F2");
    expect(screen.queryByRole("textbox", { name: "Rename" })).toBeNull();

    key(t, "ArrowDown");
    key(t, "F2");
    const input = screen.getByRole("textbox", { name: "Rename" });
    expect(input).toHaveValue("todo");
    key(input, "Escape");
    expect(screen.queryByRole("textbox", { name: "Rename" })).toBeNull();
    expect(p.onRename).not.toHaveBeenCalled();

    // Esc on the tree goes back to the editor.
    key(t, "Escape");
    expect(p.onLeave).toHaveBeenCalled();
  });

  it("renameKeepsExtensionShowsInlineError", async () => {
    const onRename = vi
      .fn<SidebarProps["onRename"]>()
      .mockResolvedValueOnce("“plan.md” already exists.")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    setup({ onRename });
    const t = tree();
    fireEvent.contextMenu(row("notes.md"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox", { name: "Rename" });
    expect(input).toHaveValue("notes");
    expect(within(row("notes.md")).getByText(".md")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "plan" } });
    await act(async () => key(input, "Enter"));
    expect(onRename).toHaveBeenLastCalledWith(NOTES.path, "plan.md");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "“plan.md” already exists.",
    );
    expect(screen.getByRole("textbox", { name: "Rename" })).toBeInTheDocument();

    // Typing the extension doesn't double it; success closes the field.
    fireEvent.change(input, { target: { value: "plan2.md" } });
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => key(input, "Enter"));
    expect(onRename).toHaveBeenLastCalledWith(NOTES.path, "plan2.md");
    expect(screen.queryByRole("textbox", { name: "Rename" })).toBeNull();

    // A folder edits its whole name.
    act(() => t.focus());
    fireEvent.click(row("Ideas"));
    key(t, "F2");
    const folderInput = screen.getByRole("textbox", { name: "Rename" });
    expect(folderInput).toHaveValue("Ideas");
    fireEvent.change(folderInput, { target: { value: "Ideas.old" } });
    await act(async () => key(folderInput, "Enter"));
    expect(onRename).toHaveBeenLastCalledWith(IDEAS.path, "Ideas.old");
  });

  it("an unchanged or empty name closes the field without renaming", async () => {
    const { p } = setup();
    fireEvent.click(row("todo.txt"));
    key(tree(), "F2");
    await act(async () =>
      key(screen.getByRole("textbox", { name: "Rename" }), "Enter"),
    );
    expect(screen.queryByRole("textbox", { name: "Rename" })).toBeNull();
    key(tree(), "F2");
    const input = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(input, { target: { value: "  " } });
    await act(async () => key(input, "Enter"));
    expect(p.onRename).not.toHaveBeenCalled();
  });

  it("deleteNonEmptyFolderAsksInline", () => {
    const { p } = setup();
    const t = tree();
    fireEvent.click(row("todo.txt"));
    key(t, "Delete");
    expect(p.onTrash).toHaveBeenCalledWith(TODO.path);

    // A folder that looks empty may hold dotfiles: still ask.
    fireEvent.click(row("Empty"));
    key(t, "Delete");
    expect(
      screen.getByText('Move "Empty" and everything in it to the Trash?'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    expect(p.onTrash).toHaveBeenLastCalledWith(EMPTY.path);

    fireEvent.click(row("Ideas"));
    expect(p.onToggle).toHaveBeenCalledWith(IDEAS.path);
    key(t, "Delete");
    expect(
      screen.getByText('Move "Ideas" and its 4 items to the Trash?'),
    ).toBeInTheDocument();
    expect(p.onTrash).toHaveBeenCalledTimes(2);

    // Esc cancels.
    key(screen.getByRole("button", { name: "Move to Trash" }), "Escape");
    expect(screen.queryByText(/and its 4 items/)).toBeNull();
    expect(p.onTrash).toHaveBeenCalledTimes(2);

    // Confirming trashes with the count.
    fireEvent.contextMenu(row("Ideas"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    expect(p.onTrash).toHaveBeenLastCalledWith(IDEAS.path, 4);
    expect(screen.queryByText(/and its 4 items/)).toBeNull();

    // A folder not listed yet may hold anything: ask too.
    fireEvent.click(row("Roadmap"));
    key(t, "Delete");
    expect(
      screen.getByText('Move "Roadmap" and everything in it to the Trash?'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(p.onTrash).toHaveBeenCalledTimes(3);
  });

  it("dragRowOntoFolderCallsOnMove", () => {
    const { p } = setup();
    layOut();
    const src = row("todo.txt");
    fireEvent.pointerDown(src, {
      button: 0,
      pointerId: 1,
      clientY: yOf("todo.txt"),
    });
    fireEvent.pointerMove(src, { pointerId: 1, buttons: 1, clientY: 200 });
    fireEvent.pointerMove(src, {
      pointerId: 1,
      buttons: 1,
      clientY: yOf("Roadmap"),
    });
    expect(row("Roadmap")).toHaveAttribute("data-drop-target", "true");
    fireEvent.pointerUp(src, { pointerId: 1, clientY: yOf("Roadmap") });
    fireEvent.click(src);
    expect(p.onMove).toHaveBeenCalledWith(TODO.path, ROADMAP.path);
    expect(p.onOpen).not.toHaveBeenCalled();
    expect(row("Roadmap")).not.toHaveAttribute("data-drop-target");

    // Dropping onto a File lands in that File's folder.
    const notes = row("notes.md");
    fireEvent.pointerDown(notes, {
      button: 0,
      pointerId: 2,
      clientY: yOf("notes.md"),
    });
    fireEvent.pointerMove(notes, {
      pointerId: 2,
      buttons: 1,
      clientY: yOf("todo.txt"),
    });
    fireEvent.pointerUp(notes, { pointerId: 2, clientY: yOf("todo.txt") });
    expect(p.onMove).toHaveBeenLastCalledWith(NOTES.path, ROOT);

    // A folder can't go into itself or its own folder; disabled rows can't drag.
    const ideas = row("Ideas");
    fireEvent.pointerDown(ideas, {
      button: 0,
      pointerId: 3,
      clientY: yOf("Ideas"),
    });
    fireEvent.pointerMove(ideas, {
      pointerId: 3,
      buttons: 1,
      clientY: yOf("pic.png"),
    });
    fireEvent.pointerUp(ideas, { pointerId: 3, clientY: yOf("pic.png") });
    const bad = row("bad.");
    fireEvent.pointerDown(bad, {
      button: 0,
      pointerId: 4,
      clientY: yOf("bad."),
    });
    fireEvent.pointerMove(bad, {
      pointerId: 4,
      buttons: 1,
      clientY: yOf("Roadmap"),
    });
    fireEvent.pointerUp(bad, { pointerId: 4, clientY: yOf("Roadmap") });
    expect(p.onMove).toHaveBeenCalledTimes(2);

    // Esc cancels a drag in progress.
    fireEvent.pointerDown(src, {
      button: 0,
      pointerId: 5,
      clientY: yOf("todo.txt"),
    });
    fireEvent.pointerMove(src, {
      pointerId: 5,
      buttons: 1,
      clientY: yOf("Ideas"),
    });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(src, { pointerId: 5, clientY: yOf("Ideas") });
    expect(p.onMove).toHaveBeenCalledTimes(2);

    // A small wobble is still a click.
    fireEvent.pointerDown(src, { button: 0, pointerId: 6, clientY: 100 });
    fireEvent.pointerMove(src, { pointerId: 6, buttons: 1, clientY: 102 });
    fireEvent.pointerUp(src, { pointerId: 6, clientY: 102 });
    fireEvent.click(src);
    expect(p.onOpen).toHaveBeenCalledWith(TODO);
    expect(p.onMove).toHaveBeenCalledTimes(2);
  });

  it("a press released elsewhere doesn't turn a later hover into a drag", () => {
    const { p } = setup();
    layOut();
    const src = row("todo.txt");
    fireEvent.pointerDown(src, {
      button: 0,
      pointerId: 1,
      clientY: yOf("todo.txt"),
    });
    fireEvent.pointerUp(document.body, { pointerId: 1 });
    fireEvent.pointerMove(src, {
      pointerId: 1,
      buttons: 1,
      clientY: yOf("Roadmap"),
    });
    fireEvent.pointerUp(src, { pointerId: 1, clientY: yOf("Roadmap") });
    expect(p.onMove).not.toHaveBeenCalled();
  });

  it("dragging a Scratchpad item onto a folder saves it there", () => {
    const { p } = setup();
    layOut();
    const item = within(
      screen.getByRole("list", { name: "Scratchpads" }),
    ).getAllByRole("listitem")[0];
    fireEvent.pointerDown(item, { button: 0, pointerId: 1, clientY: 700 });
    fireEvent.pointerMove(item, {
      pointerId: 1,
      buttons: 1,
      clientY: yOf("Ideas"),
    });
    fireEvent.pointerUp(item, { pointerId: 1, clientY: yOf("Ideas") });
    fireEvent.click(item);
    expect(p.onScratchpadMove).toHaveBeenCalledWith("s1", IDEAS.path);
    expect(p.onScratchpadActivate).not.toHaveBeenCalled();
  });

  it("rootUnavailableShowsChooseAndRecreate", () => {
    const { p } = setup({ available: false, rows: [] });
    expect(screen.getByText(/isn't available/)).toBeInTheDocument();
    expect(screen.getByText(ROOT)).toBeInTheDocument();
    expect(screen.queryByRole("tree")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose Library folder…" }),
    );
    expect(p.onChooseRoot).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create it again" }));
    expect(p.onRecreateRoot).toHaveBeenCalled();
    // Open Tabs (the Scratchpads list) are unaffected.
    expect(
      screen.getByRole("list", { name: "Scratchpads" }),
    ).toBeInTheDocument();
  });

  it("contextMenuNewItems", async () => {
    const created = p("Ideas", "Untitled.excalidraw");
    let resolve: (v: string | null) => void = () => {};
    const onCreate = vi.fn(
      () => new Promise<string | null>((r) => (resolve = r)),
    );
    const { p: pr, rerender } = setup({ onCreate });

    fireEvent.contextMenu(row("Ideas"));
    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((el) => el.textContent),
    ).toEqual(expect.arrayContaining(["New folder", "New file", "New canvas"]));
    // A plain file with no extension replaces the note and text-file items.
    expect(
      within(menu).queryByRole("menuitem", { name: "New note" }),
    ).toBeNull();
    expect(
      within(menu).queryByRole("menuitem", { name: "New text file" }),
    ).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "New canvas" }));
    expect(onCreate).toHaveBeenCalledWith(IDEAS.path, "canvas");

    // The new item opens with its rename field once it shows in the tree.
    const t = makeTree({
      children: {
        ...makeTree().children,
        [IDEAS.path]: [NOTES, FLOW, PIC, DATA, file(created)],
      },
    });
    await act(async () => resolve(created));
    rerender(<Sidebar {...props({ ...pr, tree: t, rows: visibleRows(t) })} />);
    const input = screen.getByRole("textbox", { name: "Rename" });
    expect(input).toHaveValue("Untitled");
    key(input, "Escape");

    // The header + offers the same for the root, plus Choose Library folder…
    fireEvent.click(screen.getByRole("button", { name: "New in Library" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New file" }));
    expect(onCreate).toHaveBeenLastCalledWith(ROOT, "file");
    fireEvent.click(screen.getByRole("button", { name: "New in Library" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Choose Library folder…" }),
    );
    expect(pr.onChooseRoot).toHaveBeenCalled();

    // A File's menu.
    fireEvent.contextMenu(row("todo.txt"));
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(
      expect.arrayContaining(["Open", "Rename", "Delete", "Copy path"]),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    expect(pr.onCopyPath).toHaveBeenCalledWith(TODO.path);
    fireEvent.contextMenu(row("todo.txt"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Show in/ }));
    expect(pr.onReveal).toHaveBeenCalledWith(TODO.path);

    // A disabled entry's actions are disabled, Copy path still works.
    fireEvent.contextMenu(row("bad."));
    for (const name of ["Open", "Rename", "Delete"]) {
      expect(
        screen.getByRole("menuitem", { name: new RegExp(`^${name}`) }),
      ).toHaveAttribute("aria-disabled", "true");
    }
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    // Scratchpads list: Move to Library… goes through the save dialog (null folder).
    const item = within(
      screen.getByRole("list", { name: "Scratchpads" }),
    ).getAllByRole("listitem")[1];
    fireEvent.contextMenu(item);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to Library…" }));
    expect(pr.onScratchpadMove).toHaveBeenCalledWith("s2", null);
  });

  it("widthHandleClamps", () => {
    const { p } = setup();
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 240 });
    fireEvent.pointerMove(handle, { pointerId: 1, buttons: 1, clientX: 300 });
    expect(p.onWidth).toHaveBeenLastCalledWith(300);
    fireEvent.pointerMove(handle, { pointerId: 1, buttons: 1, clientX: 2000 });
    expect(p.onWidth).toHaveBeenLastCalledWith(480);
    fireEvent.pointerMove(handle, { pointerId: 1, buttons: 1, clientX: -50 });
    expect(p.onWidth).toHaveBeenLastCalledWith(180);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: -50 });
    fireEvent.pointerMove(handle, { pointerId: 1, buttons: 1, clientX: 400 });
    expect(p.onWidth).toHaveBeenCalledTimes(3);

    key(handle, "ArrowRight");
    expect(p.onWidth).toHaveBeenLastCalledWith(256);
    expect(handle).toHaveAttribute("aria-valuemin", "180");
    expect(handle).toHaveAttribute("aria-valuemax", "480");
    // Reachable with Tab.
    expect(handle).toHaveAttribute("tabindex", "0");
  });

  it("trailing dot or space names are ordinary off Windows", () => {
    for (const platform of ["mac", "other"] as const) {
      const { p, unmount } = setup({ platform });
      expect(row("bad.")).not.toHaveAttribute("aria-disabled");
      expect(row("bad.").getAttribute("title")).not.toMatch(/dot/);
      fireEvent.click(row("bad."));
      expect(p.onOpen).toHaveBeenCalledWith(BAD);
      key(tree(), "F2");
      expect(screen.getByRole("textbox", { name: "Rename" })).toHaveValue(
        "bad",
      );
      unmount();
    }
  });

  it("Delete on a disabled row does nothing", () => {
    const { p } = setup();
    fireEvent.click(row("bad."));
    key(tree(), "Delete");
    fireEvent.click(row("elsewhere"));
    key(tree(), "Delete");
    expect(p.onTrash).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Confirm delete" })).toBeNull();
  });

  it("a click on a 5,000-row tree measures nothing", () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      file(p(`f${String(i).padStart(4, "0")}.md`)),
    );
    const t = makeTree({ children: { [ROOT]: many }, expanded: new Set() });
    const { p: pr } = setup({ tree: t, rows: visibleRows(t) });
    const hit = vi.fn(() => document.body);
    document.elementFromPoint = hit;
    const measure = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const target = row("f2500.md");
    fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientY: 10 });
    fireEvent.pointerMove(target, { pointerId: 1, buttons: 1, clientY: 11 });
    fireEvent.pointerUp(target, { pointerId: 1, clientY: 11 });
    fireEvent.click(target);
    expect(measure.mock.calls.length).toBeLessThanOrEqual(1);
    expect(hit).not.toHaveBeenCalled();
    expect(pr.onOpen).toHaveBeenCalledWith(many[2500]);
    measure.mockRestore();
  }, 20_000);

  it("a folder can't be dropped into its own nested folder", () => {
    const a = dir(p("A"));
    const b = dir(p("A", "B"));
    const c = dir(p("A", "B", "C"));
    const t = makeTree({
      children: { [ROOT]: [a], [a.path]: [b], [b.path]: [c], [c.path]: [] },
      expanded: new Set([a.path, b.path]),
    });
    const { p: pr } = setup({ tree: t, rows: visibleRows(t) });
    layOut();
    const drag = (from: string, to: string, id: number) => {
      const el = row(from);
      fireEvent.pointerDown(el, {
        button: 0,
        pointerId: id,
        clientY: yOf(from),
      });
      fireEvent.pointerMove(el, {
        pointerId: id,
        buttons: 1,
        clientY: yOf(to),
      });
      fireEvent.pointerUp(el, { pointerId: id, clientY: yOf(to) });
    };
    drag("A", "C", 1);
    drag("B", "C", 2);
    expect(pr.onMove).not.toHaveBeenCalled();
    drag("C", "A", 3);
    expect(pr.onMove).toHaveBeenCalledWith(c.path, a.path);
  });

  it("a disabled folder is not a drop target", () => {
    const { p } = setup();
    layOut();
    const src = row("todo.txt");
    fireEvent.pointerDown(src, {
      button: 0,
      pointerId: 1,
      clientY: yOf("todo.txt"),
    });
    fireEvent.pointerMove(src, {
      pointerId: 1,
      buttons: 1,
      clientY: yOf("elsewhere"),
    });
    expect(row("elsewhere")).not.toHaveAttribute("data-drop-target");
    fireEvent.pointerUp(src, { pointerId: 1, clientY: yOf("elsewhere") });
    expect(p.onMove).not.toHaveBeenCalled();
  });

  it("the keyboard comes back to the tree when its menu closes", () => {
    const { p } = setup();
    fireEvent.contextMenu(row("todo.txt"));
    expect(document.activeElement).toBe(screen.getByRole("menu"));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(document.activeElement).toBe(tree());

    fireEvent.contextMenu(row("Ideas"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    expect(p.onCopyPath).toHaveBeenCalledWith(IDEAS.path);
    expect(document.activeElement).toBe(tree());
  });

  it("Scratchpad items work from the keyboard", () => {
    const { p } = setup();
    const items = within(
      screen.getByRole("list", { name: "Scratchpads" }),
    ).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("tabindex", "0");
    expect(items[1]).toHaveAttribute("tabindex", "-1");
    act(() => items[0].focus());
    key(items[0], "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    key(items[1], "Enter");
    expect(p.onScratchpadActivate).toHaveBeenCalledWith("s2");

    // The context-menu key (no pointer position) opens the item's menu.
    fireEvent.contextMenu(items[1]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.contextMenu(items[1]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to Library…" }));
    expect(p.onScratchpadMove).toHaveBeenCalledWith("s2", null);
  });

  it("the cursor moves to a neighbour when its row goes away", () => {
    const { p, rerender } = setup();
    act(() => tree().focus());
    fireEvent.click(row("Roadmap"));
    expect(row("Roadmap")).toHaveAttribute("aria-selected", "true");
    const t = makeTree({
      children: {
        ...makeTree().children,
        [ROOT]: [EMPTY, IDEAS, OUTSIDE, BAD, TODO],
      },
    });
    rerender(<Sidebar {...props({ ...p, tree: t, rows: visibleRows(t) })} />);
    expect(row("elsewhere")).toHaveAttribute("aria-selected", "true");
    key(tree(), "ArrowDown");
    expect(row("bad.")).toHaveAttribute("aria-selected", "true");
  });

  it("first focus without a visible active File starts at the top", () => {
    setup({ activePath: null });
    act(() => tree().focus());
    expect(row("Empty")).toHaveAttribute("aria-selected", "true");
  });

  it("a delete question goes away with its row and stays gone", () => {
    const { p, rerender } = setup();
    fireEvent.click(row("Ideas"));
    key(tree(), "Delete");
    expect(screen.getByText(/Move "Ideas"/)).toBeInTheDocument();
    const gone = makeTree({
      children: { [ROOT]: [EMPTY, ROADMAP, TODO] },
    });
    rerender(
      <Sidebar {...props({ ...p, tree: gone, rows: visibleRows(gone) })} />,
    );
    expect(screen.queryByText(/Move "Ideas"/)).toBeNull();
    rerender(<Sidebar {...props(p)} />);
    expect(screen.queryByText(/Move "Ideas"/)).toBeNull();
  });

  it("a created item that misses the next listing opens no rename later", async () => {
    const created = p("Untitled.md");
    const onCreate = vi.fn(async () => created);
    const { p: pr, rerender } = setup({ onCreate });
    fireEvent.click(screen.getByRole("button", { name: "New in Library" }));
    await act(async () =>
      fireEvent.click(screen.getByRole("menuitem", { name: "New file" })),
    );
    // The next listing doesn't have it...
    const t1 = makeTree();
    rerender(
      <Sidebar {...props({ ...pr, tree: t1, rows: visibleRows(t1) })} />,
    );
    // ...so when it shows up later, no rename field opens.
    const t2 = makeTree({
      children: { ...makeTree().children, [ROOT]: [TODO, file(created)] },
    });
    rerender(
      <Sidebar {...props({ ...pr, tree: t2, rows: visibleRows(t2) })} />,
    );
    expect(screen.queryByRole("textbox", { name: "Rename" })).toBeNull();
  });

  it("renders nothing when closed", () => {
    const { container } = setup({ open: false });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Sidebar added folders", () => {
  const ADDED = "D:\\work\\Notes";
  const A_MD = file(`${ADDED}\\a.md`);
  const A_DIR = dir(`${ADDED}\\Sub`);

  function addedTree(available = true): TreeState {
    return makeTree({
      children: {
        ...makeTree().children,
        [ADDED]: [A_DIR, A_MD],
      },
      expanded: new Set([IDEAS.path, ADDED]),
      added: [{ path: ADDED, available }],
    });
  }
  function setupAdded(available = true, over: Partial<SidebarProps> = {}) {
    const t = addedTree(available);
    return setup({
      tree: t,
      rows: visibleRows(t),
      added: t.added,
      ...over,
    });
  }
  const menuItems = () =>
    within(screen.getByRole("menu"))
      .getAllByRole("menuitem")
      .map((el) => el.textContent);
  const actions = (name: string) =>
    screen.getByRole("button", { name: `${name} actions` });

  it("added_heading_shows_name_parent_and_tooltip", () => {
    setupAdded();
    const names = screen
      .getAllByRole("treeitem")
      .map((el) => el.getAttribute("aria-label"));
    // The Library's rows first, then the heading and its rows.
    expect(names.slice(-3)).toEqual(["Notes", "Sub", "a.md"]);
    const head = row("Notes");
    expect(head).toHaveAttribute("title", ADDED);
    expect(head).toHaveAttribute("aria-level", "1");
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(row("a.md")).toHaveAttribute("aria-level", "2");
    const parent = within(head).getByText("D:\\work");
    expect(parent.closest(".text-faint")).not.toBeNull();
    expect(within(head).getByText("Notes")).toBeInTheDocument();
  });

  it("heading_menu_items", () => {
    const { p } = setupAdded();
    fireEvent.click(actions("Notes"));
    expect(menuItems()).toEqual([
      "New file",
      "New folder",
      "Show in Explorer",
      "Remove from sidebar",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "New file" }));
    expect(p.onCreate).toHaveBeenCalledWith(ADDED, "file");
    // The ⋯ button doesn't toggle the folder.
    expect(p.onToggle).not.toHaveBeenCalled();

    // A right-click shows the same menu.
    fireEvent.contextMenu(row("Notes"));
    expect(menuItems()).toEqual([
      "New file",
      "New folder",
      "Show in Explorer",
      "Remove from sidebar",
    ]);
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Remove from sidebar" }),
    );
    expect(p.onRemoveFolder).toHaveBeenCalledWith(ADDED);
    fireEvent.click(actions("Notes"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show in Explorer" }));
    expect(p.onReveal).toHaveBeenCalledWith(ADDED);

    // A click on the heading opens and closes it.
    fireEvent.click(row("Notes"));
    expect(p.onToggle).toHaveBeenCalledWith(ADDED);
  });

  it("missing_heading_offers_locate_and_remove", () => {
    const { p } = setupAdded(false);
    const head = row("Notes");
    expect(head).toHaveAttribute("aria-disabled", "true");
    expect(head).toHaveTextContent("Not found");
    expect(screen.queryByRole("treeitem", { name: "a.md" })).toBeNull();
    fireEvent.click(head);
    expect(p.onToggle).not.toHaveBeenCalled();

    fireEvent.click(actions("Notes"));
    expect(menuItems()).toEqual(["Locate…", "Remove from sidebar"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Locate…" }));
    expect(p.onLocateFolder).toHaveBeenCalledWith(ADDED);

    fireEvent.contextMenu(head);
    expect(menuItems()).toEqual(["Locate…", "Remove from sidebar"]);
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Remove from sidebar" }),
    );
    expect(p.onRemoveFolder).toHaveBeenCalledWith(ADDED);
  });

  it("add_folder_in_library_menu_and_empty_space_menu", () => {
    const { p } = setupAdded();
    fireEvent.click(actions("Library"));
    expect(menuItems()).toEqual(["Add folder…"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Add folder…" }));
    expect(p.onAddFolder).toHaveBeenCalledTimes(1);

    // Right-click on the tree's empty part: Add folder… comes last.
    fireEvent.contextMenu(tree());
    const items = menuItems();
    expect(items[items.length - 1]).toBe("Add folder…");
    expect(items).toContain("Choose Library folder…");
    fireEvent.click(screen.getByRole("menuitem", { name: "Add folder…" }));
    expect(p.onAddFolder).toHaveBeenCalledTimes(2);
  });

  it("heading_cannot_be_renamed_or_trashed", () => {
    const { p } = setupAdded();
    fireEvent.click(row("Notes")); // the cursor goes to the heading
    expect(row("Notes")).toHaveAttribute("aria-selected", "true");
    key(tree(), "F2");
    expect(screen.queryByRole("textbox", { name: "Rename" })).toBeNull();
    key(tree(), "Delete");
    expect(p.onTrash).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Confirm delete" })).toBeNull();

    // Its menu has no Rename or Delete either.
    fireEvent.contextMenu(row("Notes"));
    expect(menuItems()).not.toContain("Rename");
    expect(menuItems()).not.toContain("Delete");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    // And it can't be dragged.
    layOut();
    const head = row("Notes");
    fireEvent.pointerDown(head, {
      button: 0,
      pointerId: 1,
      clientY: yOf("Notes"),
    });
    fireEvent.pointerMove(head, {
      pointerId: 1,
      buttons: 1,
      clientY: yOf("Roadmap"),
    });
    expect(row("Roadmap")).not.toHaveAttribute("data-drop-target");
    fireEvent.pointerUp(head, { pointerId: 1, clientY: yOf("Roadmap") });
    expect(p.onMove).not.toHaveBeenCalled();
  });

  it("cross_tree_drag_shows_copy_hint", () => {
    const { p } = setupAdded();
    layOut();
    // Within the Library: a move, no hint.
    const src = row("todo.txt");
    fireEvent.pointerDown(src, {
      button: 0,
      pointerId: 1,
      clientY: yOf("todo.txt"),
    });
    fireEvent.pointerMove(src, {
      pointerId: 1,
      buttons: 1,
      clientY: yOf("Roadmap"),
    });
    expect(row("Roadmap")).toHaveAttribute("data-drop-target", "true");
    expect(within(row("Roadmap")).queryByText("Copy")).toBeNull();

    // Onto the added folder's heading: the heading is the target, with Copy.
    fireEvent.pointerMove(src, {
      pointerId: 1,
      buttons: 1,
      clientY: yOf("Notes"),
    });
    expect(row("Notes")).toHaveAttribute("data-drop-target", "true");
    expect(within(row("Notes")).getByText("Copy")).toBeInTheDocument();
    fireEvent.pointerUp(src, { pointerId: 1, clientY: yOf("Notes") });
    expect(p.onMove).toHaveBeenCalledWith(TODO.path, ADDED);
    expect(screen.queryByText("Copy")).toBeNull();

    // From the added folder onto a Library folder: Copy too.
    const a = row("a.md");
    fireEvent.pointerDown(a, {
      button: 0,
      pointerId: 2,
      clientY: yOf("a.md"),
    });
    fireEvent.pointerMove(a, {
      pointerId: 2,
      buttons: 1,
      clientY: yOf("Roadmap"),
    });
    expect(within(row("Roadmap")).getByText("Copy")).toBeInTheDocument();
    // Within the added folder: no hint.
    fireEvent.pointerMove(a, {
      pointerId: 2,
      buttons: 1,
      clientY: yOf("Sub"),
    });
    expect(row("Sub")).toHaveAttribute("data-drop-target", "true");
    expect(screen.queryByText("Copy")).toBeNull();
    fireEvent.pointerUp(a, { pointerId: 2, clientY: yOf("Sub") });
    expect(p.onMove).toHaveBeenLastCalledWith(A_MD.path, A_DIR.path);
  });

  it("a missing heading is not a drop target", () => {
    const { p } = setupAdded(false);
    layOut();
    const src = row("todo.txt");
    fireEvent.pointerDown(src, {
      button: 0,
      pointerId: 1,
      clientY: yOf("todo.txt"),
    });
    fireEvent.pointerMove(src, {
      pointerId: 1,
      buttons: 1,
      clientY: yOf("Notes"),
    });
    expect(row("Notes")).not.toHaveAttribute("data-drop-target");
    fireEvent.pointerUp(src, { pointerId: 1, clientY: yOf("Notes") });
    expect(p.onMove).not.toHaveBeenCalled();
  });
});

describe("Sidebar Pinned section", () => {
  const PINS = [
    { id: "p1", title: "note.md", icon: "markdown" as const, open: true },
    { id: "p2", title: "Sketch", icon: "canvas" as const, open: false },
  ];

  it("lists pins above the Library, closed ones dimmed", () => {
    setup({ pinned: PINS, activeId: "p1" });
    const header = screen.getByText("PINNED");
    const library = screen.getByText("LIBRARY");
    expect(
      header.compareDocumentPosition(library) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const list = screen.getByRole("list", { name: "Pinned" });
    const [open, closed] = within(list).getAllByRole("listitem");
    expect(open).toHaveTextContent("note.md");
    expect(open.getAttribute("aria-current")).toBe("true");
    expect(iconOf(open)).toBe("markdown");
    expect(closed).toHaveTextContent("Sketch");
    expect(closed.getAttribute("title")).toBe("Sketch (closed)");
    expect(closed.className).toContain("text-faint");
  });

  it("a click opens the pin, open or closed", () => {
    const { p } = setup({ pinned: PINS });
    const list = within(screen.getByRole("list", { name: "Pinned" }));
    fireEvent.click(list.getByText("Sketch"));
    expect(p.onPinnedOpen).toHaveBeenCalledWith("p2");
    const item = list.getByText("note.md").closest("li")!;
    item.focus();
    key(item, "Enter");
    expect(p.onPinnedOpen).toHaveBeenCalledWith("p1");
  });

  it("its menu unpins", () => {
    const { p } = setup({ pinned: PINS });
    const list = within(screen.getByRole("list", { name: "Pinned" }));
    fireEvent.contextMenu(list.getByText("Sketch"), {
      clientX: 5,
      clientY: 5,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin" }));
    expect(p.onUnpin).toHaveBeenCalledWith("p2");
  });

  it("is hidden with nothing pinned", () => {
    setup({ pinned: [] });
    expect(screen.queryByText("PINNED")).toBeNull();
  });
});
