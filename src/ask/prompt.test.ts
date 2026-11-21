import { describe, expect, it } from "vitest";
import { NOTE_LIMIT, buildSystem } from "./prompt";

describe("buildSystem", () => {
  it("wraps the note with its title and language", () => {
    const s = buildSystem({
      title: "Deploy log",
      language: "bash",
      text: "echo hi",
    });
    expect(typeof s).toBe("string");
    const str = s as string;
    expect(str).toContain("Deploy log");
    expect(str).toContain("bash");
    expect(str).toMatch(/<note>[\s\S]*echo hi[\s\S]*<\/note>/);
  });

  it("tells the model how to treat the note and hidden text", () => {
    const str = buildSystem({
      title: "t",
      language: "ts",
      text: "x",
    }) as string;
    expect(str).toMatch(/answer from the note/i);
    expect(str).toMatch(/does not contain the answer/i);
    expect(str).toContain("[hidden]");
    expect(str).toMatch(/do not guess/i);
  });

  it("refuses a note over the limit", () => {
    expect(NOTE_LIMIT).toBe(200_000);
    expect(
      buildSystem({
        title: "t",
        language: "ts",
        text: "a".repeat(NOTE_LIMIT + 1),
      }),
    ).toEqual({ tooLong: true });
    expect(
      typeof buildSystem({
        title: "t",
        language: "ts",
        text: "a".repeat(NOTE_LIMIT),
      }),
    ).toBe("string");
  });
});
