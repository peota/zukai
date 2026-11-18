import { describe, expect, it } from "vitest";
import { isExecPath, kindOf } from "./kinds";

describe("kindOf", () => {
  it("kindOfByExtension", () => {
    expect(kindOf("a.EXCALIDRAW")).toBe("canvas");
    expect(kindOf("x.PNG")).toBe("image");
    expect(kindOf("x.svg")).toBe("image");
    expect(kindOf("x.md")).toBe("text");
    expect(kindOf("Makefile")).toBe("text");
    expect(kindOf("C:\\d.png\\Makefile")).toBe("text");
  });
});

describe("isExecPath", () => {
  it("matches EXEC_EXTS in any case, ignoring trailing dots and spaces", () => {
    for (const p of [
      "/a/x.EXE",
      "/a/run.sh",
      "x.Lnk",
      "go.cmd. ",
      "/a/b.command",
    ]) {
      expect(isExecPath(p)).toBe(true);
    }
    for (const p of ["/a/x.pdf", "/a/sh", "/a.exe/readme", "x.exe.txt"]) {
      expect(isExecPath(p)).toBe(false);
    }
  });
});
