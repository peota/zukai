import type { Kind } from "./kinds";
import type { ChangeStatus } from "../git/api";

/**
 * A diff Tab's subject: `path` (relative to `folder`, `/` separators)
 * against its last commit, read at `oldPath` for a rename.
 */
export interface DiffTarget {
  folder: string;
  path: string;
  oldPath?: string;
  status: ChangeStatus;
}

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
  | "csharp"
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
  /** The Tab's text or format isn't in the File; its text is in its shadow. */
  unsaved?: true;
  /** The File's format on disk; present only while a Convert is unsaved. */
  diskFormat?: FileFormat;
}

export interface SidebarState {
  open: boolean;
  width: number;
  /** Folder keys expanded in the Library tree. */
  expanded: string[];
  /** File Tab ids last viewed, newest first: the sidebar's Recent list. */
  recent: string[];
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
  /** Absent for a Scratchpad (and a diff Tab, which has `diff` instead). */
  file?: FileInfo;
  /** A diff Tab's File and change; never in the Session. */
  diff?: DiffTarget;
  /**
   * Kept at the start of the tab bar and in the sidebar's Pinned list; a
   * closed pinned Tab stays there (and in Recently Closed) to reopen.
   */
  pinned?: boolean;
  /**
   * A Markdown Tab's rendered preview: beside the editor ("split") or in
   * its place ("only"); absent while just editing.
   */
  preview?: PreviewMode;
  /**
   * A Markdown Tab's editor: the rich one or the Markdown source. Absent
   * until first shown, when it's decided from the Settings default.
   */
  markdownMode?: MarkdownMode;
  /**
   * Text ranges drawn as dots (a password, a token), as sorted [from, to)
   * offsets. Only the display changes; the text is never stored here.
   */
  hidden?: [number, number][];
}

export type MarkdownMode = "rich" | "markdown";

export type PreviewMode = "split" | "only";

/** What the status bar shows for an Image Tab once its image has loaded. */
export interface ImageInfo {
  width: number;
  height: number;
  /** "PNG", "JPEG", "SVG", … */
  format: string;
  bytes: number;
}

/** What a PDF Tab shows, for the status bar. */
export interface PdfInfo {
  /** The current page, 1-based. */
  page: number;
  pages: number;
  /** The scale: 1 is 100%. */
  zoom: number;
  bytes: number;
}

/** closedAt is a ms epoch. */
export interface ClosedEntry {
  tab: TabState;
  index: number;
  closedAt: number;
}

export type SplitOrientation = "row" | "column";

/**
 * Two Tabs shown as one joined tab: b sits right after a in `tabs`, they share
 * the pin, and `focus` is the member that is `activeId` while it is shown.
 * `ratio` is a's share, 0.2-0.8.
 */
export interface Split {
  a: string;
  b: string;
  orientation: SplitOrientation;
  ratio: number;
  focus: "a" | "b";
}

/** closed is ordered newest first; an absent `splits` means none. */
export interface WorkspaceState {
  tabs: TabState[];
  activeId: string;
  closed: ClosedEntry[];
  splits?: Split[];
}
