import { describe, expect, it } from "vitest";
import { HIDDEN_MARK, redact } from "./redact";

describe("redact", () => {
  it("replaces a hidden range with the mark", () => {
    expect(HIDDEN_MARK).toBe("[hidden]");
    expect(redact("user: bob pw: hunter2", [[14, 21]])).toBe(
      "user: bob pw: [hidden]",
    );
  });

  it("merges unsorted, overlapping and touching ranges", () => {
    expect(
      redact("0123456789abcdef", [
        [10, 12],
        [0, 3],
        [2, 5],
        [5, 6],
      ]),
    ).toBe("[hidden]6789[hidden]cdef");
  });

  it("clamps a range past the end", () => {
    expect(redact("abcdef", [[3, 99]])).toBe("abc[hidden]");
  });

  it("ignores an empty range", () => {
    expect(redact("abcdef", [[2, 2]])).toBe("abcdef");
  });
});
