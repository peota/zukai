import { describe, expect, it } from "vitest";
import { createKeyedLock } from "./keyedLock";

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
}

describe("keyedLock", () => {
  it("runs work for one key in order, one at a time", async () => {
    const lock = createKeyedLock();
    const log: string[] = [];
    const g = gate();
    const a = lock("k", async () => {
      log.push("a start");
      await g.promise;
      log.push("a end");
      return 1;
    });
    const b = lock("k", async () => {
      log.push("b");
      return 2;
    });
    await Promise.resolve();
    expect(log).toEqual(["a start"]);
    g.open();
    expect(await Promise.all([a, b])).toEqual([1, 2]);
    expect(log).toEqual(["a start", "a end", "b"]);
  });

  it("lets other keys run meanwhile", async () => {
    const lock = createKeyedLock();
    const g = gate();
    const slow = lock("a", () => g.promise);
    let other = false;
    await lock("b", async () => {
      other = true;
    });
    expect(other).toBe(true);
    g.open();
    await slow;
  });

  it("a rejection reaches its caller and doesn't block later work", async () => {
    const lock = createKeyedLock();
    const failed = lock("k", async () => {
      throw new Error("boom");
    });
    const next = lock("k", async () => "ran");
    await expect(failed).rejects.toThrow("boom");
    expect(await next).toBe("ran");
  });
});
