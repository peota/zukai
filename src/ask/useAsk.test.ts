import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TextBridge } from "../editor/EditorHost";
import type { Kind } from "../model/kinds";
import type { AskEvent } from "./api";

vi.mock("./api", () => ({
  aiAsk: vi.fn(() => new Promise<void>(() => {})),
  aiCancel: vi.fn(() => Promise.resolve()),
}));
import { aiAsk, aiCancel } from "./api";
import { useAsk } from "./useAsk";

const tab = (id: string, kind: Kind = "text") => ({
  id,
  title: `T${id}`,
  language: "ts",
  kind,
});

function bridgeOf(
  texts: Record<string, string | null>,
  hidden: Record<string, [number, number][]> = {},
) {
  return {
    text: (id: string) => texts[id] ?? null,
    hidden: (id: string) => hidden[id] ?? [],
  } as unknown as TextBridge;
}

const call = (n: number) => vi.mocked(aiAsk).mock.calls[n];
const emit = (n: number, e: AskEvent) => act(() => call(n)[3](e));

beforeEach(() => {
  vi.mocked(aiAsk).mockClear();
  vi.mocked(aiCancel).mockClear();
});

describe("useAsk", () => {
  it("builds system from the redacted text and messages from earlier turns", () => {
    const bridge = bridgeOf({ a: "public SECRET tail" }, { a: [[7, 13]] });
    const { result } = renderHook(() =>
      useAsk({ bridge, activeTab: tab("a") }),
    );
    act(() => void result.current.send("q1"));
    const [id, system, messages] = call(0);
    expect(system).toContain("public [hidden] tail");
    expect(JSON.stringify([id, system, messages])).not.toContain("SECRET");
    expect(messages).toEqual([{ role: "user", content: "q1" }]);
    emit(0, { kind: "text", text: "ans" });
    emit(0, { kind: "done" });
    act(() => void result.current.send("q2"));
    expect(call(1)[2]).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "ans" },
      { role: "user", content: "q2" },
    ]);
    expect(call(1)[0]).not.toBe(id);
  });

  it("drops an errored answer together with its question", () => {
    const bridge = bridgeOf({ a: "x" });
    const { result } = renderHook(() =>
      useAsk({ bridge, activeTab: tab("a") }),
    );
    act(() => void result.current.send("q1"));
    emit(0, { kind: "text", text: "part" });
    emit(0, { kind: "error", message: "boom" });
    act(() => void result.current.send("q2"));
    expect(call(1)[2]).toEqual([{ role: "user", content: "q2" }]);
  });

  it("drops a stopped-before-any-text answer together with its question", () => {
    const bridge = bridgeOf({ a: "x" });
    const { result } = renderHook(() =>
      useAsk({ bridge, activeTab: tab("a") }),
    );
    act(() => void result.current.send("q1"));
    act(() => result.current.stop());
    act(() => void result.current.send("q2"));
    expect(call(1)[2]).toEqual([{ role: "user", content: "q2" }]);
  });

  it("shows the message of a rejected aiAsk, not [object Object]", async () => {
    vi.mocked(aiAsk).mockRejectedValueOnce({
      kind: "not_ready",
      message: "No key set",
    });
    const bridge = bridgeOf({ a: "x" });
    const { result } = renderHook(() =>
      useAsk({ bridge, activeTab: tab("a") }),
    );
    await act(async () => void result.current.send("q"));
    expect(result.current.conversation.streaming).toBeNull();
    expect(result.current.conversation.turns[1].error).toBe("No key set");
  });

  it("handles a synchronous throw and Error rejections", async () => {
    vi.mocked(aiAsk).mockImplementationOnce(() => {
      throw new Error("sync");
    });
    const bridge = bridgeOf({ a: "x" });
    const { result } = renderHook(() =>
      useAsk({ bridge, activeTab: tab("a") }),
    );
    await act(async () => void result.current.send("q"));
    expect(result.current.conversation.streaming).toBeNull();
    expect(result.current.conversation.turns[1].error).toBe("sync");
  });

  it("refuses a second send in the same event", () => {
    const bridge = bridgeOf({ a: "x" });
    const { result } = renderHook(() =>
      useAsk({ bridge, activeTab: tab("a") }),
    );
    let r: string[] = [];
    act(() => {
      r = [result.current.send("q1"), result.current.send("q2")];
    });
    expect(r).toEqual(["sent", "busy"]);
    expect(aiAsk).toHaveBeenCalledTimes(1);
  });

  it("keeps events in the same turn when the active Tab changes; next send uses the new Tab", () => {
    const bridge = bridgeOf({ a: "note A", b: "note B" });
    const { result, rerender } = renderHook(
      ({ t }) => useAsk({ bridge, activeTab: t }),
      { initialProps: { t: tab("a") } },
    );
    act(() => void result.current.send("q1"));
    rerender({ t: tab("b") });
    emit(0, { kind: "text", text: "late" });
    emit(0, { kind: "done" });
    expect(result.current.conversation.turns[1].text).toBe("late");
    act(() => void result.current.send("q2"));
    expect(call(1)[1]).toContain("note B");
    expect(call(1)[1]).not.toContain("note A");
  });

  it("returns noNote for a non-text Tab, a missing Tab or an unloaded view", () => {
    const bridge = bridgeOf({ a: "x" });
    const hook = (b: TextBridge | null, t: ReturnType<typeof tab> | null) =>
      renderHook(() => useAsk({ bridge: b, activeTab: t })).result;
    expect(hook(bridge, tab("a", "canvas")).current.send("q")).toBe("noNote");
    expect(hook(bridge, null).current.send("q")).toBe("noNote");
    expect(hook(null, tab("a")).current.send("q")).toBe("noNote");
    expect(hook(bridge, tab("zzz")).current.send("q")).toBe("noNote");
    expect(aiAsk).not.toHaveBeenCalled();
  });

  it("returns tooLong without calling aiAsk", () => {
    const bridge = bridgeOf({ a: "a".repeat(200_001) });
    const { result } = renderHook(() =>
      useAsk({ bridge, activeTab: tab("a") }),
    );
    expect(result.current.send("q")).toBe("tooLong");
    expect(aiAsk).not.toHaveBeenCalled();
  });

  it("returns busy while streaming", () => {
    const bridge = bridgeOf({ a: "x" });
    const { result } = renderHook(() =>
      useAsk({ bridge, activeTab: tab("a") }),
    );
    let first = "";
    act(() => void (first = result.current.send("q1")));
    expect(first).toBe("sent");
    let second = "";
    act(() => void (second = result.current.send("q2")));
    expect(second).toBe("busy");
    expect(aiAsk).toHaveBeenCalledTimes(1);
  });

  it("clear, stop and unmount cancel the running id", () => {
    const bridge = bridgeOf({ a: "x" });
    const { result, unmount } = renderHook(() =>
      useAsk({ bridge, activeTab: tab("a") }),
    );
    act(() => void result.current.send("q1"));
    const id = call(0)[0];
    act(() => result.current.clear());
    expect(aiCancel).toHaveBeenLastCalledWith(id);
    expect(result.current.conversation.turns).toEqual([]);
    act(() => void result.current.send("q2"));
    const id2 = call(1)[0];
    act(() => result.current.stop());
    expect(aiCancel).toHaveBeenLastCalledWith(id2);
    act(() => void result.current.send("q3"));
    const id3 = call(2)[0];
    unmount();
    expect(aiCancel).toHaveBeenLastCalledWith(id3);
  });
});
