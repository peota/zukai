import { describe, expect, it } from "vitest";
import { initialTermState, termReducer, type TermState } from "./model";

const open = (s: TermState, id: number, cwd = "/a") =>
  termReducer(s, { type: "opened", id, cwd });

describe("termReducer", () => {
  it("openedShowsAndActivates", () => {
    const s = open(open(initialTermState, 1), 2, "/b");
    expect(s.terms).toEqual([
      { id: 1, cwd: "/a", exited: undefined },
      { id: 2, cwd: "/b", exited: undefined },
    ]);
    expect(s.activeId).toBe(2);
    expect(s.shown).toBe(true);
  });

  it("killingLastHidesPanel", () => {
    const s = termReducer(open(initialTermState, 1), { type: "killed", id: 1 });
    expect(s.terms).toEqual([]);
    expect(s.activeId).toBeNull();
    expect(s.shown).toBe(false);
  });

  it("killingActiveMovesRightThenLeft", () => {
    let s = open(open(open(initialTermState, 1), 2), 3);
    s = termReducer(s, { type: "activate", id: 2 });
    s = termReducer(s, { type: "killed", id: 2 });
    expect(s.activeId).toBe(3);
    s = termReducer(s, { type: "killed", id: 3 });
    expect(s.activeId).toBe(1);
  });

  it("killingInactiveKeepsActive", () => {
    const s = termReducer(open(open(initialTermState, 1), 2), {
      type: "killed",
      id: 1,
    });
    expect(s.activeId).toBe(2);
    expect(s.shown).toBe(true);
  });

  it("exitedKeepsTab", () => {
    const s = termReducer(open(initialTermState, 1), {
      type: "exited",
      id: 1,
      code: 3,
    });
    expect(s.terms).toHaveLength(1);
    expect(s.terms[0].exited).toBe(3);
    const n = termReducer(s, { type: "exited", id: 1, code: null });
    expect(n.terms[0].exited).toBeNull();
  });

  it("hideKeepsTerms", () => {
    const s = termReducer(open(initialTermState, 1), { type: "hide" });
    expect(s.shown).toBe(false);
    expect(s.terms).toHaveLength(1);
    expect(s.activeId).toBe(1);
    expect(termReducer(s, { type: "show" }).shown).toBe(true);
  });
});
