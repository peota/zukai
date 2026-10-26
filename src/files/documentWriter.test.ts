import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDocumentWriter,
  type DocumentWriterDeps,
} from "./documentWriter";
import type { FileInfo, Fingerprint, TabState } from "../model/types";
import { newTabState } from "../model/workspace";

const fp = (hash: string): Fingerprint => ({ mtimeMs: 1, size: 1, hash });

const fileInfo = (over: Partial<FileInfo> = {}): FileInfo => ({
  path: "/d/a.txt",
  format: { encoding: "utf-8", bom: false, lineEnding: "lf", mixed: false },
  fingerprint: fp("old"),
  held: null,
  ...over,
});

let tabs: Map<string, TabState>;
let deps: {
  [K in keyof DocumentWriterDeps]-?: ReturnType<typeof vi.fn> &
    NonNullable<DocumentWriterDeps[K]>;
};

beforeEach(() => {
  tabs = new Map();
  deps = {
    getTab: vi.fn((id: string) => tabs.get(id)),
    patchFile: vi.fn((id: string, f: FileInfo) => {
      const t = tabs.get(id);
      if (t) tabs.set(id, { ...t, file: f });
    }),
    writeScratchpad: vi.fn().mockResolvedValue(undefined),
    fileWrite: vi.fn(),
    fileFingerprint: vi.fn(),
    shadowWrite: vi.fn().mockResolvedValue(undefined),
    shadowDelete: vi.fn().mockResolvedValue(undefined),
    onWritten: vi.fn(),
  } as unknown as typeof deps;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const withFile = (id: string, f: FileInfo) =>
  tabs.set(id, { ...newTabState(id), file: f });

describe("documentWriter", () => {
  it("scratchpadWritesScratchpad", async () => {
    tabs.set("s", newTabState("s"));
    await createDocumentWriter(deps)("s", "hello");
    expect(deps.writeScratchpad).toHaveBeenCalledWith("s", "hello");
    expect(deps.fileWrite).not.toHaveBeenCalled();
    expect(deps.shadowWrite).not.toHaveBeenCalled();
    expect(deps.onWritten).toHaveBeenCalledWith("s", "hello");
  });

  it("fileWrittenUpdatesFingerprintAndClearsShadow", async () => {
    const f = fileInfo();
    withFile("f", f);
    deps.fileWrite.mockResolvedValue({
      kind: "written",
      fingerprint: fp("new"),
    });
    await createDocumentWriter(deps)("f", "text");
    expect(deps.fileWrite).toHaveBeenCalledWith(
      f.path,
      "text",
      f.format,
      fp("old"),
    );
    expect(tabs.get("f")!.file!.fingerprint).toEqual(fp("new"));
    expect(tabs.get("f")!.file!.held).toBeNull();
    expect(deps.shadowDelete).toHaveBeenCalledWith("f");
    expect(deps.shadowWrite).not.toHaveBeenCalled();
    expect(deps.onWritten).toHaveBeenCalledWith("f", "text");
  });

  it("writes with the Tab's current format", async () => {
    withFile("f", fileInfo());
    deps.fileWrite.mockResolvedValue({ kind: "written", fingerprint: fp("n") });
    const write = createDocumentWriter(deps);
    const crlf = { ...fileInfo().format, lineEnding: "crlf" as const };
    withFile("f", fileInfo({ format: crlf }));
    await write("f", "x");
    expect(deps.fileWrite.mock.calls[0][2]).toEqual(crlf);
  });

  it("conflictOutcomeHoldsAndWritesShadow", async () => {
    withFile("f", fileInfo());
    deps.fileWrite.mockResolvedValue({
      kind: "conflict",
      fingerprint: fp("theirs"),
    });
    await createDocumentWriter(deps)("f", "mine");
    expect(tabs.get("f")!.file!.held).toBe("conflict");
    expect(deps.shadowWrite).toHaveBeenCalledWith("f", "mine");
    expect(deps.shadowDelete).not.toHaveBeenCalled();
    expect(deps.onWritten).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "missing" }, "missing"],
    [{ kind: "unencodable", ch: "😀", line: 1, col: 1 }, "unencodable"],
  ] as const)("holds on %o", async (outcome, held) => {
    withFile("f", fileInfo());
    deps.fileWrite.mockResolvedValue(outcome);
    await createDocumentWriter(deps)("f", "mine");
    expect(tabs.get("f")!.file!.held).toBe(held);
    expect(deps.shadowWrite).toHaveBeenCalledWith("f", "mine");
  });

  it("heldFileWritesShadowOnly", async () => {
    withFile("f", fileInfo({ held: "conflict" }));
    await createDocumentWriter(deps)("f", "mine");
    expect(deps.shadowWrite).toHaveBeenCalledWith("f", "mine");
    expect(deps.fileWrite).not.toHaveBeenCalled();
    expect(deps.writeScratchpad).not.toHaveBeenCalled();
  });

  it("an unknown fingerprint never writes: it holds after re-reading the disk", async () => {
    withFile("f", fileInfo({ fingerprint: null }));
    deps.fileFingerprint.mockResolvedValue(fp("disk"));
    await createDocumentWriter(deps)("f", "mine");
    expect(deps.fileWrite).not.toHaveBeenCalled();
    expect(tabs.get("f")!.file!.held).toBe("conflict");
    expect(deps.shadowWrite).toHaveBeenCalledWith("f", "mine");

    withFile("g", fileInfo({ fingerprint: null }));
    deps.fileFingerprint.mockResolvedValue(null);
    await createDocumentWriter(deps)("g", "mine");
    expect(tabs.get("g")!.file!.held).toBe("missing");
  });

  it("ignores an outcome for a path the Tab has since left", async () => {
    withFile("f", fileInfo());
    deps.fileWrite.mockImplementation(async () => {
      withFile("f", fileInfo({ path: "/d/b.txt", fingerprint: fp("b") }));
      return { kind: "written", fingerprint: fp("a2") };
    });
    await createDocumentWriter(deps)("f", "x");
    expect(tabs.get("f")!.file!.fingerprint).toEqual(fp("b"));
    expect(deps.onWritten).not.toHaveBeenCalled();
  });

  it("shadowFailureRejects", async () => {
    withFile("f", fileInfo({ held: "missing" }));
    deps.shadowWrite.mockRejectedValue({ kind: "io", message: "disk full" });
    await expect(createDocumentWriter(deps)("f", "mine")).rejects.toEqual({
      kind: "io",
      message: "disk full",
    });
  });

  it("only the writes themselves reject", async () => {
    withFile("f", fileInfo());
    deps.fileWrite.mockResolvedValue({ kind: "written", fingerprint: fp("n") });
    deps.shadowDelete.mockRejectedValue(new Error("locked"));
    await expect(createDocumentWriter(deps)("f", "x")).resolves.toBeUndefined();

    deps.fileWrite.mockRejectedValue({ kind: "io", message: "denied" });
    await expect(createDocumentWriter(deps)("f", "x")).rejects.toEqual({
      kind: "io",
      message: "denied",
    });
    tabs.set("s", newTabState("s"));
    deps.writeScratchpad.mockRejectedValue(new Error("full"));
    await expect(createDocumentWriter(deps)("s", "x")).rejects.toThrow("full");
  });
});
