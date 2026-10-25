import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaver, type SaveStatus } from "./autosave";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createSaver", () => {
  it("debouncesPerId", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const saver = createSaver(write, 300);
    saver.schedule("a", () => "1");
    await vi.advanceTimersByTimeAsync(100);
    saver.schedule("a", () => "2");
    await vi.advanceTimersByTimeAsync(100);
    saver.schedule("a", () => "3");
    saver.schedule("b", () => "x");
    await vi.advanceTimersByTimeAsync(300);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledWith("a", "3");
    expect(write).toHaveBeenCalledWith("b", "x");
  });

  it("flushWritesImmediately", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const saver = createSaver(write, 300);
    saver.schedule("a", () => "hello");
    expect(saver.status()).toBe("pending");
    await saver.flush();
    expect(write).toHaveBeenCalledWith("a", "hello");
    expect(saver.status()).toBe("saved");
  });

  it("flush waits for a write already in flight", async () => {
    let release!: () => void;
    const write = vi.fn(() => new Promise<void>((r) => (release = r)));
    const saver = createSaver(write, 300);
    saver.schedule("a", () => "1");
    await vi.advanceTimersByTimeAsync(300);
    let done = false;
    void saver.flush().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it("closeFlushesThenStops", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const saver = createSaver(write, 300);
    saver.schedule("a", () => "before");
    await saver.stop("a");
    saver.schedule("a", () => "after");
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("a", "before");
    saver.resume("a");
    saver.schedule("a", () => "again");
    await vi.advanceTimersByTimeAsync(300);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith("a", "again");
  });

  it("writeErrorIsReportedAndRetried", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk"))
      .mockResolvedValue(undefined);
    const saver = createSaver(write, 300);
    const seen: SaveStatus[] = [];
    saver.onStatus((s) => seen.push(s));
    saver.schedule("a", () => "v1");
    await vi.advanceTimersByTimeAsync(300);
    expect(saver.status()).toBe("error");
    expect(seen).toContain("error");
    saver.schedule("a", () => "v2");
    await vi.advanceTimersByTimeAsync(300);
    expect(write).toHaveBeenLastCalledWith("a", "v2");
    expect(saver.status()).toBe("saved");
    expect(seen[seen.length - 1]).toBe("saved");
  });

  it("flush retries a failed id with latest content", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk"))
      .mockResolvedValue(undefined);
    const saver = createSaver(write, 300);
    saver.schedule("a", () => "v1");
    await vi.advanceTimersByTimeAsync(300);
    expect(saver.status()).toBe("error");
    await saver.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(saver.status()).toBe("saved");
  });

  it("writesAreSerializedPerId", async () => {
    const resolvers: Array<() => void> = [];
    const write = vi.fn(() => new Promise<void>((r) => resolvers.push(r)));
    const saver = createSaver(write, 300);
    saver.schedule("a", () => "1");
    await vi.advanceTimersByTimeAsync(300);
    expect(write).toHaveBeenCalledTimes(1);
    saver.schedule("a", () => "2");
    await vi.advanceTimersByTimeAsync(300);
    expect(write).toHaveBeenCalledTimes(1);
    resolvers[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith("a", "2");
    resolvers[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.status()).toBe("saved");
  });

  it("scheduleDuringStopIsIgnored", async () => {
    let release!: () => void;
    const write = vi.fn(() => new Promise<void>((r) => (release = r)));
    const saver = createSaver(write, 300);
    saver.schedule("a", () => "old");
    const stopping = saver.stop("a");
    await vi.advanceTimersByTimeAsync(0);
    saver.schedule("a", () => "new");
    release();
    await stopping;
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("flushRejectsWhenWriteFails", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk"))
      .mockResolvedValue(undefined);
    const saver = createSaver(write, 300);
    saver.schedule("a", () => "v1");
    await expect(saver.flush()).rejects.toThrow("disk");
    expect(saver.status()).toBe("error");
    await saver.flush("a");
    expect(write).toHaveBeenCalledTimes(2);
    expect(saver.status()).toBe("saved");
  });

  it("stopRejectsAndStaysActiveWhenWriteFails", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk"))
      .mockResolvedValue(undefined);
    const saver = createSaver(write, 300);
    saver.schedule("a", () => "v1");
    await expect(saver.stop("a")).rejects.toThrow("disk");
    saver.schedule("a", () => "v2");
    await vi.advanceTimersByTimeAsync(300);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith("a", "v2");
    expect(saver.status()).toBe("saved");
  });
});
