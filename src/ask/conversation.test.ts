import { describe, expect, it } from "vitest";
import { EMPTY, reduce, type Conversation } from "./conversation";

const asked = (): Conversation =>
  reduce(EMPTY, { type: "ask", id: 1, question: "why?", noteTitle: "N" });

describe("reduce", () => {
  it("ask appends a user turn and an empty assistant turn", () => {
    const c = asked();
    expect(c.turns).toEqual([
      { role: "user", text: "why?", noteTitle: "N" },
      { role: "assistant", text: "" },
    ]);
    expect(c.streaming).toBe(1);
  });

  it("text appends to the last assistant turn; other ids are ignored", () => {
    let c = asked();
    c = reduce(c, { type: "event", id: 1, event: { kind: "text", text: "a" } });
    c = reduce(c, { type: "event", id: 1, event: { kind: "text", text: "b" } });
    expect(c.turns[1].text).toBe("ab");
    const same = reduce(c, {
      type: "event",
      id: 2,
      event: { kind: "text", text: "zzz" },
    });
    expect(same).toBe(c);
  });

  it("a stale stream can't write into a cleared conversation", () => {
    const c = reduce(asked(), { type: "clear" });
    expect(
      reduce(c, { type: "event", id: 1, event: { kind: "text", text: "x" } }),
    ).toEqual(EMPTY);
  });

  it("done clears streaming", () => {
    const c = reduce(asked(), {
      type: "event",
      id: 1,
      event: { kind: "done" },
    });
    expect(c.streaming).toBeNull();
  });

  it("error keeps received text, sets the message and clears streaming", () => {
    let c = asked();
    c = reduce(c, {
      type: "event",
      id: 1,
      event: { kind: "text", text: "par" },
    });
    c = reduce(c, {
      type: "event",
      id: 1,
      event: { kind: "error", message: "boom" },
    });
    expect(c.turns[1]).toEqual({
      role: "assistant",
      text: "par",
      error: "boom",
    });
    expect(c.streaming).toBeNull();
  });

  it("stop clears streaming and keeps the partial text", () => {
    let c = asked();
    c = reduce(c, {
      type: "event",
      id: 1,
      event: { kind: "text", text: "par" },
    });
    c = reduce(c, { type: "stop" });
    expect(c.streaming).toBeNull();
    expect(c.turns[1].text).toBe("par");
  });

  it("clear while streaming empties the turns", () => {
    expect(reduce(asked(), { type: "clear" })).toEqual({
      turns: [],
      streaming: null,
    });
  });
});
