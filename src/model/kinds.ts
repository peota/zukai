/**
 * What a Tab edits: text, an Excalidraw drawing, or a read-only image or PDF; or
 * what it shows: a read-only diff of a File against its last commit.
 */
export type Kind = "text" | "canvas" | "image" | "pdf" | "table" | "diff";

export const CANVAS_EXT = ".excalidraw";
export const PDF_EXT = ".pdf";
export const TABLE_EXTS: readonly string[] = [".csv", ".tsv"];
export const IMAGE_EXTS: readonly string[] = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
];
/**
 * Files "Open with default app" never launches (they would run or install
 * something), every OS's list on every OS. Mirrors `src-tauri/src/files/exec.rs`,
 * which is the check that counts (it also refuses Unix files with an execute
 * bit, and what Windows calls dangerous); this only hides the button.
 */
export const EXEC_EXTS: readonly string[] = [
  // Windows
  ".exe",
  ".com",
  ".msi",
  ".msp",
  ".msix",
  ".msixbundle",
  ".appx",
  ".appxbundle",
  ".appref-ms",
  ".application",
  ".bat",
  ".cmd",
  ".ps1",
  ".psm1",
  ".psd1",
  ".ps1xml",
  ".vbs",
  ".vbe",
  ".js",
  ".jse",
  ".wsf",
  ".wsh",
  ".ws",
  ".wsc",
  ".hta",
  ".scr",
  ".pif",
  ".cpl",
  ".msc",
  ".jar",
  ".jnlp",
  ".reg",
  ".url",
  ".website",
  ".lnk",
  ".scf",
  ".settingcontent-ms",
  ".library-ms",
  ".search-ms",
  ".inf",
  ".chm",
  ".gadget",
  ".xll",
  ".xbap",
  ".py",
  ".pyw",
  ".pyz",
  ".pyzw",
  ".pl",
  ".rb",
  // macOS
  ".app",
  ".command",
  ".pkg",
  ".mpkg",
  ".terminal",
  ".workflow",
  ".action",
  ".tool",
  ".fileloc",
  ".inetloc",
  ".webloc",
  ".mobileconfig",
  // Linux
  ".desktop",
  ".sh",
  ".run",
  ".bin",
  ".appimage",
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
  if (ext === PDF_EXT) return "pdf";
  if (TABLE_EXTS.includes(ext)) return "table";
  return IMAGE_EXTS.includes(ext) ? "image" : "text";
}

/** Kinds whose document is text in EditorHost: "text" and "table". */
export function isTextKind(kind: Kind | undefined): boolean {
  return kind === "text" || kind === "table";
}

/** Read-only Kinds whose text is never kept, shadowed or saved. */
export function isViewerKind(kind: Kind | undefined): boolean {
  return kind === "image" || kind === "pdf";
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
