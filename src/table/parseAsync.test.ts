import { afterEach, describe, expect, it, vi } from "vitest";
import { answer } from "./parse.worker";
import { checkAsync, WORKER_THRESHOLD } from "./parseAsync";

/** A Worker stand-in that answers with the real handler, recording requests. */
class FakeWorker {
  static sent: unknown[] = [];
  static replies: unknown[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(req: Parameters<typeof answer>[0]) {
    FakeWorker.sent.push(req);
    const data = answer(req);
    FakeWorker.replies.push(data);
    queueMicrotask(() => this.onmessage?.({ data } as MessageEvent));
  }
  terminate() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.sent = [];
  FakeWorker.replies = [];
});

describe("checkAsync", () => {
  it("below the threshold: only whether the text reads, never the table", async () => {
    expect(await checkAsync("a,b\n1,2\n", "x.csv")).toEqual({ ok: true });
    expect(await checkAsync('a,b\n1,"2\n', "x.csv")).toEqual({
      ok: false,
      line: 2,
      reason: "unclosedQuote",
    });
  });

  it("above the threshold the worker sends back no table", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const big = "a,b\n" + "1,2\n".repeat(WORKER_THRESHOLD / 4 + 1);
    expect(await checkAsync(big, "x.csv")).toEqual({ ok: true });
    expect(FakeWorker.sent).toHaveLength(1);
    expect(FakeWorker.sent[0]).toMatchObject({ check: true });
    expect(FakeWorker.replies[0]).toEqual({ ok: true });
    const bad = big + '3,"4\n';
    expect(await checkAsync(bad, "x.csv")).toMatchObject({
      ok: false,
      reason: "unclosedQuote",
    });
    expect(FakeWorker.replies[1]).not.toHaveProperty("table");
  });
});
