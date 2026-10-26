import type {
  ClosedEntry,
  FileInfo,
  Fingerprint,
  LanguageId,
  TabState,
  WorkspaceState,
} from "./types";
import { ensureOneTab, newTabState } from "./workspace";

export const SESSION_VERSION = 2;
export const CLOSED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionFile {
  version: 2;
  tabs: TabState[];
  activeId: string;
  closed: ClosedEntry[];
}

const LANGUAGES: readonly LanguageId[] = [
  "plaintext",
  "markdown",
  "json",
  "javascript",
  "typescript",
  "html",
  "xml",
  "css",
  "sql",
  "python",
  "yaml",
  "shell",
];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

const HELD: readonly string[] = [
  "conflict",
  "missing",
  "unencodable",
  "readonly",
];

function isFingerprint(v: unknown): v is Fingerprint {
  return (
    isObject(v) &&
    isNum(v.mtimeMs) &&
    isNum(v.size) &&
    typeof v.hash === "string"
  );
}

function isFileInfo(v: unknown): v is FileInfo {
  if (!isObject(v)) return false;
  const f = v.format;
  return (
    typeof v.path === "string" &&
    v.path !== "" &&
    isObject(f) &&
    typeof f.encoding === "string" &&
    typeof f.bom === "boolean" &&
    (f.lineEnding === "lf" || f.lineEnding === "crlf") &&
    typeof f.mixed === "boolean" &&
    (v.fingerprint === null || isFingerprint(v.fingerprint)) &&
    (v.held === null || (typeof v.held === "string" && HELD.includes(v.held)))
  );
}

function isTabState(v: unknown): v is TabState {
  if (!isObject(v)) return false;
  const sel = v.selection;
  return (
    (v.file === undefined || isFileInfo(v.file)) &&
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.renamed === "boolean" &&
    typeof v.language === "string" &&
    (LANGUAGES as readonly string[]).includes(v.language) &&
    typeof v.languagePicked === "boolean" &&
    typeof v.languageGuessed === "boolean" &&
    isObject(sel) &&
    isNum(sel.anchor) &&
    isNum(sel.head) &&
    isNum(v.scrollTop) &&
    typeof v.wrap === "boolean"
  );
}

function isClosedEntry(v: unknown): v is ClosedEntry {
  return (
    isObject(v) && isTabState(v.tab) && isNum(v.index) && isNum(v.closedAt)
  );
}

export function toSessionFile(s: WorkspaceState): SessionFile {
  return {
    version: SESSION_VERSION,
    tabs: s.tabs,
    activeId: s.activeId,
    closed: s.closed,
  };
}

export function parseSessionFile(json: string | null): SessionFile | null {
  if (json === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  // v1 had no File Tabs; its shape is a subset of v2, so it migrates as is.
  if (!isObject(data) || (data.version !== 1 && data.version !== 2)) {
    return null;
  }
  if (
    !Array.isArray(data.tabs) ||
    typeof data.activeId !== "string" ||
    !Array.isArray(data.closed)
  ) {
    return null;
  }
  // A malformed entry is dropped alone; the rest of the session survives.
  return {
    version: SESSION_VERSION,
    tabs: data.tabs.filter(isTabState),
    activeId: data.activeId,
    closed: data.closed.filter(isClosedEntry),
  };
}

export function purgeExpired(
  closed: ClosedEntry[],
  now: number,
): { kept: ClosedEntry[]; expired: ClosedEntry[] } {
  const kept: ClosedEntry[] = [];
  const expired: ClosedEntry[] = [];
  for (const e of closed) {
    // A closed File has no shadow text unless held, so it never expires.
    const forever = e.tab.file !== undefined && e.tab.file.held === null;
    (!forever && now - e.closedAt > CLOSED_TTL_MS ? expired : kept).push(e);
  }
  return { kept, expired };
}

/** A file in `closed/`, as listed by the storage layer. */
export interface ClosedFile {
  id: string;
  modifiedMs: number;
}

/**
 * Rebuild the workspace from session.json and the files on disk.
 * `closedFiles` (when known) is the content of `closed/`: entries whose file
 * is gone are dropped, and files the Session doesn't mention become Recently
 * Closed entries (closedAt = now, reopened at the end), so no closed text is
 * ever stranded and a stale file is not purged in the launch that recovers it.
 */
export function restoreWorkspace(
  file: SessionFile | null,
  scratchpadIds: string[],
  freshId: () => string,
  now: number,
  closedFiles: ClosedFile[] | null,
  grantedPaths: ReadonlySet<string> | null,
  keyOf: (path: string) => string,
): { state: WorkspaceState; expired: ClosedEntry[] } {
  const raw = file ?? { tabs: [], activeId: "", closed: [] };
  // Rust refuses to save a Session naming a File it hasn't granted.
  const granted = (t: TabState) =>
    !t.file || grantedPaths === null || grantedPaths.has(t.file.path);
  const base = {
    ...raw,
    tabs: raw.tabs.filter(granted),
    closed: raw.closed.filter((e) => granted(e.tab)),
  };
  const known = new Set<string>();
  const uniqueTabs = base.tabs.filter((t) => {
    if (known.has(t.id)) return false;
    known.add(t.id);
    return true;
  });
  const orphans = [...scratchpadIds]
    .sort()
    .filter((id) => !known.has(id))
    .map(newTabState);
  const tabs = [...uniqueTabs, ...orphans];
  const activeId = tabs.some((t) => t.id === base.activeId)
    ? base.activeId
    : (tabs[0]?.id ?? "");
  const onDisk = closedFiles && new Set(closedFiles.map((f) => f.id));
  // A closed File's text is on disk (or in its shadow), never in closed/.
  const listed = onDisk
    ? base.closed.filter((e) => e.tab.file || onDisk.has(e.tab.id))
    : base.closed;
  const mentioned = new Set([
    ...tabs.map((t) => t.id),
    ...listed.map((e) => e.tab.id),
  ]);
  const recovered: ClosedEntry[] = (closedFiles ?? [])
    .filter((f) => !mentioned.has(f.id))
    .map((f) => ({
      tab: newTabState(f.id),
      index: tabs.length,
      closedAt: now,
    }));
  const seenPaths = new Set<string>();
  const all = [...listed, ...recovered]
    .sort((x, y) => y.closedAt - x.closedAt)
    .filter((e) => {
      // Newest entry per File path wins.
      if (!e.tab.file) return true;
      const k = keyOf(e.tab.file.path);
      if (seenPaths.has(k)) return false;
      seenPaths.add(k);
      return true;
    });
  const { kept, expired } = purgeExpired(all, now);
  const open = new Set(tabs.map((t) => t.id));
  const closed = kept.filter((e) => {
    if (open.has(e.tab.id)) return false;
    open.add(e.tab.id);
    return true;
  });
  const state = ensureOneTab({ tabs, activeId, closed }, freshId());
  return { state, expired };
}
