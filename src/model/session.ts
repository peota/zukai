import { kindOf, type Kind } from "./kinds";
import type {
  ClosedEntry,
  FileInfo,
  Fingerprint,
  LanguageId,
  SidebarState,
  Split,
  TabState,
  WorkspaceState,
} from "./types";
import { ensureOneTab, newTabState } from "./workspace";
import { normalizeSplits } from "./split";
import {
  clampSplit,
  DEFAULT_SETTINGS,
  parseSettings,
  type Settings,
} from "./settings";

export const SESSION_VERSION = 3;
export const CLOSED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;

export const DEFAULT_SIDEBAR: Readonly<SidebarState> = Object.freeze({
  open: false,
  width: 240,
  expanded: [],
});

/** The editor's text size in px (Mod+= / Mod+- / Mod+wheel change it). */
export const DEFAULT_FONT_SIZE = 13;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 40;

/** A font size in whole pixels within MIN_FONT_SIZE–MAX_FONT_SIZE. */
export function clampFontSize(px: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(px)));
}

/** A fresh copy of the default sidebar state: never hand out the default. */
export const defaultSidebar = (): SidebarState => ({
  ...DEFAULT_SIDEBAR,
  expanded: [],
});

/** A sidebar width in whole pixels within 180–480. */
export function clampSidebarWidth(w: number): number {
  return Math.round(
    Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w)),
  );
}

export interface SessionFile {
  version: 3;
  tabs: TabState[];
  activeId: string;
  closed: ClosedEntry[];
  /** Absent in older Sessions. */
  splits: Split[];
  sidebar: SidebarState;
  /** The editor's text size in px. */
  fontSize: number;
  settings: Settings;
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

const KINDS: readonly string[] = ["text", "canvas", "image"];

function isTabState(v: unknown): v is TabState {
  if (!isObject(v)) return false;
  const sel = v.selection;
  return (
    typeof v.kind === "string" &&
    KINDS.includes(v.kind) &&
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

function parseSidebar(v: unknown): SidebarState {
  if (!isObject(v)) return defaultSidebar();
  return {
    open: typeof v.open === "boolean" ? v.open : DEFAULT_SIDEBAR.open,
    width: isNum(v.width) ? clampSidebarWidth(v.width) : DEFAULT_SIDEBAR.width,
    expanded: Array.isArray(v.expanded)
      ? v.expanded.filter((x): x is string => typeof x === "string")
      : [],
  };
}

/** A malformed Split is dropped alone; a bad ratio is clamped. */
function parseSplits(v: unknown): Split[] {
  if (!Array.isArray(v)) return [];
  const out: Split[] = [];
  for (const x of v) {
    if (
      isObject(x) &&
      typeof x.a === "string" &&
      typeof x.b === "string" &&
      (x.orientation === "row" || x.orientation === "column") &&
      isNum(x.ratio)
    ) {
      out.push({
        a: x.a,
        b: x.b,
        orientation: x.orientation,
        ratio: clampSplit(x.ratio),
        focus: x.focus === "b" ? "b" : "a",
      });
    }
  }
  return out;
}

export function toSessionFile(
  s: WorkspaceState,
  sidebar: SidebarState = defaultSidebar(),
  fontSize: number = DEFAULT_FONT_SIZE,
  settings: Settings = { ...DEFAULT_SETTINGS },
): SessionFile {
  return {
    version: SESSION_VERSION,
    tabs: s.tabs,
    activeId: s.activeId,
    closed: s.closed,
    splits: s.splits ?? [],
    sidebar,
    fontSize,
    settings,
  };
}

const isViewport = (v: unknown): boolean =>
  isObject(v) && isNum(v.scrollX) && isNum(v.scrollY) && isNum(v.zoom);

/** A malformed viewport is only forgotten: the Tab itself is fine. */
function withViewport(t: unknown): unknown {
  if (!isObject(t) || t.viewport === undefined || isViewport(t.viewport)) {
    return t;
  }
  const { viewport: _bad, ...rest } = t;
  void _bad;
  return rest;
}

/** A malformed pin is only forgotten: the Tab itself is fine. */
function withPin(t: unknown): unknown {
  if (!isObject(t) || t.pinned === undefined || typeof t.pinned === "boolean") {
    return t;
  }
  const { pinned: _bad, ...rest } = t;
  void _bad;
  return rest;
}

/** So is a malformed preview mode. */
function withPreview(t: unknown): unknown {
  if (!isObject(t) || t.preview === undefined) return t;
  if (t.preview === "split" || t.preview === "only") return t;
  const { preview: _bad, ...rest } = t;
  void _bad;
  return rest;
}

/** So is a malformed Markdown editor mode. */
function withMarkdownMode(t: unknown): unknown {
  if (!isObject(t) || t.markdownMode === undefined) return t;
  if (t.markdownMode === "rich" || t.markdownMode === "markdown") return t;
  const { markdownMode: _bad, ...rest } = t;
  void _bad;
  return rest;
}

/** Before v3 a Tab had no Kind: a File's comes from its path. */
function withKind(t: unknown): unknown {
  if (!isObject(t) || t.kind !== undefined) return t;
  const file = t.file;
  const path = isObject(file) && typeof file.path === "string" ? file.path : "";
  return { ...t, kind: path === "" ? "text" : kindOf(path) };
}

export function parseSessionFile(json: string | null): SessionFile | null {
  if (json === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  // v1 had no File Tabs and v2 no Kinds or sidebar: both migrate to v3.
  if (
    !isObject(data) ||
    (data.version !== 1 && data.version !== 2 && data.version !== 3)
  ) {
    return null;
  }
  const migrate = data.version !== 3;
  if (
    !Array.isArray(data.tabs) ||
    typeof data.activeId !== "string" ||
    !Array.isArray(data.closed)
  ) {
    return null;
  }
  // A malformed entry is dropped alone; the rest of the session survives.
  const fix = (t: unknown) =>
    withMarkdownMode(
      withPreview(withPin(withViewport(migrate ? withKind(t) : t))),
    );
  const tabs: unknown[] = data.tabs.map(fix);
  const closed: unknown[] = data.closed.map((e: unknown) =>
    isObject(e) ? { ...e, tab: fix(e.tab) } : e,
  );
  return {
    version: SESSION_VERSION,
    tabs: tabs.filter(isTabState),
    activeId: data.activeId,
    closed: closed.filter(isClosedEntry),
    splits: parseSplits(data.splits),
    sidebar: migrate ? defaultSidebar() : parseSidebar(data.sidebar),
    fontSize: isNum(data.fontSize)
      ? clampFontSize(data.fontSize)
      : DEFAULT_FONT_SIZE,
    settings: parseSettings(data.settings),
  };
}

export function purgeExpired(
  closed: ClosedEntry[],
  now: number,
): { kept: ClosedEntry[]; expired: ClosedEntry[] } {
  const kept: ClosedEntry[] = [];
  const expired: ClosedEntry[] = [];
  for (const e of closed) {
    // A closed File has no shadow text unless held, so it never expires;
    // nor does a pinned Tab, which the sidebar keeps listing.
    const forever =
      (e.tab.file !== undefined && e.tab.file.held === null) ||
      e.tab.pinned === true;
    (!forever && now - e.closedAt > CLOSED_TTL_MS ? expired : kept).push(e);
  }
  return { kept, expired };
}

/** The extension of a scratchpad file: a Canvas is `excalidraw`. */
export type ScratchExt = "txt" | "excalidraw";

/** A file in `scratchpads/`, as listed by the storage layer. */
export interface ScratchFile {
  id: string;
  ext: ScratchExt;
}

/** A file in `closed/`, as listed by the storage layer. */
export interface ClosedFile {
  id: string;
  ext: ScratchExt;
  modifiedMs: number;
}

/** The Kind a scratchpad file holds. */
export const scratchKind = (ext: ScratchExt): Kind =>
  ext === "excalidraw" ? "canvas" : "text";

/**
 * Rebuild the workspace from session.json and the files on disk.
 * `closedFiles` (when known) is the content of `closed/`: entries whose file
 * is gone are dropped, and files the Session doesn't mention become Recently
 * Closed entries (closedAt = now, reopened at the end), so no closed text is
 * ever stranded and a stale file is not purged in the launch that recovers it.
 */
export function restoreWorkspace(
  file: SessionFile | null,
  scratchpads: ScratchFile[],
  freshId: () => string,
  now: number,
  closedFiles: ClosedFile[] | null,
  grantedPaths: ReadonlySet<string> | null,
  keyOf: (path: string) => string,
): { state: WorkspaceState; expired: ClosedEntry[] } {
  const raw = file ?? { tabs: [], activeId: "", closed: [], splits: [] };
  // Rust refuses to save a Session naming a File it hasn't granted.
  const granted = (t: TabState) =>
    !t.file || grantedPaths === null || grantedPaths.has(t.file.path);
  const base = {
    ...raw,
    tabs: raw.tabs.filter(granted),
    closed: raw.closed.filter((e) => granted(e.tab)),
  };
  const known = new Set<string>();
  const openPaths = new Set<string>();
  const uniqueTabs = base.tabs.filter((t) => {
    if (known.has(t.id)) return false;
    // One Tab per File: the first wins (a dropped one's shadow, if any, is
    // recovered as an orphan).
    if (t.file) {
      const k = keyOf(t.file.path);
      if (openPaths.has(k)) return false;
      openPaths.add(k);
    }
    known.add(t.id);
    return true;
  });
  const orphans = [...scratchpads]
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .filter((f) => !known.has(f.id))
    .map((f) => newTabState(f.id, scratchKind(f.ext)));
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
      tab: newTabState(f.id, scratchKind(f.ext)),
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
  const state = ensureOneTab(
    normalizeSplits({ tabs, activeId, closed, splits: raw.splits }),
    freshId(),
  );
  return { state, expired };
}
