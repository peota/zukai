import { describe, expect, it } from "vitest";
import { joinRel } from "./paths";

describe("joinRel", () => {
  it("uses a backslash for a Windows folder", () => {
    expect(joinRel("C:\\lib", "a/b.md")).toBe("C:\\lib\\a\\b.md");
  });
  it("uses a slash for a POSIX folder", () => {
    expect(joinRel("/home/u/lib", "a/b.md")).toBe("/home/u/lib/a/b.md");
  });
});
