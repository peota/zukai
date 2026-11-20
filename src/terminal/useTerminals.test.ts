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

  it("kill ends the session, then forgets the terminal", async () => {
    const { result } = renderHook(() => useTerminals());
    await act(() => result.current.open("C:\\L"));
    await act(async () => result.current.kill(3));
    expect(a.terminalKill).toHaveBeenCalledWith(3);
    expect(result.current.state.terms).toEqual([]);
    expect(result.current.state.shown).toBe(false);
  });
});
