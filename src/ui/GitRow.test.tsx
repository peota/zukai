import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitError, RepoStatus } from "../git/api";
import { GitRow } from "./GitRow";

const base: RepoStatus = {
  branch: "main",
  head: "abc1234",
  dirty: false,
  upstream: true,
  origin: true,
  ahead: 0,
  behind: 0,
  state: "none",
};

type Props = Parameters<typeof GitRow>[0];

function fnProps() {
  return {
    onPull: vi.fn(),
    onCommit: vi.fn(),
    onPush: vi.fn(),
    onSaveAll: vi.fn(),
    onDismiss: vi.fn(),
  };
}

function props(status: Partial<RepoStatus>, over: Partial<Props>): Props {
  return {
    name: "notes",
    status: { ...base, ...status },
    running: null,
    justDone: null,
    error: null,
    unsaved: 0,
    indent: 24,
    ...fnProps(),
    ...over,
  };
}

function setup(status: Partial<RepoStatus> = {}, over: Partial<Props> = {}) {
  const p = props(status, over);
  const utils = render(<GitRow {...p} />);
  return {
    ...p,
    ...utils,
    pull: () => screen.getByRole("button", { name: "Pull" }),
    commit: () => screen.getByRole("button", { name: "Commit" }),
    push: () => screen.getByRole("button", { name: "Push" }),
  };
}

const dis = (b: HTMLElement) =>
  (b as HTMLButtonElement).disabled ||
  b.getAttribute("aria-disabled") === "true";

afterEach(() => vi.useRealTimers());

describe("GitRow enablement", () => {
  it("running disables all three", () => {
    const s = setup({ dirty: true }, { running: "pull" });
    expect(dis(s.pull())).toBe(true);
    expect(dis(s.commit())).toBe(true);
    expect(dis(s.push())).toBe(true);
  });

  it("rebase state disables all with the terminal tooltip on Pull", () => {
    const s = setup({ state: "rebasing" });
    expect(dis(s.pull())).toBe(true);
    expect(dis(s.commit())).toBe(true);
    expect(dis(s.push())).toBe(true);
    expect(s.pull().title).toBe("Finish the rebase in a terminal first");
    expect(screen.getByText(/rebasing/)).toBeTruthy();
  });

  it("no origin: pull and push disabled with the remote tooltip, commit enabled", () => {
    const s = setup({ origin: false, upstream: false, dirty: true });
    expect(dis(s.pull())).toBe(true);
    expect(dis(s.push())).toBe(true);
    expect(s.pull().title).toBe("No remote set up for this folder");
    expect(s.push().title).toBe("No remote set up for this folder");
    expect(dis(s.commit())).toBe(false);
  });

  it("origin without upstream: pull disabled, commit and push enabled", () => {
    const s = setup({ upstream: false });
    expect(dis(s.pull())).toBe(true);
    expect(dis(s.push())).toBe(false);
    fireEvent.click(s.push());
    expect(s.onPush).toHaveBeenCalledTimes(1);
  });

  it("dirty: pull and push enabled, commit opens the card", () => {
    const s = setup({ dirty: true });
    fireEvent.click(s.pull());
    fireEvent.click(s.push());
    expect(s.onPull).toHaveBeenCalledTimes(1);
    expect(s.onPush).toHaveBeenCalledTimes(1);
    fireEvent.click(s.commit());
    expect(screen.getByLabelText("Commit message")).toBeTruthy();
    expect(s.onCommit).not.toHaveBeenCalled();
  });

  it("clean and ahead: commit goes straight to push-only", () => {
    const s = setup({ ahead: 2 });
    fireEvent.click(s.commit());
    expect(s.onCommit).toHaveBeenCalledWith("");
    expect(screen.queryByLabelText("Commit message")).toBeNull();
    fireEvent.click(s.push());
    expect(s.onPush).toHaveBeenCalledTimes(1);
  });

  it("clean and not ahead: commit and push do nothing with tooltips", () => {
    const s = setup();
    fireEvent.click(s.commit());
    fireEvent.click(s.push());
    expect(s.onCommit).not.toHaveBeenCalled();
    expect(s.onPush).not.toHaveBeenCalled();
    expect(s.commit().title).toBe("Nothing to commit");
    expect(s.push().title).toBe("Nothing to push");
    fireEvent.click(s.pull());
    expect(s.onPull).toHaveBeenCalledTimes(1);
  });
});

describe("GitRow display", () => {
  it("shows_dirty_dot_only_when_dirty", () => {
    const { unmount } = setup({ dirty: true });
    expect(screen.getByTitle("Uncommitted changes")).toBeTruthy();
    unmount();
    setup();
    expect(screen.queryByTitle("Uncommitted changes")).toBeNull();
  });

  it("detached_shows_head", () => {
    setup({ branch: null });
    expect(screen.getByText("head")).toBeTruthy();
  });

  it("shows a spinner while running and a check when just done", () => {
    const { container, rerender } = setup({}, { running: "pull" });
    const spin = container.querySelector('[data-icon="spinner"]');
    expect(spin).toBeTruthy();
    expect(spin?.getAttribute("class")).toContain("motion-reduce:animate-none");
    rerender(<GitRow {...props({}, { justDone: "push" })} />);
    expect(
      screen
        .getByRole("button", { name: "Push" })
        .querySelector('[data-icon="check"]'),
    ).toBeTruthy();
  });
});

describe("GitRow commit card", () => {
  it("commit_card_prefills_and_submits_on_enter", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 24, 12, 0, 0));
    const s = setup({ dirty: true });
    fireEvent.click(s.commit());
    const input = screen.getByLabelText("Commit message") as HTMLInputElement;
    expect(input.value).toBe("Sync 2026-11-24");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(s.onCommit).toHaveBeenCalledWith("Sync 2026-11-24");
    expect(screen.queryByLabelText("Commit message")).toBeNull();
  });

  it("escape_closes_card_without_commit", () => {
    const s = setup({ dirty: true });
    fireEvent.click(s.commit());
    fireEvent.keyDown(screen.getByLabelText("Commit message"), {
      key: "Escape",
    });
    expect(screen.queryByLabelText("Commit message")).toBeNull();
    expect(s.onCommit).not.toHaveBeenCalled();
  });

  it("empty_message_disables_submit", () => {
    const s = setup({ dirty: true });
    fireEvent.click(s.commit());
    const input = screen.getByLabelText("Commit message");
    fireEvent.change(input, { target: { value: "   " } });
    const submit = screen.getByRole("button", { name: "Commit changes" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(s.onCommit).not.toHaveBeenCalled();
  });

  it("submit button commits the typed message", () => {
    const s = setup({ dirty: true });
    fireEvent.click(s.commit());
    fireEvent.change(screen.getByLabelText("Commit message"), {
      target: { value: "my note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit changes" }));
    expect(s.onCommit).toHaveBeenCalledWith("my note");
  });

  it("unsaved_line_and_save_all", () => {
    const s = setup({ dirty: true }, { unsaved: 2 });
    fireEvent.click(s.commit());
    expect(screen.getByText("2 unsaved files won't be included")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    expect(s.onSaveAll).toHaveBeenCalledTimes(1);
  });

  it("no unsaved line when everything is saved", () => {
    const s = setup({ dirty: true });
    fireEvent.click(s.commit());
    expect(screen.queryByText(/unsaved/)).toBeNull();
  });

  it("closes on blur to outside", () => {
    const s = setup({ dirty: true });
    fireEvent.click(s.commit());
    act(() => {
      fireEvent.blur(screen.getByLabelText("Commit message"), {
        relatedTarget: document.body,
      });
    });
    expect(screen.queryByLabelText("Commit message")).toBeNull();
  });
});

describe("GitRow error", () => {
  it("error_shows_copy_detail_and_dismiss", () => {
    const error: GitError = {
      kind: "rejected",
      detail: "! [rejected] main -> main",
      conflicts: null,
      committed: false,
    };
    const s = setup({}, { error });
    expect(screen.getByRole("alert").textContent).toContain(
      "The remote has newer changes",
    );
    expect(screen.getByText("! [rejected] main -> main").className).toContain(
      "font-mono",
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(s.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not leak keys or clicks to the tree", () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer} onClick={outer}>
        <GitRow {...props({ dirty: true }, {})} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pull" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Pull" }), {
      key: "ArrowDown",
    });
    expect(outer).not.toHaveBeenCalled();
  });
});
