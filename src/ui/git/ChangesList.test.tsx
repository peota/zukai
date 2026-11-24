import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Change } from "../../git/api";
import { ChangesList } from "./ChangesList";

const FOLDER = "C:\\Lib";

function setup(changes: Change[] | undefined) {
  const p = {
    folder: FOLDER,
    changes,
    onOpenDiff: vi.fn(),
    onOpenFile: vi.fn(),
    onCopyPath: vi.fn(),
  };
  render(<ChangesList {...p} />);
  return p;
}

const rows = () => screen.getAllByRole("listitem");
const menuItems = () =>
  within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((el) => el.textContent);

describe("ChangesList", () => {
  it("shows the heading with the count and rows sorted by path", () => {
    setup([
      { path: "standup.md", status: "modified" },
      { path: "ideas/rust.md", status: "added" },
      { path: "a/b/old.txt", status: "deleted" },
    ]);
    expect(screen.getByText("CHANGES")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    const r = rows();
    expect(r.map((li) => li.getAttribute("data-path"))).toEqual([
      "a/b/old.txt",
      "ideas/rust.md",
      "standup.md",
    ]);
    expect(within(r[1]).getByText("A")).toBeTruthy();
    expect(within(r[1]).getByText("rust.md")).toBeTruthy();
    expect(within(r[1]).getByText("ideas")).toBeTruthy();
    expect(within(r[0]).getByText("D")).toBeTruthy();
    expect(within(r[0]).getByText("a/b")).toBeTruthy();
    expect(within(r[2]).getByText("M")).toBeTruthy();
  });

  it("click and Enter open the diff", () => {
    const p = setup([
      { path: "notes/new.md", oldPath: "old.md", status: "renamed" },
      { path: "x.md", status: "modified" },
    ]);
    fireEvent.click(rows()[0]);
    expect(p.onOpenDiff).toHaveBeenCalledWith({
      folder: FOLDER,
      path: "notes/new.md",
      oldPath: "old.md",
      status: "renamed",
    });
    fireEvent.keyDown(rows()[1], { key: "Enter" });
    expect(p.onOpenDiff).toHaveBeenLastCalledWith({
      folder: FOLDER,
      path: "x.md",
      status: "modified",
    });
    expect(rows()[0].title).toBe("old.md → notes/new.md");
  });

  it("context menu has Open file and Copy path, no Open file for deleted", () => {
    const p = setup([
      { path: "gone.md", status: "deleted" },
      { path: "notes/here.md", status: "modified" },
    ]);
    fireEvent.contextMenu(rows()[1], { clientX: 10, clientY: 10 });
    expect(menuItems()).toEqual(["Open file", "Copy path"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open file" }));
    expect(p.onOpenFile).toHaveBeenCalledWith("C:\\Lib\\notes\\here.md");

    fireEvent.contextMenu(rows()[0], { clientX: 10, clientY: 10 });
    expect(menuItems()).toEqual(["Copy path"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    expect(p.onCopyPath).toHaveBeenCalledWith("C:\\Lib\\gone.md");
  });

  it("empty shows No changes", () => {
    setup([]);
    expect(screen.getByText("No changes")).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toEqual([]);
  });

  it("shows the first 500 rows, then how many more", () => {
    const many: Change[] = Array.from({ length: 501 }, (_, i) => ({
      path: `f${String(i).padStart(4, "0")}.md`,
      status: "added",
    }));
    setup(many);
    expect(rows()).toHaveLength(500);
    expect(screen.getByText("and 1 more files")).toBeTruthy();
  });

  it("only the conflicted letter takes the danger color", () => {
    setup([
      { path: "a.md", status: "conflicted" },
      { path: "b.md", status: "modified" },
    ]);
    const [u, m] = rows();
    expect(within(u).getByText("U").className).toContain("text-danger");
    expect(within(m).getByText("M").className).toContain("text-muted");
    expect(within(m).getByText("M").className).not.toContain("text-danger");
  });

  it("lists odd names verbatim", () => {
    const p = setup([{ path: 'notes/日本 plan "v2".md', status: "added" }]);
    expect(screen.getByText('日本 plan "v2".md')).toBeTruthy();
    fireEvent.click(rows()[0]);
    expect(p.onOpenDiff).toHaveBeenCalledWith({
      folder: FOLDER,
      path: 'notes/日本 plan "v2".md',
      status: "added",
    });
  });
});
