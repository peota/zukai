import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TableInfo, TabState } from "../model/types";
import { useTableInfo } from "./useTableInfo";

const forget = vi.hoisted(() => vi.fn());
vi.mock("../table/gridMemory", () => ({ forget }));

const info: TableInfo = {
  rows: 3,
  shown: 3,
  cols: 2,
  delimiter: ";",
  header: true,
};
const tab = (over: Partial<TabState> = {}) =>
  ({ id: "a", kind: "table", title: "a.csv", ...over }) as TabState;

describe("useTableInfo", () => {
  it("keeps what each grid reported", () => {
    const { result } = renderHook(() => useTableInfo([tab()]));
    act(() => result.current.onTableInfo("a", info));
    expect(result.current.infoOf("a")).toBe(info);
    expect(result.current.delimiterOf("a")).toBe(";");
    expect(result.current.infoOf("b")).toBeUndefined();
  });

  it("switching to raw text drops the counts but keeps the Delimiter read", () => {
    let tabs = [tab()];
    const { result, rerender } = renderHook(() => useTableInfo(tabs));
    act(() => result.current.onTableInfo("a", info));
    tabs = [tab({ tableView: "raw" })];
    rerender();
    expect(result.current.infoOf("a")).toBeUndefined();
    expect(result.current.delimiterOf("a")).toBe(";");
    // Back in the grid, nothing shows until the grid reads the text again.
    tabs = [tab({ tableView: "grid" })];
    rerender();
    expect(result.current.infoOf("a")).toBeUndefined();
    act(() => result.current.onTableInfo("a", { ...info, rows: 4 }));
    expect(result.current.infoOf("a")?.rows).toBe(4);
  });

  it("a count reported while in raw text (a late grid) is never shown", () => {
    const { result } = renderHook(() =>
      useTableInfo([tab({ tableView: "raw" })]),
    );
    act(() => result.current.onTableInfo("a", info));
    expect(result.current.infoOf("a")).toBeUndefined();
  });

  it("null from the grid (reading again) clears the counts, not the Delimiter", () => {
    const { result } = renderHook(() => useTableInfo([tab()]));
    act(() => result.current.onTableInfo("a", info));
    act(() => result.current.onTableInfo("a", null));
    expect(result.current.infoOf("a")).toBeUndefined();
    expect(result.current.delimiterOf("a")).toBe(";");
  });

  it("keeps each Tab's Unreadable notice", () => {
    const { result } = renderHook(() => useTableInfo([tab()]));
    const n = { line: 2, reason: "unclosedQuote" as const };
    act(() => result.current.onTableNotice("a", n));
    expect(result.current.noticeOf("a")).toEqual(n);
    act(() => result.current.onTableNotice("a", null));
    expect(result.current.noticeOf("a")).toBeNull();
  });

  it("a closed Tab's counts, notice and grid memory go", async () => {
    let tabs = [tab(), tab({ id: "b", title: "b.csv" })];
    const { result, rerender } = renderHook(() => useTableInfo(tabs));
    act(() => result.current.onTableInfo("a", info));
    act(() =>
      result.current.onTableNotice("a", { line: 1, reason: "inconsistent" }),
    );
    act(() => result.current.onTableInfo("b", info));
    forget.mockClear();
    tabs = [tab({ id: "b", title: "b.csv" })];
    rerender();
    expect(result.current.noticeOf("a")).toBeNull();
    // A Tab with that id opening again starts with nothing.
    tabs = [tab(), tab({ id: "b", title: "b.csv" })];
    rerender();
    expect(result.current.infoOf("a")).toBeUndefined();
    expect(result.current.delimiterOf("a")).toBeUndefined();
    await waitFor(() => expect(forget).toHaveBeenCalledWith("a"));
    expect(forget).not.toHaveBeenCalledWith("b");
  });
});
