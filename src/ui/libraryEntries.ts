import type { Entry } from "../library/api";

/**
 * Why Zukai can't act on an entry (open, rename, move, delete), or null.
 * Rust refuses links that resolve outside the Library, and Windows can't
 * address names ending in a dot or a space.
 */
export function entryBlocked(e: Entry): string | null {
  if (e.link === "outside") {
    return "This link points outside the Library, so Zukai can't open it.";
  }
  if (/[. ]$/.test(e.name)) {
    return "Names that end in a dot or space can't be opened on Windows.";
  }
  return null;
}

const trimSeps = (p: string) => p.replace(/[\\/]+$/, "");

/** Same folder, ignoring a trailing separator. */
export function sameDir(a: string, b: string): boolean {
  return trimSeps(a) === trimSeps(b);
}

/** True when `p` is strictly inside `base`. */
export function isUnder(p: string, base: string): boolean {
  const b = trimSeps(base);
  const c = p[b.length];
  return (
    p.startsWith(b) && (c === "/" || c === "\\") && p.length > b.length + 1
  );
}

/** The folder holding `p`. */
export function parentOf(p: string): string {
  const t = trimSeps(p);
  return t.slice(0, Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\")));
}

/** Splits a File name into the editable stem and the fixed extension. */
export function splitName(name: string, isDir: boolean) {
  const dot = name.lastIndexOf(".");
  if (isDir || dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}
