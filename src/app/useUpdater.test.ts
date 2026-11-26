import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const check = vi.fn();
const relaunch = vi.fn();
const invoke = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunch() }));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("0.1.0"),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => invoke(cmd),
}));

import { FIRST_CHECK_DELAY_MS, useUpdater } from "./useUpdater";

type Progress =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

function fakeUpdate(version = "0.2.0") {
  const calls: string[] = [];
  return {
    calls,
    version,
    close: vi.fn(() => Promise.resolve()),
    download: vi.fn(async (onEvent: (e: Progress) => void) => {
      calls.push("download");
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      onEvent({ event: "Finished" });
    }),
    install: vi.fn(async () => {
      calls.push("install");
    }),
  };
}

beforeEach(() => {
  check.mockReset();
  relaunch.mockReset().mockResolvedValue(undefined);
  invoke.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useUpdater", () => {
  it("knows the current version and whether it can install", async () => {
    invoke.mockResolvedValue(false);
    const { result } = renderHook(() => useUpdater(vi.fn()));
    await act(async () => {});
    expect(result.current.currentVersion).toBe("0.1.0");
    expect(result.current.canInstall).toBe(false);
    expect(invoke).toHaveBeenCalledWith("update_can_install");
  });

  it("checks in the background shortly after startup", async () => {
    vi.useFakeTimers();
    check.mockResolvedValue(fakeUpdate());
    const { result } = renderHook(() => useUpdater(vi.fn()));
    expect(check).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    });
    expect(check).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("available");
    expect(result.current.newVersion).toBe("0.2.0");
  });

  it("keeps a failed background check quiet but shows a manual one", async () => {
    check.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useUpdater(vi.fn()));
    await act(() => result.current.checkNow());
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
    await act(() => result.current.checkNow(true));
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("offline");
  });

  it("reports up to date only for a manual check", async () => {
    check.mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater(vi.fn()));
    await act(() => result.current.checkNow());
    expect(result.current.status).toBe("idle");
    await act(() => result.current.checkNow(true));
    expect(result.current.status).toBe("current");
  });

  it("downloads, saves everything, then installs and restarts", async () => {
    const update = fakeUpdate();
    check.mockResolvedValue(update);
    const flush = vi.fn(async () => {
      update.calls.push("flush");
    });
    const { result } = renderHook(() => useUpdater(flush));
    await act(() => result.current.checkNow(true));
    await act(() => result.current.install());
    expect(update.calls).toEqual(["download", "flush", "install"]);
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("installing");
  });

  it("never installs when saving fails", async () => {
    const update = fakeUpdate();
    check.mockResolvedValue(update);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const flush = vi.fn(() => Promise.reject(new Error("disk full")));
    const { result } = renderHook(() => useUpdater(flush));
    await act(() => result.current.checkNow(true));
    await act(() => result.current.install());
    expect(update.install).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("disk full");
    expect(result.current.newVersion).toBe("0.2.0");
  });
});
