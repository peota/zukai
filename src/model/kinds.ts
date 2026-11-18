/** What a Tab edits: text, an Excalidraw drawing, or a read-only image. */
export type Kind = "text" | "canvas" | "image";

export const CANVAS_EXT = ".excalidraw";
export const IMAGE_EXTS: readonly string[] = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
];
/** Files the Library never opens (it would run or install them). */
export const EXEC_EXTS: readonly string[] = [
  ".exe",
  ".com",
  ".msi",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".lnk",
  ".app",
  ".desktop",
  ".sh",
  ".command",
];

/** The Kind a path opens as, by extension (case-insensitive). */
export function kindOf(path: string): Kind {
  const name = path.slice(
    Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1,
  );
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "text";
  const ext = name.slice(dot).toLowerCase();
  if (ext === CANVAS_EXT) return "canvas";
  return IMAGE_EXTS.includes(ext) ? "image" : "text";
}

/**
 * True if the opener must never launch `path` (an `EXEC_EXTS` extension,
 * any case; Windows ignores trailing dots and spaces). Only hides the
 * button: Rust refuses them again.
 */
export function isExecPath(path: string): boolean {
  const name = path
    .slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1)
    .replace(/[. ]+$/, "");
  const dot = name.lastIndexOf(".");
  return dot >= 0 && EXEC_EXTS.includes(name.slice(dot).toLowerCase());
}
