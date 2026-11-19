import { describe, expect, it } from "vitest";
import { dropSide } from "./SplitDropZone";

const rect = {
  left: 0,
  top: 0,
  right: 900,
  bottom: 600,
  width: 900,
  height: 600,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

describe("dropSide", () => {
  it("dropSidePicksTheEdge", () => {
    expect(dropSide(rect, 800, 100)).toBe("row");
    expect(dropSide(rect, 800, 550)).toBe("row");
    expect(dropSide(rect, 100, 550)).toBe("column");
    expect(dropSide(rect, 450, 300)).toBeNull();
    expect(dropSide(rect, 950, 300)).toBeNull();
  });
});
