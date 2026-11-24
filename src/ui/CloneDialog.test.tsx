import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../git/api";
import type { GitError, PickedParent } from "../git/api";
import { CloneDialog } from "./CloneDialog";

vi.mock("../git/api", async (orig) => ({
  ...(await orig<typeof import("../git/api")>()),
  gitPickCloneParent: vi.fn(),
}));

const pick = vi.mocked(api.gitPickCloneParent);
const PARENT: PickedParent = { token: "t", path: "C:\\notes parent" };

type Props = Parameters<typeof CloneDialog>[0];

function setup(over: Partial<Props> = {}) {
  const p: Props = { onClone: vi.fn(), onCancel: vi.fn(), ...over };
  render(<CloneDialog {...p} />);
  return p;
}

const urlField = () => screen.getByLabelText("Repo URL");
const nameField = () => screen.getByLabelText("Folder name");
const dest = () => screen.getByLabelText("Destination");
const cloneButton = () => screen.getByRole("button", { name: "Clone" });
const libraryBox = () => screen.getByLabelText("Use as my Library");
const type = (el: HTMLElement, value: string) =>
  fireEvent.change(el, { target: { value } });

async function chooseLocation() {
  pick.mockResolvedValue(PARENT);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Choose location…" }));
  });
}

// Not mockReset: under Vitest 5 it makes a later rejecting mock fail the test.
beforeEach(() => {
  pick.mockClear();
});

describe("CloneDialog", () => {
  it("is a labelled dialog with the URL focused", () => {
    setup();
    const d = screen.getByRole("dialog", { name: "Add folder from git" });
    expect(d).toHaveAttribute("aria-modal", "true");
    expect(urlField()).toHaveFocus();
    expect(urlField()).toHaveAttribute("id");
    expect(libraryBox()).not.toBeChecked();
  });

  it("name_follows_url_until_edited", () => {
    setup();
    type(urlField(), "git@github.com:me/notes.git");
    expect(nameField()).toHaveValue("notes");
    type(urlField(), "https://h/me/journal");
    expect(nameField()).toHaveValue("journal");
    type(nameField(), "mine");
    type(urlField(), "https://h/me/other.git");
    expect(nameField()).toHaveValue("mine");
  });

  it("clone_disabled_until_url_parent_name", async () => {
    const p = setup();
    expect(cloneButton()).toBeDisabled();
    type(urlField(), "git@github.com:me/notes.git");
    expect(cloneButton()).toBeDisabled();
    await chooseLocation();
    expect(cloneButton()).toBeEnabled();
    type(nameField(), "  ");
    expect(cloneButton()).toBeDisabled();
    fireEvent.keyDown(urlField(), { key: "Enter" });
    expect(p.onClone).not.toHaveBeenCalled();
    type(nameField(), "notes");
    type(urlField(), "   ");
    expect(cloneButton()).toBeDisabled();
  });

  it("choose_location_shows_destination", async () => {
    setup();
    expect(dest()).toHaveValue("");
    type(urlField(), "git@github.com:me/notes.git");
    await chooseLocation();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(dest()).toHaveValue("C:\\notes parent\\notes");
    expect(dest()).toHaveAttribute("readonly");
    // A cancelled picker keeps the last choice.
    pick.mockResolvedValue(null);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choose location…" }));
    });
    expect(dest()).toHaveValue("C:\\notes parent\\notes");
  });

  it("a failing picker shows its error", async () => {
    setup();
    pick.mockRejectedValue({
      kind: "no_git",
      detail: "",
      conflicts: null,
      committed: false,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choose location…" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Git failed.");
  });

  it("reopens_with_error_and_fields", () => {
    const error: GitError = {
      kind: "dest_exists",
      detail: "",
      conflicts: null,
      committed: false,
    };
    const p = setup({
      initial: {
        url: "git@github.com:me/notes.git",
        name: "mine",
        useAsLibrary: true,
        parent: PARENT,
        error,
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A folder with that name already exists there.",
    );
    expect(urlField()).toHaveValue("git@github.com:me/notes.git");
    expect(nameField()).toHaveValue("mine");
    expect(libraryBox()).toBeChecked();
    expect(dest()).toHaveValue("C:\\notes parent\\mine");
    // The name was edited: it no longer follows the URL.
    type(urlField(), "git@github.com:me/other.git");
    expect(nameField()).toHaveValue("mine");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(cloneButton());
    expect(p.onClone).toHaveBeenCalledWith(
      {
        token: "t",
        url: "git@github.com:me/other.git",
        name: "mine",
        useAsLibrary: true,
      },
      { name: "mine", parent: PARENT },
    );
  });

  it("use_as_library_passed_through", async () => {
    const p = setup();
    type(urlField(), "  git@github.com:me/notes.git ");
    await chooseLocation();
    fireEvent.click(cloneButton());
    expect(p.onClone).toHaveBeenLastCalledWith(
      {
        token: "t",
        url: "git@github.com:me/notes.git",
        name: "notes",
        useAsLibrary: false,
      },
      { name: "notes", parent: PARENT },
    );
    fireEvent.click(libraryBox());
    // Enter in a field clones too.
    fireEvent.keyDown(urlField(), { key: "Enter" });
    expect(p.onClone).toHaveBeenLastCalledWith(
      expect.objectContaining({ useAsLibrary: true }),
      { name: "notes", parent: PARENT },
    );
  });

  it("escape and Cancel cancel; keys stay inside", () => {
    const outer = vi.fn();
    const onCancel = vi.fn();
    render(
      <div onKeyDown={outer}>
        <CloneDialog onClone={vi.fn()} onCancel={onCancel} />
      </div>,
    );
    fireEvent.keyDown(urlField(), { key: "a" });
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(urlField(), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
