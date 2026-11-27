import { describe, expect, it } from "vitest";
import rust from "../../src-tauri/src/files/exec.rs?raw";
import {
  EXEC_EXTS,
  isExecPath,
  isTextKind,
  isViewerKind,
  kindOf,
} from "./kinds";

describe("kindOf", () => {
  it("kindOfByExtension", () => {
    expect(kindOf("a.EXCALIDRAW")).toBe("canvas");
    expect(kindOf("x.PNG")).toBe("image");
    expect(kindOf("x.svg")).toBe("image");
    expect(kindOf("C:\\docs\\Spec.PDF")).toBe("pdf");
    expect(kindOf("x.md")).toBe("text");
    expect(kindOf("Makefile")).toBe("text");
    expect(kindOf("C:\\d.png\\Makefile")).toBe("text");
  });
});

describe("table Kind", () => {
  it("opens .csv and .tsv as a table, and is a text Kind", () => {
    expect(kindOf("x.CSV")).toBe("table");
    expect(kindOf("a/b.tsv")).toBe("table");
    expect(isTextKind("table")).toBe(true);
    expect(isTextKind("text")).toBe(true);
    expect(isTextKind("canvas")).toBe(false);
    expect(isTextKind(undefined)).toBe(false);
    expect(isViewerKind("table")).toBe(false);
  });
});

describe("isViewerKind", () => {
  it("is true for the read-only Kinds that never keep text", () => {
    expect(isViewerKind("pdf")).toBe(true);
    expect(isViewerKind("image")).toBe(true);
    expect(isViewerKind("text")).toBe(false);
    expect(isViewerKind("canvas")).toBe(false);
    expect(isViewerKind("diff")).toBe(false);
    expect(isViewerKind(undefined)).toBe(false);
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
      "x.fileloc",
      "x.inetloc",
      "x.Webloc",
      "x.mobileconfig",
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
