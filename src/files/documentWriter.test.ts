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
    autosaveFiles: vi.fn(() => false),
    diskText: vi.fn(() => "disk"),
    onWritten: vi.fn(),
    isUnreadable: vi.fn(() => false),
    isLoaded: vi.fn(() => true),
  } as unknown as typeof deps;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const withFile = (id: string, f: FileInfo) =>
  tabs.set(id, { ...newTabState(id), file: f });

describe("documentWriter", () => {
  it("refuses (rejects) a write for a Tab whose text never loaded", async () => {
    withFile("f", fileInfo());
    tabs.set("s", newTabState("s"));
    deps.isLoaded.mockReturnValue(false);
    const write = createDocumentWriter(deps);
    await expect(write("f", "")).rejects.toThrow(/never loaded/);
    await expect(write("s", "")).rejects.toThrow(/never loaded/);
    expect(deps.fileWrite).not.toHaveBeenCalled();
    expect(deps.fileFingerprint).not.toHaveBeenCalled();
    expect(deps.writeScratchpad).not.toHaveBeenCalled();
    expect(deps.shadowWrite).not.toHaveBeenCalled();
    expect(deps.shadowDelete).not.toHaveBeenCalled();
    expect(deps.onWritten).not.toHaveBeenCalled();
  });

  it("canvasScratchpadWritesExcalidraw", async () => {
    tabs.set("c", newTabState("c", "canvas"));
    await createDocumentWriter(deps)("c", "{}");
    expect(deps.writeScratchpad).toHaveBeenCalledWith("c", "{}", "excalidraw");
  });

  it("scratchpadWritesScratchpad", async () => {
    tabs.set("s", newTabState("s"));
    await createDocumentWriter(deps)("s", "hello");
    expect(deps.writeScratchpad).toHaveBeenCalledWith("s", "hello", "txt");
    expect(deps.fileWrite).not.toHaveBeenCalled();
    expect(deps.shadowWrite).not.toHaveBeenCalled();
    expect(deps.onWritten).toHaveBeenCalledWith("s", "hello");
  });

  it("fileWrittenUpdatesFingerprintAndClearsShadow", async () => {
    deps.autosaveFiles.mockReturnValue(true);
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
    deps.autosaveFiles.mockReturnValue(true);
    withFile("f", fileInfo());
    deps.fileWrite.mockResolvedValue({ kind: "written", fingerprint: fp("n") });
    const write = createDocumentWriter(deps);
    const crlf = { ...fileInfo().format, lineEnding: "crlf" as const };
    withFile("f", fileInfo({ format: crlf }));
    await write("f", "x");
    expect(deps.fileWrite.mock.calls[0][2]).toEqual(crlf);
  });

  it("conflictOutcomeHoldsAndWritesShadow", async () => {
    deps.autosaveFiles.mockReturnValue(true);
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
    deps.autosaveFiles.mockReturnValue(true);
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
    deps.autosaveFiles.mockReturnValue(true);
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
    deps.autosaveFiles.mockReturnValue(true);
    withFile("f", fileInfo());
    deps.fileWrite.mockImplementation(async () => {
      withFile("f", fileInfo({ path: "/d/b.txt", fingerprint: fp("b") }));
      return { kind: "written", fingerprint: fp("a2") };
    });
    await createDocumentWriter(deps)("f", "x");
    expect(tabs.get("f")!.file!.fingerprint).toEqual(fp("b"));
    expect(deps.onWritten).not.toHaveBeenCalled();
  });

  it("never writes a Tab whose shadow can't be read", async () => {
    withFile("f", fileInfo({ held: null }));
    tabs.set("s", newTabState("s"));
    deps.isUnreadable.mockReturnValue(true);
    const write = createDocumentWriter(deps);
    await expect(write("f", "")).resolves.toBeUndefined();
    await expect(write("s", "")).resolves.toBeUndefined();
    withFile("h", fileInfo({ held: "unencodable" }));
    await expect(write("h", "")).resolves.toBeUndefined();
    expect(deps.fileWrite).not.toHaveBeenCalled();
    expect(deps.writeScratchpad).not.toHaveBeenCalled();
    expect(deps.shadowWrite).not.toHaveBeenCalled();
    expect(deps.shadowDelete).not.toHaveBeenCalled();
    expect(deps.fileFingerprint).not.toHaveBeenCalled();
    expect(deps.patchFile).not.toHaveBeenCalled();
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
    deps.autosaveFiles.mockReturnValue(true);
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

  describe("manual mode (autosave off)", () => {
    it("manual mode writes the shadow and marks the File unsaved", async () => {
      withFile("f", fileInfo());
      await createDocumentWriter(deps)("f", "typed");
      expect(deps.shadowWrite).toHaveBeenCalledWith("f", "typed");
      expect(deps.fileWrite).not.toHaveBeenCalled();
      expect(deps.onWritten).not.toHaveBeenCalled();
      expect(tabs.get("f")!.file!.unsaved).toBe(true);
    });

    it("manual mode deletes the shadow and clears unsaved when the text matches the disk again", async () => {
      withFile("f", fileInfo({ unsaved: true }));
      await createDocumentWriter(deps)("f", "disk");
      expect(deps.shadowDelete).toHaveBeenCalledWith("f");
      expect(deps.shadowWrite).not.toHaveBeenCalled();
      expect(deps.fileWrite).not.toHaveBeenCalled();
      expect(tabs.get("f")!.file!.unsaved).toBeUndefined();
    });

    it("manual mode keeps unsaved while a format change is pending", async () => {
      const diskFormat = { ...fileInfo().format, lineEnding: "crlf" as const };
      withFile("f", fileInfo({ unsaved: true, diskFormat }));
      await createDocumentWriter(deps)("f", "disk");
      expect(deps.shadowWrite).toHaveBeenCalledWith("f", "disk");
      expect(deps.shadowDelete).not.toHaveBeenCalled();
      expect(tabs.get("f")!.file!.unsaved).toBe(true);
    });

    it("save mode writes the File and clears unsaved and diskFormat", async () => {
      const diskFormat = { ...fileInfo().format, lineEnding: "crlf" as const };
      const f = fileInfo({ unsaved: true, diskFormat });
      withFile("f", f);
      deps.fileWrite.mockResolvedValue({
        kind: "written",
        fingerprint: fp("new"),
      });
      await createDocumentWriter(deps)("f", "typed", "save");
      expect(deps.fileWrite).toHaveBeenCalledWith(
        f.path,
        "typed",
        f.format,
        fp("old"),
      );
      const after = tabs.get("f")!.file!;
      expect(after.unsaved).toBeUndefined();
      expect(after.diskFormat).toBeUndefined();
      expect(deps.shadowDelete).toHaveBeenCalledWith("f");
      expect(deps.onWritten).toHaveBeenCalledWith("f", "typed");
    });

    it("save mode on a conflict holds and keeps the shadow", async () => {
      withFile("f", fileInfo());
      deps.fileWrite.mockResolvedValue({
        kind: "conflict",
        fingerprint: fp("theirs"),
      });
      await createDocumentWriter(deps)("f", "mine", "save");
      expect(tabs.get("f")!.file!.held).toBe("conflict");
      expect(deps.shadowWrite).toHaveBeenCalledWith("f", "mine");
      expect(deps.shadowDelete).not.toHaveBeenCalled();
      expect(deps.onWritten).not.toHaveBeenCalled();
    });

    it("a Convert landing during the shadow write keeps its format", async () => {
      withFile("f", fileInfo());
      const crlf = { ...fileInfo().format, lineEnding: "crlf" as const };
      deps.shadowWrite.mockImplementation(async () => {
        withFile("f", fileInfo({ format: crlf }));
      });
      await createDocumentWriter(deps)("f", "typed");
      const after = tabs.get("f")!.file!;
      expect(after.format).toEqual(crlf);
      expect(after.unsaved).toBe(true);
    });

    it("an unknown disk text means shadow and unsaved", async () => {
      withFile("f", fileInfo());
      deps.diskText.mockReturnValue(undefined);
      await createDocumentWriter(deps)("f", "");
      expect(deps.shadowWrite).toHaveBeenCalledWith("f", "");
      expect(deps.shadowDelete).not.toHaveBeenCalled();
      expect(tabs.get("f")!.file!.unsaved).toBe(true);
    });

    it("scratchpads ignore the setting", async () => {
      tabs.set("s", newTabState("s"));
      await createDocumentWriter(deps)("s", "hello");
      expect(deps.writeScratchpad).toHaveBeenCalledWith("s", "hello", "txt");
      expect(deps.shadowWrite).not.toHaveBeenCalled();
    });
  });
});
