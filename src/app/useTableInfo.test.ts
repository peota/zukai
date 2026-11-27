import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TableInfo, TabState } from "../model/types";
import { useTableInfo } from "./useTableInfo";

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
});
