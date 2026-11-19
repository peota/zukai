import type { FileInfo, Fingerprint } from "../model/types";
import type { WriteOutcome } from "./api";

export type DiskEvent =
  | { kind: "changed"; disk: Fingerprint }
  | { kind: "removed" }
  | { kind: "reappeared"; disk: Fingerprint };

export type FileAction = "ignore" | "reload" | "conflict" | "missing";

/** An empty hash means "unread": it never matches anything. */
export function sameContent(a: Fingerprint | null, b: Fingerprint): boolean {
  return a !== null && a.hash !== "" && b.hash !== "" && a.hash === b.hash;
}

export function decide(
  file: FileInfo,
  ev: DiskEvent,
  hasPending: boolean,
): FileAction {
  if (ev.kind === "removed") return "missing";
  if (file.held === "conflict") return "conflict";
  // A missing File that reappears must reload even if the bytes match.
  if (file.held !== "missing" && sameContent(file.fingerprint, ev.disk)) {
    return "ignore";
  }
  return hasPending ? "conflict" : "reload";
}

/** True if the Tab's text lives in its shadow rather than in the File. */
export function inShadow(file: FileInfo): boolean {
  return (
    file.unsaved === true || (file.held !== null && file.held !== "readonly")
  );
}

export function onWriteOutcome(
  file: FileInfo,
  outcome: WriteOutcome,
): FileInfo {
  switch (outcome.kind) {
    case "written": {
      // The whole File now has one Line ending: "Mixed" is over.
      const written: FileInfo = {
        ...file,
        format: { ...file.format, mixed: false },
        fingerprint: outcome.fingerprint,
        held: null,
      };
      delete written.unsaved;
      delete written.diskFormat;
      return written;
    }
    case "conflict":
      return { ...file, held: "conflict" };
    case "missing":
      return { ...file, held: "missing" };
    case "unencodable":
      return { ...file, held: "unencodable" };
  }
}
