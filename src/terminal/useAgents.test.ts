import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInfo } from "./api";

vi.mock("./api", () => ({ terminalAgents: vi.fn() }));

import * as api from "./api";
import { useAgents } from "./useAgents";

const a = vi.mocked(api);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const one: AgentInfo[] = [
  { id: "claude", name: "Claude Code", installed: true },
];
const two: AgentInfo[] = [{ id: "codex", name: "Codex", installed: false }];

beforeEach(() => vi.resetAllMocks());

describe("useAgents", () => {
  it("starts as null, before it has checked", () => {
    a.terminalAgents.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAgents());
    expect(result.current.agents).toBeNull();
    expect(a.terminalAgents).not.toHaveBeenCalled();
  });

  it("keeps the latest call's result when an earlier call resolves last", async () => {
    const first = deferred<AgentInfo[]>();
    const second = deferred<AgentInfo[]>();
    a.terminalAgents
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useAgents());
    act(() => result.current.refresh());
    act(() => result.current.refresh());
    await act(async () => second.resolve(two));
    await act(async () => first.resolve(one));
    expect(result.current.agents).toEqual(two);
  });

  it("keeps the last result when a refresh is rejected", async () => {
    a.terminalAgents.mockResolvedValueOnce(one);
    const { result } = renderHook(() => useAgents());
    await act(async () => result.current.refresh());
    expect(result.current.agents).toEqual(one);
    a.terminalAgents.mockRejectedValueOnce(new Error("boom"));
    await act(async () => result.current.refresh());
    expect(result.current.agents).toEqual(one);
  });
});
