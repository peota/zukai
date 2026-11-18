import type { Kind } from "./kinds";

export type LanguageId =
  | "plaintext"
  | "markdown"
  | "json"
  | "javascript"
  | "typescript"
  | "html"
  | "xml"
  | "css"
  | "sql"
  | "python"
  | "yaml"
  | "shell";

export interface FileFormat {
  encoding: string;
  bom: boolean;
  lineEnding: "lf" | "crlf";
  mixed: boolean;
}

/** An empty hash means "over the size limit / unread": never a match. */
export interface Fingerprint {
  mtimeMs: number;
  size: number;
  hash: string;
}

export type HeldReason = "conflict" | "missing" | "unencodable" | "readonly";

export interface FileInfo {
  path: string;
  format: FileFormat;
  fingerprint: Fingerprint | null;
  held: HeldReason | null;
}

export interface SidebarState {
  open: boolean;
  width: number;
  /** Folder keys expanded in the Library tree. */
  expanded: string[];
}

/** Where a Canvas Tab was looking (Excalidraw's scroll and zoom). */
export interface Viewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface TabState {
  id: string;
  kind: Kind;
  title: string;
  renamed: boolean;
  language: LanguageId;
  languagePicked: boolean;
  languageGuessed: boolean;
  selection: { anchor: number; head: number };
  scrollTop: number;
  wrap: boolean;
  /** A Canvas Tab's viewport; remembered in the Session, never in the file. */
  viewport?: Viewport;
  /** Absent for a Scratchpad. */
  file?: FileInfo;
}

/** closedAt is a ms epoch. */
export interface ClosedEntry {
  tab: TabState;
  index: number;
  closedAt: number;
}

/** closed is ordered newest first. */
export interface WorkspaceState {
  tabs: TabState[];
  activeId: string;
  closed: ClosedEntry[];
}
