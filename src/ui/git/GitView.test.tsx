import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FolderGit } from "../../git/api";
import { errorCopy } from "../../git/messages";
import type { GitSyncApi } from "../../git/useGitSync";
import { GitView, type GitViewProps } from "./GitView";
import { fakeGit, gitError, repo } from "./testing";

const LIB = "C:\\Lib";
const WORK = "D:\\work";
const ONE = [{ path: LIB, name: "Library" }];
const TWO = [...ONE, { path: WORK, name: "work" }];

function props(git: GitSyncApi, over: Partial<GitViewProps> = {}) {
  return {
    git,
    folders: ONE,
    defaultFolder: LIB,
    unsavedUnder: vi.fn(() => 0),
    onSaveAll: vi.fn(),
    onOpenDiff: vi.fn(),
    onOpenFile: vi.fn(),
    onCopyPath: vi.fn(),
    onAddFromGit: vi.fn(),
    ...over,
  };
}

function setup(
  status: FolderGit | undefined,
  over: Partial<GitViewProps> = {},
  gitOver: Parameters<typeof fakeGit>[0] = {},
) {
  const git = fakeGit({
    statuses: status ? { [LIB]: status } : {},
    ...gitOver,
  });
  const p = props(git, over);
  const utils = render(<GitView {...p} />);
  return { git, p, ...utils };
}

const pull = () => screen.getByRole("button", { name: "Pull" });
const push = () => screen.getByRole("button", { name: "Push" });
const dis = (b: HTMLElement) =>
  (b as HTMLButtonElement).disabled ||
  b.getAttribute("aria-disabled") === "true";
const menuItems = () =>
  within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((el) => el.textContent);

afterEach(() => vi.useRealTimers());

describe("GitView folder", () => {
  it("selects the default folder on mount and none on unmount", () => {
    const { git, unmount } = setup(repo());
    expect(git.select).toHaveBeenLastCalledWith(LIB);
    unmount();
    expect(git.select).toHaveBeenLastCalledWith(null);
  });

  it("a single folder is plain text", () => {
    setup(repo());
    expect(screen.getByText("Library")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Library/ })).toBeNull();
  });

  it("two folders: a menu with both, a dirty dot and not synced", () => {
    const { git } = setup(
      repo(),
      { folders: TWO },
      {
        statuses: {
          [LIB]: repo({ dirty: true }),
          [WORK]: { kind: "notRepo" },
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /Library/ }));
    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Library",
      "worknot synced",
    ]);
    expect(within(items[0]).getByTitle("Uncommitted changes")).toBeTruthy();
    expect(within(items[1]).queryByTitle("Uncommitted changes")).toBeNull();
    fireEvent.click(items[1]);
    expect(git.select).toHaveBeenLastCalledWith(WORK);
    expect(screen.getByText("This folder isn't synced yet.")).toBeTruthy();
  });
});

describe("GitView kept folder", () => {
  it("reports a pick, and follows a new default", () => {
    const onSelectFolder = vi.fn();
    const { git, p, rerender } = setup(
      repo(),
      { folders: TWO, onSelectFolder },
      { statuses: { [LIB]: repo(), [WORK]: repo() } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Library/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /work/ }));
    expect(onSelectFolder).toHaveBeenCalledWith(WORK);
    expect(git.select).toHaveBeenLastCalledWith(WORK);
    // Shown for another folder (the status bar's chip): that one shows.
    rerender(<GitView {...p} defaultFolder={WORK} />);
    rerender(<GitView {...p} defaultFolder={LIB} />);
    expect(git.select).toHaveBeenLastCalledWith(LIB);
    expect(screen.getByRole("button", { name: /Library/ })).toBeTruthy();
  });
});

describe("GitView states", () => {
  it("not a repo: the set up form", () => {
    const { git } = setup({ kind: "notRepo" });
    expect(screen.getByText("This folder isn't synced yet.")).toBeTruthy();
    const url = screen.getByLabelText("Remote URL");
    const setUp = screen.getByRole("button", { name: "Set up" });
    expect((setUp as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(url, { target: { value: " git@x:me/n.git " } });
    fireEvent.click(setUp);
    expect(git.setup).toHaveBeenCalledWith(LIB, "git@x:me/n.git");
    expect(
      screen.getByText(
        "Everything in this folder will be committed and pushed.",
      ),
    ).toBeTruthy();
  });

  it("inside a bigger repo: says where, nothing else", () => {
    setup({ kind: "insideRepo", top: "C:\\" });
    expect(
      screen.getByText("This folder is inside the git repo at C:\\."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Remote URL")).toBeNull();
    expect(screen.queryByRole("button", { name: "Pull" })).toBeNull();
  });

  it("no git: only the install line", () => {
    const { container } = setup(repo(), {}, { available: false });
    expect(container.textContent).toBe("Install git to sync folders.");
  });

  it("loading: no spinner before 300ms", () => {
    vi.useFakeTimers();
    const { container } = setup(undefined);
    expect(container.querySelector('[data-icon="spinner"]')).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(container.querySelector('[data-icon="spinner"]')).toBeTruthy();
  });

  it("rebasing: says so, disables Pull/Push/Commit, still lists changes", () => {
    setup(
      repo({ dirty: true, state: "rebasing", ahead: 1 }),
      {},
      {
        changesOf: { [LIB]: [{ path: "a.md", status: "conflicted" }] },
      },
    );
    expect(screen.getByText("rebasing")).toBeTruthy();
    const commit = screen.getByRole("button", { name: "Commit & push" });
    for (const b of [pull(), push(), commit]) {
      expect(dis(b)).toBe(true);
      expect(b.title).toBe("Finish the rebase in a terminal first");
    }
    expect(screen.getByText("a.md")).toBeTruthy();
  });

  it("shows the error box under the branch row, dismissable", () => {
    const e = gitError({ kind: "rejected" });
    const { git } = setup(repo(), {}, { errors: { [LIB]: e } });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(errorCopy(e));
    fireEvent.click(within(alert).getByRole("button", { name: "Dismiss" }));
    expect(git.dismiss).toHaveBeenCalledWith(LIB);
  });
});

describe("GitView branch row", () => {
  it("shows the branch, or the short hash when detached", () => {
    const { unmount } = setup(repo());
    expect(screen.getByRole("button", { name: /main/ })).toBeTruthy();
    unmount();
    setup(repo({ branch: null, head: "abc1234" }));
    expect(screen.getByRole("button", { name: /abc1234/ })).toBeTruthy();
  });

  it("counts show only when non-zero", () => {
    const { unmount } = setup(repo({ behind: 1, ahead: 2 }));
    expect(screen.getByLabelText("1 behind").textContent).toBe("1");
    expect(screen.getByLabelText("2 ahead").textContent).toBe("2");
    unmount();
    setup(repo({ behind: 0, ahead: 3 }));
    expect(screen.queryByLabelText(/behind/)).toBeNull();
    expect(screen.getByLabelText("3 ahead")).toBeTruthy();
  });

  it("no origin: Pull and Push disabled with the remote tooltip", () => {
    setup(repo({ origin: false, upstream: false, dirty: true }));
    for (const b of [pull(), push()]) {
      expect(dis(b)).toBe(true);
      expect(b.title).toBe("No remote set up for this folder");
    }
  });

  it("origin without upstream: Pull disabled, Push runs", () => {
    const { git } = setup(repo({ upstream: false }));
    expect(dis(pull())).toBe(true);
    expect(pull().title).toBe(
      "Push first to connect this folder to its remote.",
    );
    fireEvent.click(push());
    expect(git.push).toHaveBeenCalledWith(LIB);
  });

  it("clean, nothing to push: Push is inert with its tooltip, Pull runs", () => {
    const { git } = setup(repo());
    fireEvent.click(push());
    expect(git.push).not.toHaveBeenCalled();
    expect(push().title).toBe("Nothing to push");
    fireEvent.click(pull());
    expect(git.pull).toHaveBeenCalledWith(LIB);
  });

  it("a running op disables both", () => {
    setup(repo({ ahead: 1 }), {}, { runningOf: { [LIB]: "commit" } });
    expect(dis(pull())).toBe(true);
    expect(dis(push())).toBe(true);
  });

  it("the branch button renders the branch menu slot", () => {
    const renderBranchMenu = vi.fn(({ close }: { close(): void }) => (
      <button type="button" onClick={close}>
        menu here
      </button>
    ));
    setup(repo(), { renderBranchMenu });
    expect(screen.queryByText("menu here")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /main/ }));
    expect(renderBranchMenu).toHaveBeenLastCalledWith(
      expect.objectContaining({ folder: LIB }),
    );
    fireEvent.click(screen.getByText("menu here"));
    expect(screen.queryByText("menu here")).toBeNull();
  });
});

describe("GitView ⋯ menu", () => {
  it("has Add folder from git… and Refresh", () => {
    const { git, p } = setup(repo());
    const more = () => screen.getByRole("button", { name: "Git actions" });
    fireEvent.click(more());
    expect(menuItems()).toEqual(["Add folder from git…", "Refresh"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Refresh" }));
    expect(git.refresh).toHaveBeenCalled();
    fireEvent.click(more());
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Add folder from git…" }),
    );
    expect(p.onAddFromGit).toHaveBeenCalledTimes(1);
  });
});

describe("GitView commit and changes", () => {
  it("passes unsaved files to the commit box and opens diffs", () => {
    const unsavedUnder = vi.fn(() => 2);
    const { p } = setup(
      repo({ dirty: true }),
      { unsavedUnder },
      { changesOf: { [LIB]: [{ path: "n.md", status: "modified" }] } },
    );
    expect(unsavedUnder).toHaveBeenCalledWith(LIB);
    expect(screen.getByText("2 unsaved files won't be included")).toBeTruthy();
    fireEvent.click(screen.getByText("n.md"));
    expect(p.onOpenDiff).toHaveBeenCalledWith({
      folder: LIB,
      path: "n.md",
      status: "modified",
    });
  });
});
