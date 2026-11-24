import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));
type Listener = (e: { payload: unknown }) => void;
const listeners = new Map<string, Listener>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, cb: Listener) => {
    listeners.set(name, cb);
    return Promise.resolve(() => listeners.delete(name));
  }),
}));

import { DiffPane, REFRESH_DEBOUNCE_MS } from "./DiffPane";
import type { DiffTarget } from "../../model/types";
import type { HeadFile } from "../api";

const FOLDER = "C:\\L";
const fmt = { encoding: "utf-8", bom: false, lineEnding: "lf", mixed: false };

/** What each side reads as: disk `null` is a missing file. */
let head: HeadFile;
/** When set, HEAD answers per path (missing for the others). */
let headAt: Record<string, HeadFile> | null;
let disk: string | null | { error: string } | { unreadable: string };

beforeEach(() => {
  listeners.clear();
  invoke.mockReset();
  head = { kind: "text", text: "" };
  headAt = null;
  disk = "";
  invoke.mockImplementation((cmd: string, args?: { path: string }) => {
    switch (cmd) {
      case "git_head_file":
        return Promise.resolve(
          headAt ? (headAt[args!.path] ?? { kind: "missing" }) : head,
        );
      case "file_read":
        if (disk === null) {
          return Promise.reject({ kind: "io", message: "not found" });
        }
        if (typeof disk === "object" && "error" in disk) {
          return Promise.reject({ kind: disk.error, message: "big" });
        }
        return Promise.resolve({
          text: typeof disk === "string" ? disk : disk.unreadable,
          format: fmt,
          readable: typeof disk === "string",
          fingerprint: { mtimeMs: 1, size: 1, hash: "h" },
        });
      case "file_fingerprint":
        return Promise.resolve(disk === null ? null : undefined);
      default:
        return Promise.reject(new Error(`unexpected ${cmd}`));
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const calls = (cmd: string) =>
  invoke.mock.calls.filter((c) => c[0] === cmd).map((c) => c[1]);

function show(
  over: Partial<DiffTarget> = {},
  props: { refreshKey?: unknown; onOpenFile?: (p: string) => void } = {},
) {
  const target: DiffTarget = {
    folder: FOLDER,
    path: "notes/a.md",
    status: "modified",
    ...over,
  };
  const onOpenFile = props.onOpenFile ?? vi.fn();
  const r = render(
    <DiffPane
      target={target}
      fontSize={14}
      onOpenFile={onOpenFile}
      refreshKey={props.refreshKey}
    />,
  );
  return { ...r, target, onOpenFile };
}

const lines = (c: HTMLElement, sel: string) =>
  [...c.querySelectorAll(sel)].map((e) => e.textContent);

describe("DiffPane", () => {
  it("shows a modified file's deleted and inserted lines", async () => {
    head = { kind: "text", text: "one\ntwo\nthree\n" };
    disk = "one\nTWO\nthree\n";
    const { container } = show();
    await waitFor(() =>
      expect(lines(container, ".cm-deletedLine")).toEqual(["two"]),
    );
    expect(lines(container, ".cm-changedLine")).toEqual(["TWO"]);
    expect(calls("git_head_file")).toEqual([
      { folder: FOLDER, path: "notes/a.md" },
    ]);
    expect(calls("file_read")).toEqual([{ path: "C:\\L\\notes\\a.md" }]);
  });

  it("shows an added file as all inserted", async () => {
    head = { kind: "missing" };
    disk = "new\nfile\n";
    const { container } = show({ status: "added" });
    await waitFor(() =>
      expect(lines(container, ".cm-changedLine")).toEqual(["new", "file"]),
    );
    expect(lines(container, ".cm-deletedLine")).toEqual([]);
    // Nothing to compare words with: no changed-word marks.
    expect(container.querySelector(".cm-changedText")).toBeNull();
  });

  it("marks the changed words in a modified line", async () => {
    head = { kind: "text", text: "after 30s\n" };
    disk = "after 31s\n";
    const { container } = show();
    await waitFor(() =>
      expect(container.querySelector(".cm-changedText")).not.toBeNull(),
    );
  });

  it("shows a deleted file as all deleted, with no Open file", async () => {
    head = { kind: "text", text: "gone\nnow\n" };
    disk = null;
    const { container } = show({ status: "deleted" });
    await waitFor(() =>
      expect(lines(container, ".cm-deletedLine")).toEqual(["gone", "now"]),
    );
    expect(lines(container, ".cm-changedLine")).toEqual([]);
    expect(screen.queryByRole("button", { name: "Open file" })).toBeNull();
  });

  it("says a binary file changed, with Open file", async () => {
    head = { kind: "binary" };
    disk = "x";
    const { onOpenFile } = show();
    expect(await screen.findByText("Binary file changed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));
    expect(onOpenFile).toHaveBeenCalledWith("C:\\L\\notes\\a.md");
  });

  it("says a file not readable as text is binary", async () => {
    head = { kind: "text", text: "a" };
    disk = { unreadable: "\u0000" };
    show();
    expect(await screen.findByText("Binary file changed")).toBeTruthy();
  });

  it("says either side over 1 MB is too large", async () => {
    head = { kind: "tooLarge" };
    disk = "small";
    const a = show();
    expect(
      await screen.findByText("Too large to show (over 1 MB)"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open file" })).toBeTruthy();
    a.unmount();

    head = { kind: "text", text: "small" };
    disk = { error: "too_large" };
    const b = show();
    expect(
      await screen.findByText("Too large to show (over 1 MB)"),
    ).toBeTruthy();
    b.unmount();

    disk = "x".repeat(1_048_577);
    show();
    expect(
      await screen.findByText("Too large to show (over 1 MB)"),
    ).toBeTruthy();
  });

  it("says there are no changes when both sides match", async () => {
    head = { kind: "text", text: "same\n" };
    disk = "same\n";
    show();
    expect(
      await screen.findByText("No changes since the last commit."),
    ).toBeTruthy();
  });

  it("diffLines ignores CR-only differences", async () => {
    head = { kind: "text", text: "one\r\ntwo\r\n" };
    disk = "one\ntwo\n";
    show();
    expect(
      await screen.findByText("No changes since the last commit."),
    ).toBeTruthy();
  });

  it("reads HEAD at the old path of a rename", async () => {
    head = { kind: "text", text: "x\n" };
    disk = "x\ny\n";
    show({ status: "renamed", path: "new.md", oldPath: "old/name.md" });
    await waitFor(() =>
      expect(calls("git_head_file")).toEqual([
        { folder: FOLDER, path: "old/name.md" },
      ]),
    );
    expect(calls("file_read")).toEqual([{ path: "C:\\L\\new.md" }]);
  });

  it("reads HEAD at the new path once the rename is committed", async () => {
    headAt = { "new.md": { kind: "text", text: "x\n" } };
    disk = "x\ny\n";
    const { container } = show({
      status: "renamed",
      path: "new.md",
      oldPath: "old.md",
    });
    await waitFor(() =>
      expect(lines(container, ".cm-changedLine")).toEqual(["y"]),
    );
    expect(lines(container, ".cm-deletedLine")).toEqual([]);
    expect(calls("git_head_file")).toEqual([
      { folder: FOLDER, path: "old.md" },
      { folder: FOLDER, path: "new.md" },
    ]);
  });

  it("shows Open file once a deleted file is back on disk", async () => {
    head = { kind: "text", text: "a\n" };
    disk = null;
    const { rerender, target, onOpenFile } = show(
      { status: "deleted" },
      { refreshKey: 1 },
    );
    await waitFor(() => expect(calls("file_read")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Open file" })).toBeNull();
    disk = "b\n";
    rerender(
      <DiffPane
        target={target}
        fontSize={14}
        onOpenFile={onOpenFile}
        refreshKey={2}
      />,
    );
    expect(
      await screen.findByRole("button", { name: "Open file" }),
    ).toBeTruthy();
  });

  it("passes an odd file name through unchanged", async () => {
    const path = 'notes/日本 plan "v2".md';
    head = { kind: "text", text: "a\n" };
    disk = "b\n";
    const { onOpenFile } = show({ path });
    await waitFor(() =>
      expect(calls("git_head_file")).toEqual([{ folder: FOLDER, path }]),
    );
    const onDisk = 'C:\\L\\notes\\日本 plan "v2".md';
    expect(calls("file_read")).toEqual([{ path: onDisk }]);
    fireEvent.click(await screen.findByRole("button", { name: "Open file" }));
    expect(onOpenFile).toHaveBeenCalledWith(onDisk);
  });

  it("reads both sides again when its folder changes on disk", async () => {
    head = { kind: "text", text: "a\n" };
    disk = "b\n";
    show();
    await waitFor(() => expect(calls("file_read")).toHaveLength(1));
    await waitFor(() =>
      expect(listeners.has("zukai://library-changed")).toBe(true),
    );
    vi.useFakeTimers();
    disk = "a\n";
    const fire = (dirs: string[]) =>
      act(() =>
        listeners.get("zukai://library-changed")!({ payload: { dirs } }),
      );
    // Another folder: nothing to read.
    fire(["C:\\Other"]);
    await act(async () => {
      vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 2);
    });
    expect(calls("file_read")).toHaveLength(1);
    // A burst in its folder reads once, after the debounce.
    fire(["C:\\L\\notes"]);
    fire(["C:\\L"]);
    await act(async () => {
      vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS - 1);
    });
    expect(calls("file_read")).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    vi.useRealTimers();
    await waitFor(() => expect(calls("file_read")).toHaveLength(2));
    expect(calls("git_head_file")).toHaveLength(2);
    expect(
      await screen.findByText("No changes since the last commit."),
    ).toBeTruthy();
  });

  it("keeps its scroll position when the diff text changes", async () => {
    // jsdom doesn't scroll: remember what's set.
    const scrolled = new WeakMap<Element, number>();
    const desc = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollTop",
    );
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      get(this: Element) {
        return scrolled.get(this) ?? 0;
      },
      set(this: Element, v: number) {
        scrolled.set(this, v);
      },
    });
    try {
      head = { kind: "text", text: "a\n" };
      disk = "b\n";
      const { container, rerender, target, onOpenFile } = show(
        {},
        { refreshKey: 1 },
      );
      await waitFor(() =>
        expect(lines(container, ".cm-changedLine")).toEqual(["b"]),
      );
      container.querySelector<HTMLElement>(".cm-scroller")!.scrollTop = 120;
      disk = "c\n";
      rerender(
        <DiffPane
          target={target}
          fontSize={14}
          onOpenFile={onOpenFile}
          refreshKey={2}
        />,
      );
      await waitFor(() =>
        expect(lines(container, ".cm-changedLine")).toEqual(["c"]),
      );
      expect(container.querySelector(".cm-scroller")!.scrollTop).toBe(120);
    } finally {
      if (desc) Object.defineProperty(Element.prototype, "scrollTop", desc);
    }
  });

  it("reads both sides again when the folder's git status changes", async () => {
    head = { kind: "text", text: "a\n" };
    disk = "b\n";
    const { rerender, target, onOpenFile } = show({}, { refreshKey: 1 });
    await waitFor(() => expect(calls("file_read")).toHaveLength(1));
    head = { kind: "text", text: "b\n" };
    rerender(
      <DiffPane
        target={target}
        fontSize={14}
        onOpenFile={onOpenFile}
        refreshKey={2}
      />,
    );
    await waitFor(() => expect(calls("git_head_file")).toHaveLength(2));
    expect(calls("file_read")).toHaveLength(2);
    expect(
      await screen.findByText("No changes since the last commit."),
    ).toBeTruthy();
  });
});
