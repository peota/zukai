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

export function restoreWorkspace(
  file: SessionFile | null,
  scratchpadIds: string[],
  freshId: () => string,
  now: number,
): { state: WorkspaceState; expired: ClosedEntry[] } {
  const base = file ?? { tabs: [], activeId: "", closed: [] };
  const known = new Set(base.tabs.map((t) => t.id));
  const orphans = [...scratchpadIds]
    .sort()
    .filter((id) => !known.has(id))
    .map(newTabState);
  const tabs = [...base.tabs, ...orphans];
  const activeId = tabs.some((t) => t.id === base.activeId)
    ? base.activeId
    : (tabs[0]?.id ?? "");
  const { kept, expired } = purgeExpired(base.closed, now);
  const state = ensureOneTab({ tabs, activeId, closed: kept }, freshId());
  return { state, expired };
}
