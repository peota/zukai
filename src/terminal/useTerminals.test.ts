import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalEvent } from "./api";

const h = vi.hoisted(() => ({
  emit: null as null | ((e: TerminalEvent) => void),
}));

vi.mock("./api", () => ({
  terminalOpen: vi.fn(
    async (
      _cwd: string,
      _cols: number,
      _rows: number,
      onEvent: (e: TerminalEvent) => void,
    ) => {
      h.emit = onEvent;
      // The shell prints before the id comes back.
      onEvent({ kind: "data", data: "early " });
      return 3;
    },
  ),
  terminalWrite: vi.fn(),
  terminalAck: vi.fn(),
  terminalResize: vi.fn(async () => {}),
  terminalKill: vi.fn(async () => {}),
}));

import * as api from "./api";
import { useTerminals } from "./useTerminals";

const a = vi.mocked(api);

beforeEach(() => vi.clearAllMocks());

describe("useTerminals", () => {
  it("buffers events until the view registers, then replays them", async () => {
    const { result } = renderHook(() => useTerminals());
    await act(() => result.current.open("C:\\L"));
    expect(a.terminalOpen).toHaveBeenCalledWith(
      "C:\\L",
      80,
      24,
      expect.any(Function),
      undefined,
    );
    expect(result.current.state.terms).toEqual([
      { id: 3, cwd: "C:\\L", exited: undefined },
    ]);
    expect(result.current.state.shown).toBe(true);
    act(() => h.emit!({ kind: "data", data: "prompt" }));

    const sink = vi.fn();
    act(() => result.current.register(3, sink));
    expect(sink.mock.calls.map((c) => c[0])).toEqual([
      { kind: "data", data: "early " },
      { kind: "data", data: "prompt" },
    ]);
    act(() => h.emit!({ kind: "data", data: "more" }));
    expect(sink).toHaveBeenLastCalledWith({ kind: "data", data: "more" });

    act(() => h.emit!({ kind: "exit", code: 2 }));
    expect(result.current.state.terms[0].exited).toBe(2);

    result.current.write(3, "ls\r");
    expect(a.terminalWrite).toHaveBeenCalledWith(3, "ls\r");
  });

  it("opens an agent: passes its id and keeps its name on the term", async () => {
    const { result } = renderHook(() => useTerminals());
    await act(() => result.current.open("/x", { id: "codex", name: "Codex" }));
    expect(a.terminalOpen).toHaveBeenCalledWith(
      "/x",
      80,
      24,
      expect.any(Function),
      "codex",
    );
    expect(result.current.state.terms[0].agent).toBe("Codex");
  });

  it("a view that registers again (StrictMode) still gets the early output once", async () => {
    const { result } = renderHook(() => useTerminals());
    await act(() => result.current.open("C:\\L"));
    act(() => h.emit!({ kind: "data", data: "\x1b[6n" }));

    // Mount, cleanup, mount again: the first view is gone before parsing.
    const first = vi.fn();
    let unregister = () => {};
    act(() => {
      unregister = result.current.register(3, first);
    });
    act(() => unregister());
    const second = vi.fn();
    act(() => {
      result.current.register(3, second);
    });
    act(() => h.emit!({ kind: "data", data: "live" }));
    expect(second.mock.calls.map((c) => c[0].data)).toEqual([
      "early ",
      "\x1b[6n",
      "live",
    ]);
    // The unregistered view gets nothing live.
    expect(first.mock.calls.map((c) => c[0].data)).toEqual([
      "early ",
      "\x1b[6n",
    ]);

    // After the first input the early log is dropped: a later view starts
    // empty rather than replaying output the shell has moved past.
    result.current.write(3, "x");
    act(() => h.emit!({ kind: "data", data: "after" }));
    const third = vi.fn();
    act(() => {
      result.current.register(3, third);
    });
    expect(third).not.toHaveBeenCalled();
  });

  it("acks output it has to drop, so the backend never waits for it", async () => {
    const { result } = renderHook(() => useTerminals());
    await act(() => result.current.open("C:\\L"));
    // No view yet: logged for replay, and acked by the view that replays it.
    act(() => h.emit!({ kind: "data", data: "prompt" }));
    expect(a.terminalAck).not.toHaveBeenCalled();
    // Past the log's limit with no view to take it: dropped, so acked here.
    const flood = "x".repeat(300 * 1024);
    act(() => h.emit!({ kind: "data", data: flood }));
    expect(a.terminalAck).toHaveBeenCalledWith(3, flood.length);
    const sink = vi.fn();
    act(() => result.current.register(3, sink));
    expect(sink.mock.calls.map((c) => c[0].data)).toEqual(["early ", "prompt"]);
  });

  it("a killed terminal goes at once, without showing its exit", async () => {
    const { result } = renderHook(() => useTerminals());
    await act(() => result.current.open("C:\\L"));
    const sink = vi.fn();
    act(() => result.current.register(3, sink));
    sink.mockClear();
    let finish = () => {};
    a.terminalKill.mockReturnValueOnce(
      new Promise<void>((resolve) => (finish = resolve)),
    );
    act(() => result.current.kill(3));
    expect(a.terminalKill).toHaveBeenCalledWith(3);
    // Gone before the backend is done killing it.
    expect(result.current.state.terms).toEqual([]);
    // Its last output and its Exit arrive while it is being killed: ignored.
    act(() => h.emit!({ kind: "data", data: "bye" }));
    act(() => h.emit!({ kind: "exit", code: 1 }));
    expect(sink).not.toHaveBeenCalled();
    expect(result.current.state.terms).toEqual([]);
    await act(async () => finish());
    // Nothing was kept for it: a view registering now gets nothing.
    const late = vi.fn();
    act(() => result.current.register(3, late));
    expect(late).not.toHaveBeenCalled();
  });

  it("kill ends the session, then forgets the terminal", async () => {
    const { result } = renderHook(() => useTerminals());
    await act(() => result.current.open("C:\\L"));
    await act(async () => result.current.kill(3));
    expect(a.terminalKill).toHaveBeenCalledWith(3);
    expect(result.current.state.terms).toEqual([]);
    expect(result.current.state.shown).toBe(false);
  });
});
