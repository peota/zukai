import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as files from "../files/api";
import { newTabState } from "../model/workspace";
import type { ClosedEntry } from "../model/types";
import { useGoneClosed } from "./useGoneClosed";

vi.mock("../files/api", () => ({
  fileFingerprint: vi.fn(),
  fileFingerprintQuick: vi.fn(),
}));

const f = vi.mocked(files);
const print = { mtimeMs: 1, size: 1, hash: "h" };

const entry = (id: string, path: string): ClosedEntry => ({
  tab: {
    ...newTabState(id),
    file: {
      path,
      format: { encoding: "utf-8", bom: false, lineEnding: "lf", mixed: false },
      fingerprint: print,
      held: null,
    },
  },
  index: 0,
  closedAt: 0,
});

let existing: Set<string>;

beforeEach(() => {
  existing = new Set(["C:/L/a.md", "C:/L/b.md"]);
  f.fileFingerprintQuick.mockReset();
  f.fileFingerprintQuick.mockImplementation((path) =>
    Promise.resolve(existing.has(path) ? print : null),
  );
});

describe("useGoneClosed", () => {
  const closed = [entry("a", "C:/L/a.md"), entry("b", "C:/L/b.md")];

  it("reports closed Recent entries whose File is gone, on recheck", async () => {
    const { result } = renderHook(() => useGoneClosed(["a", "b"], closed));
    await waitFor(() => expect(f.fileFingerprintQuick).toHaveBeenCalled());
    expect(result.current.gone.size).toBe(0);

    existing.delete("C:/L/b.md");
    act(() => result.current.recheck());
    await waitFor(() => expect([...result.current.gone]).toEqual(["b"]));
  });

  it("checks only entries listed in Recent", async () => {
    existing.clear();
    const { result } = renderHook(() => useGoneClosed(["a"], closed));
    await waitFor(() => expect([...result.current.gone]).toEqual(["a"]));
    expect(f.fileFingerprintQuick).toHaveBeenCalledTimes(1);
  });

  it("keeps an entry whose check fails", async () => {
    f.fileFingerprintQuick.mockRejectedValue(new Error("denied"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useGoneClosed(["a"], closed));
    await waitFor(() => expect(f.fileFingerprintQuick).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.gone.size).toBe(0);
    err.mockRestore();
  });
});
