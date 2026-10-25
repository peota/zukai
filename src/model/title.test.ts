import { describe, expect, it } from "vitest";
import { deriveTitle, displayTitle } from "./title";
import { newTabState } from "./workspace";

describe("deriveTitle", () => {
  it("returns Untitled for empty or blank content", () => {
    expect(deriveTitle("")).toBe("Untitled");
    expect(deriveTitle("\n  \n")).toBe("Untitled");
  });
  it("uses the first non-empty trimmed line", () => {
    expect(deriveTitle("\n\n  hello world  \nnext")).toBe("hello world");
  });
  it("cuts 31 chars to 30 plus ellipsis, leaves 30 unchanged", () => {
    expect(deriveTitle("a".repeat(31))).toBe("a".repeat(30) + "…");
    expect(deriveTitle("a".repeat(30))).toBe("a".repeat(30));
  });
  it("deriveTitleDoesNotSplitSurrogates", () => {
    expect(deriveTitle("a".repeat(29) + "😀😀")).toBe("a".repeat(29) + "😀…");
  });
  it("deriveTitleIsBoundedOnHugeInput", () => {
    const big = "x".repeat(5_000_000);
    const t0 = performance.now();
    const out = deriveTitle(big);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(Array.from(out).length).toBeLessThanOrEqual(31);
  });
});

describe("deriveTitle prefix bound", () => {
  it("ignores text that appears only after the scan limit", () => {
    expect(deriveTitle(" ".repeat(70_000) + "late")).toBe("Untitled");
    expect(deriveTitle("\n".repeat(70_000) + "late")).toBe("Untitled");
  });
  it("is fast on 5 MB of newlines", () => {
    const t0 = performance.now();
    expect(deriveTitle("\n".repeat(5_000_000))).toBe("Untitled");
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("displayTitle", () => {
  it("uses tab.title when renamed", () => {
    const tab = { ...newTabState("a"), title: "Mine", renamed: true };
    expect(displayTitle(tab, "other")).toBe("Mine");
  });
  it("derives from content when not renamed", () => {
    expect(displayTitle(newTabState("a"), "hi there")).toBe("hi there");
  });
  it("falls back to tab.title when content is undefined", () => {
    const tab = { ...newTabState("a"), title: "Cached" };
    expect(displayTitle(tab, undefined)).toBe("Cached");
  });
});
