import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { useGitSync } from "./useGitSync";

const repo = {
  kind: "repo",
  branch: "main",
  head: "abc",
  dirty: true,
  upstream: true,
  origin: true,
  ahead: 0,
  behind: 0,
  state: "none",
};

let commitResult: () => Promise<null>;

beforeEach(() => {
  invoke.mockReset();
  commitResult = () => Promise.resolve(null);
  invoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "git_set_enabled":
        return Promise.resolve({ available: true });
      case "git_status":
        return Promise.resolve(repo);
      case "git_commit_push":
        return commitResult();
      default:
        return Promise.resolve(null);
    }
  });
});

const calls = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd);

describe("useGitSync", () => {
  it("disabled_runs_no_git_commands", async () => {
    const { result } = renderHook(() =>
      useGitSync({ enabled: false, folders: ["/a", "/b"] }),
    );
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(invoke.mock.calls).toEqual([
      ["git_set_enabled", { enabled: false }],
    ]);
    expect(result.current.status("/a")).toBeUndefined();
  });

  it("fetches_status_per_folder", async () => {
    const { result } = renderHook(() =>
      useGitSync({ enabled: true, folders: ["/a", "/b"] }),
    );
    await waitFor(() => expect(result.current.status("/b")).toEqual(repo));
    expect(invoke.mock.calls[0]).toEqual([
      "git_set_enabled",
      { enabled: true },
    ]);
    expect(calls("git_status").map((c) => c[1])).toEqual([
      { folder: "/a" },
      { folder: "/b" },
    ]);
    expect(result.current.available).toBe(true);
  });

  it("refreshes_on_focus", async () => {
    const { result } = renderHook(() =>
      useGitSync({ enabled: true, folders: ["/a"] }),
    );
    await waitFor(() => expect(result.current.status("/a")).toEqual(repo));
    const before = calls("git_status").length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(calls("git_status").length).toBe(before + 1));
  });

  it("commit_sets_running_then_justDone", async () => {
    let release: () => void = () => {};
    commitResult = () =>
      new Promise((r) => {
        release = () => r(null);
      });
    const { result } = renderHook(() =>
      useGitSync({ enabled: true, folders: ["/a"] }),
    );
    await waitFor(() => expect(result.current.status("/a")).toEqual(repo));
    let p: Promise<void> = Promise.resolve();
    act(() => {
      p = result.current.commit("/a", "msg");
    });
    expect(result.current.running("/a")).toBe("commit");
    await act(async () => {
      release();
      await p;
    });
    expect(result.current.running("/a")).toBeNull();
    expect(result.current.justDone("/a")).toBe("commit");
    expect(calls("git_commit_push")[0][1]).toEqual({
      folder: "/a",
      message: "msg",
    });
    await waitFor(() => expect(result.current.justDone("/a")).toBeNull(), {
      timeout: 2500,
    });
  });

  it("an empty commit message only pushes", async () => {
    const { result } = renderHook(() =>
      useGitSync({ enabled: true, folders: ["/a"] }),
    );
    await waitFor(() => expect(result.current.status("/a")).toEqual(repo));
    await act(async () => {
      await result.current.commit("/a", "");
    });
    expect(calls("git_push")).toHaveLength(1);
    expect(calls("git_commit_push")).toHaveLength(0);
  });

  it("error_kept_until_dismiss_or_next_op", async () => {
    const rejected = {
      kind: "rejected",
      detail: "",
      conflicts: null,
      committed: false,
    };
    commitResult = () => Promise.reject(rejected);
    const { result } = renderHook(() =>
      useGitSync({ enabled: true, folders: ["/a"] }),
    );
    await waitFor(() => expect(result.current.status("/a")).toEqual(repo));
    await act(async () => {
      await result.current.commit("/a", "m");
    });
    expect(result.current.error("/a")).toEqual(rejected);
    act(() => result.current.dismiss("/a"));
    expect(result.current.error("/a")).toBeNull();

    await act(async () => {
      await result.current.commit("/a", "m");
    });
    expect(result.current.error("/a")).toEqual(rejected);
    commitResult = () => Promise.resolve(null);
    await act(async () => {
      await result.current.commit("/a", "m");
    });
    expect(result.current.error("/a")).toBeNull();
  });

  it("stays enabled until a running op settles", async () => {
    let release: () => void = () => {};
    commitResult = () =>
      new Promise((r) => {
        release = () => r(null);
      });
    const { result, rerender } = renderHook(
      (p: { enabled: boolean }) => useGitSync({ ...p, folders: ["/a"] }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.status("/a")).toEqual(repo));
    let p: Promise<void> = Promise.resolve();
    act(() => {
      p = result.current.commit("/a", "m");
    });
    rerender({ enabled: false });
    expect(result.current.enabled).toBe(true);
    expect(calls("git_set_enabled")).toHaveLength(1);
    await act(async () => {
      release();
      await p;
    });
    await waitFor(() => expect(result.current.enabled).toBe(false));
    expect(calls("git_set_enabled")[1][1]).toEqual({ enabled: false });
    expect(result.current.status("/a")).toBeUndefined();
  });
});
