import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let beforeExitHandler: (() => void) | undefined;
let closeHandler:
  ((e: { preventDefault: () => void }) => Promise<void>) | undefined;
const unlistenEvent = vi.fn();
const unlistenClose = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: () => void) => {
    if (name === "zukai://before-exit") beforeExitHandler = cb;
    return unlistenEvent;
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: vi.fn(async (cb: typeof closeHandler) => {
      closeHandler = cb;
      return unlistenClose;
    }),
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    calls.push(`invoke:${cmd}`);
  }),
}));

import { installExitHandshake } from "./exit";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("installExitHandshake", () => {
  beforeEach(() => {
    calls.length = 0;
    beforeExitHandler = undefined;
    closeHandler = undefined;
    vi.clearAllMocks();
  });

  it("flushRunsBeforeExitCommand", async () => {
    let release!: () => void;
    const flushAll = vi.fn(async () => {
      calls.push("flush:start");
      await new Promise<void>((r) => (release = r));
      calls.push("flush:end");
    });
    await installExitHandshake(flushAll);
    beforeExitHandler!();
    await tick();
    expect(calls).toEqual(["flush:start"]);
    release();
    await tick();
    expect(calls).toEqual([
      "flush:start",
      "flush:end",
      "invoke:app_exit_after_flush",
    ]);
  });

  it("closeRequestedPreventsDefaultUntilFlushed", async () => {
    const flushAll = vi.fn(async () => {
      calls.push("flush");
    });
    await installExitHandshake(flushAll);
    const preventDefault = vi.fn(() => calls.push("preventDefault"));
    await closeHandler!({ preventDefault });
    expect(calls).toEqual([
      "preventDefault",
      "flush",
      "invoke:app_exit_after_flush",
    ]);
  });

  it("returns an unlisten function that removes both listeners", async () => {
    const off = await installExitHandshake(async () => {});
    off();
    expect(unlistenEvent).toHaveBeenCalled();
    expect(unlistenClose).toHaveBeenCalled();
  });
});
