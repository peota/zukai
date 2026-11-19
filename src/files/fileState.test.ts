import { describe, expect, it } from "vitest";
import { pathKey } from "./api";
import { decide, inShadow, onWriteOutcome } from "./fileState";
import type { FileInfo, Fingerprint } from "../model/types";

const fp = (hash: string): Fingerprint => ({ mtimeMs: 1, size: 1, hash });
const file = (
  held: FileInfo["held"] = null,
  fingerprint: Fingerprint | null = fp("a"),
): FileInfo => ({
  path: "p",
  format: { encoding: "utf-8", bom: false, lineEnding: "lf", mixed: false },
  fingerprint,
  held,
});

describe("decide", () => {
  it("ignores a change with the same hash", () => {
    expect(decide(file(), { kind: "changed", disk: fp("a") }, true)).toBe(
      "ignore",
    );
  });
  it("reloads a different hash without pending edits", () => {
    expect(decide(file(), { kind: "changed", disk: fp("b") }, false)).toBe(
      "reload",
    );
  });
  it("conflicts a different hash with pending edits", () => {
    expect(decide(file(), { kind: "changed", disk: fp("b") }, true)).toBe(
      "conflict",
    );
  });
  it("removed is missing", () => {
    expect(decide(file(), { kind: "removed" }, false)).toBe("missing");
    expect(decide(file(), { kind: "removed" }, true)).toBe("missing");
  });
  it("reappeared follows the changed rules", () => {
    expect(decide(file(), { kind: "reappeared", disk: fp("b") }, false)).toBe(
      "reload",
    );
    expect(decide(file(), { kind: "reappeared", disk: fp("b") }, true)).toBe(
      "conflict",
    );
  });
  it("a held conflict stays a conflict", () => {
    expect(
      decide(file("conflict"), { kind: "changed", disk: fp("b") }, false),
    ).toBe("conflict");
    expect(
      decide(file("conflict"), { kind: "changed", disk: fp("a") }, false),
    ).toBe("conflict");
  });
  it("missing plus reappeared without pending edits reloads, even if bytes match", () => {
    expect(
      decide(file("missing"), { kind: "reappeared", disk: fp("b") }, false),
    ).toBe("reload");
    expect(
      decide(file("missing"), { kind: "reappeared", disk: fp("a") }, false),
    ).toBe("reload");
    expect(
      decide(file("missing"), { kind: "reappeared", disk: fp("b") }, true),
    ).toBe("conflict");
  });
  it("never treats an empty hash as matching", () => {
    expect(
      decide(file(null, fp("")), { kind: "changed", disk: fp("") }, false),
    ).toBe("reload");
    expect(
      decide(file(null, fp("")), { kind: "changed", disk: fp("") }, true),
    ).toBe("conflict");
    expect(decide(file(), { kind: "changed", disk: fp("") }, false)).toBe(
      "reload",
    );
    expect(
      decide(file(null, null), { kind: "changed", disk: fp("a") }, false),
    ).toBe("reload");
  });
});

describe("onWriteOutcome", () => {
  it("sets the fingerprint and clears held on written", () => {
    const out = onWriteOutcome(file("conflict"), {
      kind: "written",
      fingerprint: fp("z"),
    });
    expect(out.fingerprint).toEqual(fp("z"));
    expect(out.held).toBeNull();
  });
  it("clears Mixed on written (the File now has one Line ending)", () => {
    const mixed = file();
    mixed.format = { ...mixed.format, mixed: true };
    const out = onWriteOutcome(mixed, {
      kind: "written",
      fingerprint: fp("z"),
    });
    expect(out.format.mixed).toBe(false);
    expect(onWriteOutcome(mixed, { kind: "missing" }).format.mixed).toBe(true);
  });
  it("holds on conflict, missing and unencodable", () => {
    expect(
      onWriteOutcome(file(), { kind: "conflict", fingerprint: fp("q") }).held,
    ).toBe("conflict");
    expect(onWriteOutcome(file(), { kind: "missing" }).held).toBe("missing");
    expect(
      onWriteOutcome(file(), { kind: "unencodable", ch: "x", line: 1, col: 1 })
        .held,
    ).toBe("unencodable");
  });
  it("keeps the old fingerprint when held", () => {
    expect(
      onWriteOutcome(file(), { kind: "conflict", fingerprint: fp("q") })
        .fingerprint,
    ).toEqual(fp("a"));
  });
});

describe("pathKey", () => {
  it("lowercases on windows and mac only", () => {
    expect(pathKey("C:/A.TXT", "windows")).toBe("c:/a.txt");
    expect(pathKey("/A", "mac")).toBe("/a");
    expect(pathKey("/A", "other")).toBe("/A");
  });
});

describe("inShadow", () => {
  it("is true for an unsaved File and for held reasons other than readonly", () => {
    expect(inShadow({ ...file(), unsaved: true })).toBe(true);
    expect(inShadow(file("conflict"))).toBe(true);
    expect(inShadow(file("missing"))).toBe(true);
    expect(inShadow(file("unencodable"))).toBe(true);
  });
  it("is false for a clean File and for readonly", () => {
    expect(inShadow(file())).toBe(false);
    expect(inShadow(file("readonly"))).toBe(false);
  });
});

describe("onWriteOutcome unsaved state", () => {
  it("drops unsaved and diskFormat on written", () => {
    const f: FileInfo = {
      ...file(),
      unsaved: true,
      diskFormat: {
        encoding: "utf-16le",
        bom: true,
        lineEnding: "crlf",
        mixed: false,
      },
    };
    const r = onWriteOutcome(f, { kind: "written", fingerprint: fp("z") });
    expect("unsaved" in r).toBe(false);
    expect("diskFormat" in r).toBe(false);
  });
});
