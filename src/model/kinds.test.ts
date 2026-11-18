import { describe, expect, it } from "vitest";
import rust from "../../src-tauri/src/files/exec.rs?raw";
import { EXEC_EXTS, isExecPath, kindOf } from "./kinds";

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
      "x.scr",
      "x.PIF",
      "x.cpl",
      "x.jar",
      "x.hta",
      "x.js",
      "x.wsf",
      "x.reg",
      "x.url",
      "x.appref-ms",
      "x.pkg",
      "x.AppImage",
    ]) {
      expect(isExecPath(p)).toBe(true);
    }
    for (const p of ["/a/x.pdf", "/a/sh", "/a.exe/readme", "x.exe.txt"]) {
      expect(isExecPath(p)).toBe(false);
    }
  });
});

describe("EXEC_EXTS", () => {
  it("is the list Rust enforces (src-tauri/src/files/exec.rs)", () => {
    const lists = [...rust.matchAll(/const \w+: &\[&str\] = &\[([^\]]*)\]/g)];
    const exts = lists.flatMap((m) =>
      [...m[1].matchAll(/"([^"]+)"/g)].map((x) => `.${x[1]}`),
    );
    expect(exts.length).toBeGreaterThan(50);
    expect([...EXEC_EXTS].sort()).toEqual(exts.sort());
  });
});
