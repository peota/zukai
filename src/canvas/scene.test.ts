import { describe, expect, it } from "vitest";
import { parseScene, sceneSignature } from "./scene";

const el = (id: string, version: number, isDeleted = false) => ({
  id,
  version,
  isDeleted,
  type: "rectangle",
});

describe("scene", () => {
  it("parseSceneAcceptsValidRejectsInvalid", () => {
    const valid = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: [el("a", 1)],
      appState: { viewBackgroundColor: "#fff" },
      files: { f1: { id: "f1" } },
    });
    const r = parseScene(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scene.elements).toHaveLength(1);
      expect(r.scene.appState).toEqual({ viewBackgroundColor: "#fff" });
      expect(Object.keys(r.scene.files)).toEqual(["f1"]);
    }
    // A new canvas (empty file or scratchpad) is an empty drawing.
    for (const blank of ["", "  \r\n"]) {
      const b = parseScene(blank);
      expect(b).toEqual({
        ok: true,
        scene: { elements: [], appState: {}, files: {} },
      });
    }
    // appState and files may be left out.
    expect(parseScene('{"type":"excalidraw","elements":[]}').ok).toBe(true);

    for (const bad of [
      "not json",
      "[]",
      "null",
      '"excalidraw"',
      '{"elements":[]}',
      '{"type":"excalidrawlib","elements":[]}',
      '{"type":"excalidraw"}',
      '{"type":"excalidraw","elements":{}}',
      '{"type":"excalidraw","elements":[1]}',
      '{"type":"excalidraw","elements":[],"appState":[]}',
      '{"type":"excalidraw","elements":[],"files":"x"}',
    ]) {
      expect(parseScene(bad), bad).toEqual({ ok: false });
    }
  });

  it("sceneSignatureIgnoresViewportAndSelection", () => {
    const elements = [el("a", 1), el("b", 3)];
    const base = sceneSignature(elements, {});
    // The same elements and files: the same signature, whatever else changed
    // (the appState isn't part of it).
    expect(sceneSignature([el("a", 1), el("b", 3)], {})).toBe(base);
    // A changed, added or deleted element, or a new file, changes it.
    expect(sceneSignature([el("a", 2), el("b", 3)], {})).not.toBe(base);
    expect(sceneSignature([...elements, el("c", 1)], {})).not.toBe(base);
    expect(sceneSignature([el("a", 1), el("b", 4, true)], {})).not.toBe(base);
    expect(sceneSignature(elements, { f: { id: "f" } })).not.toBe(base);
    // Deleted elements don't count.
    expect(sceneSignature([...elements, el("z", 9, true)], {})).toBe(base);
  });

  it("sceneSignatureCountsTheExportedAppState", () => {
    const elements = [el("a", 1)];
    const white = { viewBackgroundColor: "#fff", gridSize: 20 };
    const base = sceneSignature(elements, {}, white);
    // Key order doesn't matter; a value does.
    expect(
      sceneSignature(
        elements,
        {},
        { gridSize: 20, viewBackgroundColor: "#fff" },
      ),
    ).toBe(base);
    expect(
      sceneSignature(elements, {}, { ...white, viewBackgroundColor: "#000" }),
    ).not.toBe(base);
    expect(sceneSignature(elements, {}, { ...white, gridSize: 10 })).not.toBe(
      base,
    );
  });
});
