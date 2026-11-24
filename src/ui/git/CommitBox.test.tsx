import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RepoStatus } from "../../git/api";
import { defaultCommitMessage } from "../../git/messages";
import type { GitSyncApi } from "../../git/useGitSync";
import { CommitBox } from "./CommitBox";
import { REPO, fakeGit, gitError } from "./testing";

const FOLDER = "C:\\Lib";

function props(git: GitSyncApi, status: Partial<RepoStatus> = {}, unsaved = 0) {
  return {
    git,
    folder: FOLDER,
    status: { ...REPO, dirty: true, ...status },
    unsaved,
    onSaveAll: vi.fn(),
  };
}

function setup(status: Partial<RepoStatus> = {}, unsaved = 0) {
  const git = fakeGit();
  const p = props(git, status, unsaved);
  const utils = render(<CommitBox {...p} />);
  return { git, p, ...utils };
}

const field = () =>
  screen.getByLabelText("Commit message") as HTMLTextAreaElement;
const button = (name: RegExp = /^Commit/) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

describe("CommitBox", () => {
  it("placeholder is the default message; an empty submit uses it", () => {
    const { git } = setup();
    expect(field().placeholder).toBe(defaultCommitMessage(new Date()));
    expect(field().value).toBe("");
    fireEvent.click(button());
    expect(git.commit).toHaveBeenCalledWith(
      FOLDER,
      defaultCommitMessage(new Date()),
    );
  });

  it("Ctrl+Enter and Meta+Enter commit; plain Enter does not", () => {
    const { git } = setup();
    fireEvent.change(field(), { target: { value: "first line" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(git.commit).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Enter", ctrlKey: true });
    expect(git.commit).toHaveBeenCalledWith(FOLDER, "first line");
    fireEvent.keyDown(field(), { key: "Enter", metaKey: true });
    expect(git.commit).toHaveBeenCalledTimes(2);
  });

  it("is multi-line", () => {
    setup();
    expect(field().tagName).toBe("TEXTAREA");
  });

  it("reads Commit & push with origin, Commit without", () => {
    const { unmount } = setup();
    expect(button().textContent).toBe("Commit & push");
    unmount();
    setup({ origin: false, upstream: false });
    expect(button().textContent).toBe("Commit");
  });

  it("is disabled when there's nothing to commit", () => {
    const { git } = setup({ dirty: false, ahead: 1 });
    expect(button().disabled).toBe(true);
    fireEvent.keyDown(field(), { key: "Enter", ctrlKey: true });
    expect(git.commit).not.toHaveBeenCalled();
  });

  it("is disabled while an op runs and during a rebase", () => {
    const git = fakeGit({ runningOf: { [FOLDER]: "pull" } });
    const { rerender } = render(<CommitBox {...props(git)} />);
    expect(button().disabled).toBe(true);
    rerender(<CommitBox {...props(fakeGit(), { state: "rebasing" })} />);
    expect(button().disabled).toBe(true);
    expect(button().title).toBe("Finish the rebase in a terminal first");
  });

  it("clears the message after a successful commit", () => {
    const git = fakeGit();
    const { rerender } = render(<CommitBox {...props(git)} />);
    fireEvent.change(field(), { target: { value: "work" } });
    fireEvent.click(button());
    const done = fakeGit({ doneOf: { [FOLDER]: "commit" } });
    rerender(<CommitBox {...props(done, { dirty: false })} />);
    expect(field().value).toBe("");
  });

  it("clears it when the commit landed but the push failed", () => {
    const git = fakeGit();
    const { rerender } = render(<CommitBox {...props(git)} />);
    fireEvent.change(field(), { target: { value: "work" } });
    fireEvent.click(button());
    const failed = fakeGit({
      errors: { [FOLDER]: gitError({ kind: "network", committed: true }) },
    });
    rerender(<CommitBox {...props(failed, { dirty: false })} />);
    expect(field().value).toBe("");
  });

  it("keeps the message after a failed commit", () => {
    const git = fakeGit();
    const { rerender } = render(<CommitBox {...props(git)} />);
    fireEvent.change(field(), { target: { value: "work" } });
    fireEvent.click(button());
    const failed = fakeGit({ errors: { [FOLDER]: gitError() } });
    rerender(<CommitBox {...props(failed)} />);
    expect(field().value).toBe("work");
  });

  it("notes unsaved files with Save all", () => {
    const { p } = setup({}, 2);
    expect(screen.getByText("2 unsaved files won't be included")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    expect(p.onSaveAll).toHaveBeenCalledTimes(1);
  });

  it("says nothing about unsaved files when there are none", () => {
    setup({}, 0);
    expect(screen.queryByText(/unsaved/)).toBeNull();
  });
});
