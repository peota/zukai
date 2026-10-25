import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import { countMatches } from "./count";

const state = (doc: string, anchor = 0, head = anchor) =>
  EditorState.create({ doc, selection: { anchor, head } });

const q = (
  search: string,
  over: Partial<ConstructorParameters<typeof SearchQuery>[0]> = {},
) => new SearchQuery({ search, ...over });

describe("countMatches", () => {
  it("counts every match and finds the one under the selection", () => {
    expect(countMatches(state("a b a b a"), q("a"))).toMatchObject({
      total: 3,
      capped: false,
    });
    // Selection on the second "a" (offset 4).
    expect(countMatches(state("a b a b a", 4, 5), q("a"))).toEqual({
      total: 3,
      current: 2,
      capped: false,
    });
  });

  it("reports current 0 when the selection is not a match", () => {
    expect(countMatches(state("a b a", 1), q("a")).current).toBe(0);
  });

  it("respects case sensitivity", () => {
    expect(
      countMatches(state("a A"), q("A", { caseSensitive: true })).total,
    ).toBe(1);
  });

  it("respects whole word", () => {
    expect(countMatches(state("a ab"), q("a", { wholeWord: true })).total).toBe(
      1,
    );
  });

  it("counts regex matches", () => {
    expect(
      countMatches(state("1 22 333"), q("\\d+", { regexp: true })).total,
    ).toBe(3);
  });

  it("treats an invalid regex as no matches, without throwing", () => {
    expect(countMatches(state("((("), q("(", { regexp: true }))).toMatchObject({
      total: 0,
      current: 0,
    });
  });

  it("treats an empty search as no matches", () => {
    expect(countMatches(state("abc"), q(""))).toMatchObject({ total: 0 });
  });

  it("countMatchesHandlesEmptyMatches", () => {
    expect(
      countMatches(state("one\ntwo\nthree"), q("^", { regexp: true })).total,
    ).toBe(3);
    const r = countMatches(state("baab"), q("a*", { regexp: true }));
    expect(Number.isFinite(r.total)).toBe(true);
    expect(r.total).toBeGreaterThan(0);
    expect(r.total).toBeLessThanOrEqual(5);
    expect(countMatches(state("ab cd"), q("\\b", { regexp: true })).total).toBe(
      4,
    );
  });

  it("caps the count at the limit", () => {
    expect(countMatches(state("x".repeat(20000)), q("x"))).toMatchObject({
      total: 10000,
      capped: true,
    });
    expect(countMatches(state("xxx"), q("x"), 3)).toMatchObject({
      total: 3,
      capped: false,
    });
  });
});
