import { describe, expect, it } from "vitest";
import { visibleRange } from "./windowing";

describe("visibleRange", () => {
  const offsets = [0, 28, 56, 84, 112];
  it("finds the items in view", () => {
    expect(visibleRange(offsets, 30, 40, 0)).toEqual([1, 3]);
  });
  it("applies overscan clamped to [0, n]", () => {
    expect(visibleRange(offsets, 30, 40, 1)).toEqual([0, 4]);
    expect(visibleRange(offsets, 30, 40, 10)).toEqual([0, 4]);
  });
  it("handles an empty list", () => {
    expect(visibleRange([0], 0, 100, 2)).toEqual([0, 0]);
    expect(visibleRange([], 0, 100, 2)).toEqual([0, 0]);
  });
});
