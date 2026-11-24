import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GitError } from "../git/api";
import { SetupSyncCard } from "./SetupSyncCard";

type Props = Parameters<typeof SetupSyncCard>[0];

function setup(over: Partial<Props> = {}) {
  const p: Props = {
    indent: 8,
    running: false,
    error: null,
    onSetUp: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  render(<SetupSyncCard {...p} />);
  return p;
}

const url = () => screen.getByLabelText("Remote URL");
const setUpButton = () => screen.getByRole("button", { name: "Set up" });

describe("SetupSyncCard", () => {
  it("shows the copy", () => {
    setup();
    expect(url()).toHaveAttribute(
      "placeholder",
      "git@github.com:you/notes.git",
    );
    expect(
      screen.getByText(
        "Create an empty repo on GitHub, GitLab or your server, then paste its URL.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Everything in this folder will be committed and pushed.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(url()).toHaveFocus();
  });

  it("submits_trimmed_url", () => {
    const p = setup();
    fireEvent.change(url(), { target: { value: "  git@x:me/n.git  " } });
    fireEvent.click(setUpButton());
    expect(p.onSetUp).toHaveBeenCalledWith("git@x:me/n.git");
    // Enter in the field submits too.
    fireEvent.keyDown(url(), { key: "Enter" });
    expect(p.onSetUp).toHaveBeenCalledTimes(2);
  });

  it("empty_url_disables_set_up", () => {
    const p = setup();
    expect(setUpButton()).toBeDisabled();
    fireEvent.change(url(), { target: { value: "   " } });
    expect(setUpButton()).toBeDisabled();
    fireEvent.keyDown(url(), { key: "Enter" });
    expect(p.onSetUp).not.toHaveBeenCalled();
  });

  it("escape_cancels", () => {
    const p = setup();
    fireEvent.keyDown(url(), { key: "Escape" });
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(p.onCancel).toHaveBeenCalledTimes(2);
  });

  it("running disables Set up and ignores Enter", () => {
    const p = setup({ running: true });
    fireEvent.change(url(), { target: { value: "git@x:me/n.git" } });
    expect(screen.getByRole("button", { name: "Setting up…" })).toBeDisabled();
    fireEvent.keyDown(url(), { key: "Enter" });
    expect(p.onSetUp).not.toHaveBeenCalled();
  });

  it("running_ignores_cancel_and_escape", () => {
    const p = setup({ running: true });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel);
    fireEvent.keyDown(url(), { key: "Escape" });
    expect(p.onCancel).not.toHaveBeenCalled();
  });

  it("shows an error with the shared copy", () => {
    const error: GitError = {
      kind: "repo_unreachable",
      detail: "fatal: could not read from remote",
      conflicts: null,
      committed: false,
    };
    setup({ error });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Couldn't reach that repo. Check the URL and your git credentials.",
    );
    expect(alert).toHaveTextContent("fatal: could not read from remote");
  });

  it("keeps keys and clicks inside", () => {
    const outerKey = vi.fn();
    const outerClick = vi.fn();
    render(
      <div onKeyDown={outerKey} onClick={outerClick}>
        <SetupSyncCard
          indent={8}
          running={false}
          error={null}
          onSetUp={vi.fn()}
          onCancel={vi.fn()}
        />
      </div>,
    );
    fireEvent.keyDown(screen.getByLabelText("Remote URL"), { key: "a" });
    fireEvent.click(screen.getByLabelText("Remote URL"));
    expect(outerKey).not.toHaveBeenCalled();
    expect(outerClick).not.toHaveBeenCalled();
  });
});
