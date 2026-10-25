import type {
  ClosedEntry,
  LanguageId,
  TabState,
  WorkspaceState,
} from "./types";
import { ensureOneTab, newTabState } from "./workspace";

export const SESSION_VERSION = 1;
export const CLOSED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionFile {
  version: 1;
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

function isTabState(v: unknown): v is TabState {
  if (!isObject(v)) return false;
  const sel = v.selection;
  return (
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
  if (!isObject(data) || data.version !== SESSION_VERSION) return null;
  if (
    !Array.isArray(data.tabs) ||
    !data.tabs.every(isTabState) ||
    typeof data.activeId !== "string" ||
    !Array.isArray(data.closed) ||
    !data.closed.every(isClosedEntry)
  ) {
    return null;
  }
  return {
    version: SESSION_VERSION,
    tabs: data.tabs,
    activeId: data.activeId,
    closed: data.closed,
  };
}

export function purgeExpired(
  closed: ClosedEntry[],
  now: number,
): { kept: ClosedEntry[]; expired: ClosedEntry[] } {
  const kept: ClosedEntry[] = [];
  const expired: ClosedEntry[] = [];
  for (const e of closed) {
    (now - e.closedAt > CLOSED_TTL_MS ? expired : kept).push(e);
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
 * Closed entries (closedAt = file time, reopened at the end), so no closed
 * text is ever stranded and the 30-day purge reaches it.
 */
export function restoreWorkspace(
  file: SessionFile | null,
  scratchpadIds: string[],
  freshId: () => string,
  now: number,
  closedFiles: ClosedFile[] | null = null,
): { state: WorkspaceState; expired: ClosedEntry[] } {
  const base = file ?? { tabs: [], activeId: "", closed: [] };
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
  const listed = onDisk
    ? base.closed.filter((e) => onDisk.has(e.tab.id))
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
      closedAt: f.modifiedMs,
    }));
  const all = [...listed, ...recovered].sort((x, y) => y.closedAt - x.closedAt);
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
