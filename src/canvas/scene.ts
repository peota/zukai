/**
 * The `.excalidraw` file format, without loading Excalidraw: whether a text
 * is a drawing, and what about a drawing counts as a change worth saving.
 */

/** An element as far as saving cares; Excalidraw's have many more fields. */
export interface SceneElement {
  id: string;
  version: number;
  isDeleted?: boolean;
}

export interface Scene {
  elements: SceneElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isElement = (v: unknown): v is SceneElement =>
  isObject(v) && typeof v.id === "string" && typeof v.version === "number";

/**
 * A drawing, or not. Blank text (a new canvas) is an empty drawing; anything
 * else must be an Excalidraw scene, or the Tab opens read-only so it's never
 * saved over.
 */
export function parseScene(
  text: string,
): { ok: true; scene: Scene } | { ok: false } {
  if (text.trim() === "") {
    return { ok: true, scene: { elements: [], appState: {}, files: {} } };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (
    !isObject(data) ||
    data.type !== "excalidraw" ||
    !Array.isArray(data.elements) ||
    !data.elements.every(isElement) ||
    (data.appState !== undefined && !isObject(data.appState)) ||
    (data.files !== undefined && !isObject(data.files))
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    scene: {
      elements: data.elements,
      appState: (data.appState as Record<string, unknown> | undefined) ?? {},
      files: (data.files as Record<string, unknown> | undefined) ?? {},
    },
  };
}

/**
 * What a save would change: the ids and versions of the drawn (non-deleted)
 * elements, the ids of the embedded files, and `appState`, the part of the
 * appState the file keeps (what Excalidraw's own export keeps: background,
 * grid). Equal signatures need no save, so scrolling, zooming and selecting
 * never write.
 */
export function sceneSignature(
  elements: readonly SceneElement[],
  files: Readonly<Record<string, unknown>>,
  appState: Readonly<Record<string, unknown>> = {},
): string {
  const drawn = elements
    .filter((e) => !e.isDeleted)
    .map((e) => [e.id, e.version]);
  const kept = Object.keys(appState)
    .sort()
    .map((k) => [k, appState[k]]);
  return JSON.stringify([drawn, Object.keys(files).sort(), kept]);
}
