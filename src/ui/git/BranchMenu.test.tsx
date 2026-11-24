import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Branches, FolderGit } from "../../git/api";
import type { GitSyncApi } from "../../git/useGitSync";
import { BranchMenu, branchNameValid } from "./BranchMenu";
import { GitView } from "./GitView";
import { fakeGit, repo } from "./testing";

const LIB = "C:\\Lib";
const ANCHOR = new DOMRect(10, 40, 120, 26);

const BRANCHES: Branches = {
  current: "main",
  local: [
    { name: "main", upstream: "origin/main" },
    { name: "reorg-2026", upstream: null },
  ],
  remoteOnly: ["laptop-draft"],
};

function setup({
  status = repo(),
  branches = BRANCHES,
  unsaved = 0,
  gitOver = {},
}: {
  status?: FolderGit;
  branches?: Branches;
  unsaved?: number;
  gitOver?: Partial<GitSyncApi>;
} = {}) {
  const git = fakeGit({
    statuses: { [LIB]: status },
    branches: () => branches,
    ...gitOver,
  });
  const onClose = vi.fn();
  const onSaveAll = vi.fn();
  const el = (n: number, g = git) => (
    <BranchMenu
      folder={LIB}
      anchor={ANCHOR}
      git={g}
      unsaved={n}
      onSaveAll={onSaveAll}
      onClose={onClose}
    />
  );
  const { rerender } = render(el(unsaved));
  return {
    git,
    onClose,
    onSaveAll,
    rerender: (n: number, g?: GitSyncApi) => rerender(el(n, g)),
  };
}

const menu = () => screen.getByRole("menu", { name: "Branches" });
const branch = (name: string) =>
  within(menu()).getByRole("menuitemradio", { name });
const newBranch = () =>
  within(menu()).getByRole("menuitem", { name: "New branch…" });
const nameField = () => screen.getByRole("textbox", { name: "Branch name" });
const typeName = (v: string) =>
  fireEvent.change(nameField(), { target: { value: v } });
const enter = (el: HTMLElement) => fireEvent.keyDown(el, { key: "Enter" });

describe("BranchMenu sections", () => {
  it("lists LOCAL with the current branch checked, then ON REMOTE", () => {
    setup();
    expect(within(menu()).getByText("LOCAL")).toBeTruthy();
    expect(within(menu()).getByText("ON REMOTE")).toBeTruthy();
    const radios = within(menu())
      .getAllByRole("menuitemradio")
      .map((el) => el.textContent);
    expect(radios).toEqual(["main", "reorg-2026", "origin/laptop-draft"]);
    expect(branch("main").getAttribute("aria-checked")).toBe("true");
    expect(branch("main").querySelector("svg")).not.toBeNull();
    expect(branch("reorg-2026").getAttribute("aria-checked")).toBe("false");
    expect(branch("reorg-2026").querySelector("svg")).toBeNull();
  });

  it("hides ON REMOTE when nothing is remote-only", () => {
    setup({ branches: { ...BRANCHES, remoteOnly: [] } });
    expect(within(menu()).queryByText("ON REMOTE")).toBeNull();
  });

  it("checks nothing in detached HEAD", () => {
    setup({
      status: repo({ branch: null }),
      branches: { ...BRANCHES, current: null },
    });
    for (const el of within(menu()).getAllByRole("menuitemradio")) {
      expect(el.getAttribute("aria-checked")).toBe("false");
    }
  });
});

describe("BranchMenu filter", () => {
  const many = (n: number): Branches => ({
    current: "b0",
    local: Array.from({ length: n }, (_, i) => ({
      name: `b${i}`,
      upstream: null,
    })),
    remoteOnly: ["far-away", "b-remote"],
  });

  it("is absent with 8 branches or fewer", () => {
    setup({ branches: { ...many(6), remoteOnly: ["x", "y"] } });
    expect(
      screen.queryByRole("textbox", { name: "Filter branches" }),
    ).toBeNull();
  });

  it("shows past 8 and filters both sections", () => {
    setup({ branches: many(7) });
    const filter = screen.getByRole("textbox", { name: "Filter branches" });
    fireEvent.change(filter, { target: { value: "b" } });
    expect(within(menu()).getAllByRole("menuitemradio")).toHaveLength(8);
    fireEvent.change(filter, { target: { value: "far" } });
    expect(
      within(menu())
        .getAllByRole("menuitemradio")
        .map((el) => el.textContent),
    ).toEqual(["origin/far-away"]);
    expect(within(menu()).queryByText("LOCAL")).toBeNull();
    fireEvent.change(filter, { target: { value: "B6" } });
    expect(
      within(menu())
        .getAllByRole("menuitemradio")
        .map((el) => el.textContent),
    ).toEqual(["b6"]);
    expect(within(menu()).queryByText("ON REMOTE")).toBeNull();
  });
});

describe("BranchMenu new branch", () => {
  it.each(["-f", "a..b", "x y", "main.lock"])(
    "refuses %s before git runs",
    (bad) => {
      const { git, onClose } = setup();
      fireEvent.click(newBranch());
      typeName(bad);
      expect(screen.getByText("Not a valid branch name")).toBeTruthy();
      enter(nameField());
      expect(git.createBranch).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it("says when the branch exists, and Enter does nothing", () => {
    const { git } = setup();
    fireEvent.click(newBranch());
    typeName("reorg-2026");
    expect(screen.getByText("That branch already exists")).toBeTruthy();
    enter(nameField());
    expect(git.createBranch).not.toHaveBeenCalled();
  });

  it("creates a good name and closes, even dirty with unsaved files", () => {
    const { git, onClose } = setup({
      status: repo({ dirty: true }),
      unsaved: 2,
    });
    fireEvent.click(newBranch());
    typeName("feature/notes");
    expect(screen.queryByText("Not a valid branch name")).toBeNull();
    enter(nameField());
    expect(git.createBranch).toHaveBeenCalledWith(LIB, "feature/notes");
    expect(onClose).toHaveBeenCalled();
  });

  it("Tab in the name field closes the menu", () => {
    const { onClose } = setup();
    fireEvent.click(newBranch());
    fireEvent.keyDown(nameField(), { key: "Tab" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc in the name field goes back to the list", () => {
    const { onClose } = setup();
    fireEvent.click(newBranch());
    fireEvent.keyDown(nameField(), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Branch name" })).toBeNull();
    expect(newBranch()).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("BranchMenu placement", () => {
  it("moves up to stay on screen once the branches arrive", () => {
    // The panel is 40px tall until it lists branches, then 700px.
    const box = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const tall = this.querySelector('[role="menuitemradio"]') !== null;
        const top = parseFloat(this.style.top || "0");
        return new DOMRect(10, top, 256, tall ? 700 : 40);
      });
    try {
      const git = fakeGit({
        statuses: { [LIB]: repo() },
        branches: () => undefined,
      });
      const { rerender } = setup({ gitOver: { branches: () => undefined } });
      const root = () => menu().parentElement as HTMLElement;
      expect(root().style.top).toBe(`${ANCHOR.bottom + 4}px`);
      rerender(0, { ...git, branches: () => BRANCHES });
      // Its bottom sits 8px above the window's.
      expect(parseFloat(root().style.top) + 700).toBe(window.innerHeight - 8);
    } finally {
      box.mockRestore();
    }
  });
});

describe("branchNameValid", () => {
  it.each([
    "",
    "-f",
    "a..b",
    "x y",
    "tab\there",
    "a~b",
    "a^b",
    "a:b",
    "a?b",
    "a*b",
    "a[b",
    "a\\b",
    "main.lock",
    "trailing/",
    "trailing.",
    "a@{b",
    "@",
  ])("refuses %j", (n) => expect(branchNameValid(n)).toBe(false));

  it.each(["main", "feature/notes", "v1.2", "日本"])("accepts %j", (n) =>
    expect(branchNameValid(n)).toBe(true),
  );
});

describe("BranchMenu switching", () => {
  it("switches to a local branch and closes", () => {
    const { git, onClose } = setup();
    fireEvent.click(branch("reorg-2026"));
    expect(git.switchBranch).toHaveBeenCalledWith(LIB, "reorg-2026", false);
    expect(onClose).toHaveBeenCalled();
  });

  it("switches to a remote-only branch by tracking it", () => {
    const { git } = setup();
    fireEvent.click(branch("origin/laptop-draft"));
    expect(git.switchBranch).toHaveBeenCalledWith(LIB, "laptop-draft", true);
  });

  it("choosing the current branch only closes", () => {
    const { git, onClose } = setup();
    fireEvent.click(branch("main"));
    expect(git.switchBranch).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses with uncommitted changes", () => {
    const { git, onClose } = setup({ status: repo({ dirty: true }) });
    fireEvent.click(branch("reorg-2026"));
    expect(
      screen.getByText(
        "You have uncommitted changes. Commit first, then switch.",
      ),
    ).toBeTruthy();
    expect(git.switchBranch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses with unsaved files and offers Save all", () => {
    const { git, onSaveAll } = setup({ unsaved: 2 });
    fireEvent.click(branch("origin/laptop-draft"));
    expect(
      screen.getByText("Save or close 2 unsaved files first."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    expect(onSaveAll).toHaveBeenCalled();
    expect(git.switchBranch).not.toHaveBeenCalled();
  });

  it("from the keyboard, the refusal takes focus to Save all", () => {
    const { onSaveAll } = setup({ unsaved: 1 });
    const m = menu();
    fireEvent.keyDown(m, { key: "ArrowDown" }); // New branch…
    fireEvent.keyDown(m, { key: "ArrowDown" }); // main
    fireEvent.keyDown(m, { key: "ArrowDown" }); // reorg-2026
    fireEvent.keyDown(m, { key: "Enter" });
    const save = screen.getByRole("button", { name: "Save all" });
    expect(document.activeElement).toBe(save);
    // Enter on it is the button's own (its click), not the menu's.
    const enterKey = fireEvent.keyDown(save, { key: "Enter" });
    expect(enterKey).toBe(true);
    fireEvent.click(save);
    expect(onSaveAll).toHaveBeenCalledOnce();
  });

  it("the unsaved refusal goes once they're saved", () => {
    const { rerender } = setup({ unsaved: 2 });
    fireEvent.click(branch("reorg-2026"));
    expect(
      screen.getByText("Save or close 2 unsaved files first."),
    ).toBeTruthy();
    rerender(1);
    expect(
      screen.getByText("Save or close 1 unsaved file first."),
    ).toBeTruthy();
    rerender(0);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.activeElement).toBe(menu());
  });

  it("says file, singular, for one unsaved file", () => {
    const { git } = setup({ unsaved: 1 });
    fireEvent.click(branch("reorg-2026"));
    expect(
      screen.getByText("Save or close 1 unsaved file first."),
    ).toBeTruthy();
    expect(git.switchBranch).not.toHaveBeenCalled();
  });

  it("disables every item while rebasing", () => {
    const { git } = setup({ status: repo({ state: "rebasing" }) });
    const items = [
      ...within(menu()).getAllByRole("menuitem"),
      ...within(menu()).getAllByRole("menuitemradio"),
    ];
    for (const el of items) {
      expect(el.getAttribute("aria-disabled")).toBe("true");
    }
    expect(
      within(menu()).getByText("Finish the rebase in a terminal first"),
    ).toBeTruthy();
    fireEvent.click(branch("reorg-2026"));
    fireEvent.click(newBranch());
    expect(git.switchBranch).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Branch name" })).toBeNull();
  });

  it("keyboard: arrows move and Enter chooses", () => {
    const { git } = setup();
    const m = menu();
    fireEvent.keyDown(m, { key: "ArrowDown" }); // New branch…
    fireEvent.keyDown(m, { key: "ArrowDown" }); // main
    fireEvent.keyDown(m, { key: "ArrowDown" }); // reorg-2026
    fireEvent.keyDown(m, { key: "Enter" });
    expect(git.switchBranch).toHaveBeenCalledWith(LIB, "reorg-2026", false);
  });
});

describe("BranchMenu in the Git view", () => {
  function view() {
    const git = fakeGit({
      statuses: { [LIB]: repo() },
      branches: () => BRANCHES,
    });
    render(
      <GitView
        git={git}
        folders={[{ path: LIB, name: "Library" }]}
        defaultFolder={LIB}
        unsavedUnder={() => 0}
        onSaveAll={vi.fn()}
        onOpenDiff={vi.fn()}
        onOpenFile={vi.fn()}
        onCopyPath={vi.fn()}
        onAddFromGit={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: /main/ });
    fireEvent.click(button);
    return button;
  }

  it("the branch button opens it and toggles it shut", () => {
    const button = view();
    expect(menu()).toBeTruthy();
    fireEvent.mouseDown(button);
    fireEvent.click(button);
    expect(screen.queryByRole("menu", { name: "Branches" })).toBeNull();
  });

  it("Esc closes it and focus returns to the branch button", () => {
    const button = view();
    fireEvent.keyDown(menu(), { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Branches" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("a click away closes it and focus returns to the branch button", () => {
    const button = view();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "Branches" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
