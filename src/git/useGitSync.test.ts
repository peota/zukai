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

  it("unknown_setting_sends_nothing_until_known", async () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean | null }) =>
        useGitSync({ enabled, folders: ["/a"] }),
      { initialProps: { enabled: null as boolean | null } },
    );
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(invoke).not.toHaveBeenCalled();
    rerender({ enabled: false });
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls).toEqual([
      ["git_set_enabled", { enabled: false }],
    ]);
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

  it("reads status again after toggling off and on", async () => {
    const { result, rerender } = renderHook(
      (p: { enabled: boolean }) => useGitSync({ ...p, folders: ["/a", "/b"] }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.status("/b")).toEqual(repo));
    rerender({ enabled: false });
    await waitFor(() => expect(result.current.enabled).toBe(false));
    // Rust's gate stays shut until its answer to the second enable.
    let open = false;
    let release: () => void = () => {};
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "git_set_enabled") {
        return new Promise((r) => {
          release = () => {
            open = true;
            r({ available: true });
          };
        });
      }
      if (cmd === "git_status") {
        return open
          ? Promise.resolve(repo)
          : Promise.reject({ kind: "disabled", detail: "" });
      }
      return Promise.resolve(null);
    });
    const before = calls("git_status").length;
    rerender({ enabled: true });
    await act(async () => {});
    expect(calls("git_status").length).toBe(before);
    await act(async () => {
      release();
    });
    await waitFor(() => {
      expect(result.current.status("/a")).toEqual(repo);
      expect(result.current.status("/b")).toEqual(repo);
    });
    expect(calls("git_status").length).toBe(before + 2);
  });

  it("applies only the latest status response per folder", async () => {
    const { result } = renderHook(() =>
      useGitSync({ enabled: true, folders: ["/a"] }),
    );
    await waitFor(() => expect(result.current.status("/a")).toEqual(repo));
    const resolvers: ((v: unknown) => void)[] = [];
    invoke.mockImplementation((cmd: string) =>
      cmd === "git_status"
        ? new Promise((r) => resolvers.push(r))
        : Promise.resolve(null),
    );
    act(() => {
      result.current.refresh("/a");
      result.current.refresh("/a");
    });
    await act(async () => {
      resolvers[1]({ ...repo, head: "second" });
    });
    await act(async () => {
      resolvers[0]({ ...repo, head: "first" });
    });
    expect((result.current.status("/a") as { head: string }).head).toBe(
      "second",
    );
  });

  it("keeps the last status on a transient failure", async () => {
    const { result } = renderHook(() =>
      useGitSync({ enabled: true, folders: ["/a"] }),
    );
    await waitFor(() => expect(result.current.status("/a")).toEqual(repo));
    invoke.mockImplementation((cmd: string) =>
      cmd === "git_status"
        ? Promise.reject({ kind: "timeout", detail: "" })
        : Promise.resolve(null),
    );
    await act(async () => {
      result.current.refresh("/a");
    });
    expect(result.current.status("/a")).toEqual(repo);
    invoke.mockImplementation((cmd: string) =>
      cmd === "git_status"
        ? Promise.reject({ kind: "not_allowed", detail: "" })
        : Promise.resolve(null),
    );
    await act(async () => {
      result.current.refresh("/a");
    });
    await waitFor(() => expect(result.current.status("/a")).toBeUndefined());
  });

  it("ignores an op on a folder that is already running", async () => {
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
      p = result.current.commit("/a", "m");
    });
    await act(async () => {
      await result.current.push("/a");
    });
    expect(calls("git_push")).toHaveLength(0);
    expect(result.current.running("/a")).toBe("commit");
    await act(async () => {
      release();
      await p;
    });
    expect(result.current.running("/a")).toBeNull();
  });

  it("refreshes on a library change, debounced by a second", async () => {
    let changed: (e: unknown) => void = () => {};
    const ev = await import("@tauri-apps/api/event");
    vi.mocked(ev.listen).mockImplementation(((
      _n: string,
      cb: (e: unknown) => void,
    ) => {
      changed = cb;
      return Promise.resolve(() => {});
    }) as never);
    const { result } = renderHook(() =>
      useGitSync({ enabled: true, folders: ["/a"] }),
    );
    await waitFor(() => expect(result.current.status("/a")).toEqual(repo));
    vi.useFakeTimers();
    try {
      const before = calls("git_status").length;
      changed({ payload: { dirs: [] } });
      changed({ payload: { dirs: [] } });
      await vi.advanceTimersByTimeAsync(900);
      expect(calls("git_status").length).toBe(before);
      await vi.advanceTimersByTimeAsync(200);
      expect(calls("git_status").length).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("changes and branches", () => {
    const branches = { current: "main", local: [], remoteOnly: [] };
    beforeEach(() => {
      const base = invoke.getMockImplementation()!;
      invoke.mockImplementation((cmd: string, a?: unknown) => {
        if (cmd === "git_changes") return Promise.resolve([]);
        if (cmd === "git_branches") return Promise.resolve(branches);
        return base(cmd, a);
      });
    });
    const detailCalls = () => [
      ...calls("git_changes"),
      ...calls("git_branches"),
    ];

    it("reads changes and branches only for the selected folder", async () => {
      const { result } = renderHook(() =>
        useGitSync({ enabled: true, folders: ["/a", "/b"] }),
      );
      await waitFor(() => expect(result.current.status("/b")).toEqual(repo));
      expect(detailCalls()).toEqual([]);
      act(() => result.current.select("/a"));
      await waitFor(() =>
        expect(result.current.branches("/a")).toEqual(branches),
      );
      expect(result.current.changes("/a")).toEqual([]);
      expect(
        detailCalls().every(
          (c) => (c[1] as { folder: string }).folder === "/a",
        ),
      ).toBe(true);
      act(() => result.current.select(null));
      const n = detailCalls().length;
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() =>
        expect(calls("git_status").length).toBeGreaterThan(2),
      );
      expect(detailCalls().length).toBe(n);
      expect(result.current.changes("/a")).toBeUndefined();
    });

    it("refreshes changes after commit, switch and library change", async () => {
      let changed: (e: unknown) => void = () => {};
      const ev = await import("@tauri-apps/api/event");
      vi.mocked(ev.listen).mockImplementation(((
        _n: string,
        cb: (e: unknown) => void,
      ) => {
        changed = cb;
        return Promise.resolve(() => {});
      }) as never);
      const { result } = renderHook(() =>
        useGitSync({ enabled: true, folders: ["/a"] }),
      );
      await waitFor(() => expect(result.current.status("/a")).toEqual(repo));
      act(() => result.current.select("/a"));
      await waitFor(() => expect(result.current.changes("/a")).toEqual([]));
      let n = calls("git_changes").length;
      await act(async () => {
        await result.current.commit("/a", "m");
      });
      await waitFor(() =>
        expect(calls("git_changes").length).toBeGreaterThan(n),
      );
      n = calls("git_changes").length;
      await act(async () => {
        await result.current.switchBranch("/a", "x", false);
      });
      await waitFor(() =>
        expect(calls("git_changes").length).toBeGreaterThan(n),
      );
      n = calls("git_changes").length;
      vi.useFakeTimers();
      try {
        changed({ payload: { dirs: [] } });
        await vi.advanceTimersByTimeAsync(1100);
      } finally {
        vi.useRealTimers();
      }
      await waitFor(() =>
        expect(calls("git_changes").length).toBeGreaterThan(n),
      );
    });

    it("switchBranch runs as an op and refreshes", async () => {
      let finish: () => void = () => {};
      const base = invoke.getMockImplementation()!;
      invoke.mockImplementation((cmd: string, a?: unknown) =>
        cmd === "git_switch"
          ? new Promise((r) => (finish = () => r(null)))
          : base(cmd, a),
      );
      const { result } = renderHook(() =>
        useGitSync({ enabled: true, folders: ["/a"] }),
      );
      await waitFor(() => expect(result.current.status("/a")).toEqual(repo));
      act(() => result.current.select("/a"));
      await waitFor(() => expect(result.current.branches("/a")).toBeTruthy());
      let p: Promise<void> = Promise.resolve();
      act(() => {
        p = result.current.switchBranch("/a", "dev", true);
      });
      expect(result.current.running("/a")).toBe("switch");
      expect(calls("git_switch")[0][1]).toEqual({
        folder: "/a",
        branch: "dev",
        fromRemote: true,
      });
      const s = calls("git_status").length;
      const b = calls("git_branches").length;
      await act(async () => {
        finish();
        await p;
      });
      expect(result.current.running("/a")).toBeNull();
      await waitFor(() =>
        expect(calls("git_status").length).toBeGreaterThan(s),
      );
      await waitFor(() =>
        expect(calls("git_branches").length).toBeGreaterThan(b),
      );
    });

    it("createBranch runs as a switch op", async () => {
      const { result } = renderHook(() =>
        useGitSync({ enabled: true, folders: ["/a"] }),
      );
      await waitFor(() => expect(result.current.status("/a")).toEqual(repo));
      await act(async () => {
        await result.current.createBranch("/a", "n");
      });
      expect(calls("git_create_branch")[0][1]).toEqual({
        folder: "/a",
        name: "n",
      });
    });

    it("switchBranch error lands in error(folder)", async () => {
      const base = invoke.getMockImplementation()!;
      invoke.mockImplementation((cmd: string, a?: unknown) =>
        cmd === "git_switch"
          ? Promise.reject({ kind: "refused", detail: "No." })
          : base(cmd, a),
      );
      const { result } = renderHook(() =>
        useGitSync({ enabled: true, folders: ["/a"] }),
      );
      await waitFor(() => expect(result.current.status("/a")).toEqual(repo));
      await act(async () => {
        await result.current.switchBranch("/a", "dev", false);
      });
      expect(result.current.error("/a")?.kind).toBe("refused");
      expect(result.current.error("/a")?.detail).toBe("No.");
    });

    it("anyDirty is true only when some repo is dirty", async () => {
      const status: Record<string, unknown> = {
        "/a": { ...repo, dirty: false },
        "/b": { kind: "notRepo" },
      };
      const base = invoke.getMockImplementation()!;
      invoke.mockImplementation((cmd: string, a?: unknown) =>
        cmd === "git_status"
          ? Promise.resolve(status[(a as { folder: string }).folder])
          : base(cmd, a),
      );
      const { result } = renderHook(() =>
        useGitSync({ enabled: true, folders: ["/a", "/b"] }),
      );
      await waitFor(() => expect(result.current.status("/b")).toBeDefined());
      expect(result.current.anyDirty).toBe(false);
      status["/a"] = repo;
      act(() => result.current.refresh("/a"));
      await waitFor(() => expect(result.current.anyDirty).toBe(true));
    });

    it("drops stale changes responses", async () => {
      const resolvers: ((v: unknown) => void)[] = [];
      const base = invoke.getMockImplementation()!;
      invoke.mockImplementation((cmd: string, a?: unknown) =>
        cmd === "git_changes"
          ? new Promise((r) => resolvers.push(r))
          : base(cmd, a),
      );
      const { result } = renderHook(() =>
        useGitSync({ enabled: true, folders: ["/a"] }),
      );
      await waitFor(() => expect(result.current.status("/a")).toEqual(repo));
      act(() => result.current.select("/a"));
      await waitFor(() => expect(resolvers.length).toBe(1));
      act(() => result.current.refresh("/a"));
      await waitFor(() => expect(resolvers.length).toBe(2));
      const mk = (path: string) => [{ path, status: "modified" }];
      await act(async () => {
        resolvers[1](mk("second"));
      });
      await act(async () => {
        resolvers[0](mk("first"));
      });
      expect(result.current.changes("/a")).toEqual(mk("second"));
    });
  });
});
