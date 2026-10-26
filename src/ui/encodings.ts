import type { FileFormat } from "../model/types";

/** How the status bar and bars name an encoding (labels are WHATWG, lower-case). */
export function encodingName(label: string): string {
  if (label === "utf-8") return "UTF-8";
  if (label === "utf-16le") return "UTF-16 LE";
  if (label === "utf-16be") return "UTF-16 BE";
  if (label.startsWith("windows-")) return `Windows-${label.slice(8)}`;
  return label.toUpperCase();
}

export function encodingLabel(format: FileFormat): string {
  const name = encodingName(format.encoding);
  // A BOM is the norm for UTF-16; only UTF-8 names it.
  return format.encoding === "utf-8" && format.bom ? `${name} BOM` : name;
}

export function lineEndingLabel(format: FileFormat): string {
  if (format.mixed) return "Mixed";
  return format.lineEnding === "crlf" ? "CRLF" : "LF";
}

/** The encodings offered by "Reopen with encoding…" and "Convert to…". */
export const COMMON_ENCODINGS: readonly string[] = [
  "utf-8",
  "utf-16le",
  "utf-16be",
  "windows-1252",
  "windows-1250",
  "windows-1251",
  "windows-1253",
  "windows-1254",
  "windows-1255",
  "windows-1256",
  "windows-1257",
  "windows-1258",
  "windows-874",
  "iso-8859-2",
  "iso-8859-5",
  "iso-8859-7",
  "iso-8859-15",
  "koi8-r",
  "koi8-u",
  "ibm866",
  "macintosh",
  "shift_jis",
  "euc-jp",
  "gbk",
  "gb18030",
  "big5",
  "euc-kr",
];

/** The format patch for "Convert to <label>": UTF-16 always gets a BOM. */
export function convertPatch(label: string): Partial<FileFormat> {
  return { encoding: label, bom: label.startsWith("utf-16") };
}
