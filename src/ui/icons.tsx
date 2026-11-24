import {
  ArrowDown,
  ArrowUp,
  MessageSquareText,
  Check,
  Copy,
  Square,
  Bold,
  Braces,
  ChevronDown,
  ChevronRight,
  Code,
  File,
  FileCode,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Minus,
  Database,
  SquareTerminal,
  MoreHorizontal,
  ChevronsDownUp,
  NotebookPen,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PenTool,
  Pilcrow,
  Pin,
  Plus,
  Search,
  Settings,
  SquareCode,
  Strikethrough,
  Table,
  TextQuote,
  Trash2,
  X,
  FileSpreadsheet,
  GitBranch,
  ArrowDownToLine,
  ArrowUpFromLine,
  GitCommitHorizontal,
  GitCompare,
  Loader2,
} from "lucide-react";
import { CANVAS_EXT, IMAGE_EXTS } from "../model/kinds";

/** The app's line icons (Lucide, one stroke weight throughout). */
export type IconName =
  | "arrowDown"
  | "arrowUp"
  | "ask"
  | "check"
  | "copy"
  | "square"
  | "folder"
  | "folderOpen"
  | "markdown"
  | "canvas"
  | "image"
  | "data"
  | "table"
  | "code"
  | "text"
  | "other"
  | "scratchpad"
  | "link"
  | "pin"
  | "close"
  | "plus"
  | "minus"
  | "shell"
  | "database"
  | "more"
  | "search"
  | "settings"
  | "sidebar"
  // The terminal panel's header.
  | "trash"
  | "panelBottom"
  | "panelRight"
  | "chevronDown"
  | "chevronRight"
  // The rich editor's toolbar.
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "bold"
  | "italic"
  | "strike"
  | "inlineCode"
  | "codeBlock"
  | "bulletList"
  | "numberedList"
  | "checklist"
  | "quote"
  | "insertTable"
  | "rule"
  // The library git row.
  | "gitBranch"
  | "gitPull"
  | "gitCommit"
  | "gitPush"
  // A diff Tab.
  | "gitCompare"
  | "spinner";

const DATA_EXTS = [".json", ".jsonc", ".yaml", ".yml", ".xml", ".toml"];
const TABLE_EXTS = [".csv", ".tsv"];
const CODE_EXTS = [
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".sh",
  ".bash",
  ".ps1",
  ".sql",
  ".css",
  ".html",
  ".rs",
  ".go",
  ".java",
  ".cs",
  ".c",
  ".cpp",
  ".h",
  ".rb",
];
const SHELL_EXTS = [".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd"];
const TEXT_EXTS = [".txt", ".log", ".text"];

/** The icon for a file name, by extension (case-insensitive). */
export function fileIcon(name: string): IconName {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "text";
  const ext = name.slice(dot).toLowerCase();
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === CANVAS_EXT) return "canvas";
  if (IMAGE_EXTS.includes(ext)) return "image";
  if (TABLE_EXTS.includes(ext)) return "table";
  if (DATA_EXTS.includes(ext)) return "data";
  if (SHELL_EXTS.includes(ext)) return "shell";
  if (ext === ".sql") return "database";
  if (CODE_EXTS.includes(ext)) return "code";
  return TEXT_EXTS.includes(ext) ? "text" : "other";
}

const ICONS: Record<IconName, LucideIcon> = {
  arrowDown: ArrowDown,
  arrowUp: ArrowUp,
  ask: MessageSquareText,
  check: Check,
  copy: Copy,
  square: Square,
  folder: Folder,
  folderOpen: FolderOpen,
  markdown: FileText,
  canvas: PenTool,
  image: Image,
  data: Braces,
  table: FileSpreadsheet,
  code: FileCode,
  text: FileText,
  other: File,
  scratchpad: NotebookPen,
  link: Link,
  pin: Pin,
  close: X,
  plus: Plus,
  minus: Minus,
  shell: SquareTerminal,
  database: Database,
  more: MoreHorizontal,
  search: Search,
  settings: Settings,
  sidebar: PanelLeft,
  trash: Trash2,
  panelBottom: PanelBottom,
  panelRight: PanelRight,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  paragraph: Pilcrow,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  bold: Bold,
  italic: Italic,
  strike: Strikethrough,
  inlineCode: Code,
  codeBlock: SquareCode,
  bulletList: List,
  numberedList: ListOrdered,
  checklist: ListChecks,
  quote: TextQuote,
  insertTable: Table,
  rule: Minus,
  gitBranch: GitBranch,
  gitPull: ArrowDownToLine,
  gitCommit: GitCommitHorizontal,
  gitPush: ArrowUpFromLine,
  gitCompare: GitCompare,
  spinner: Loader2,
};

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.6,
  className = "",
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const C = ICONS[name];
  return (
    <C
      data-icon={name}
      size={size}
      strokeWidth={strokeWidth}
      absoluteStrokeWidth={size < 16}
      aria-hidden="true"
      className={"shrink-0 " + className}
    />
  );
}

/** A folder's disclosure arrow; rotates when open. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      size={14}
      strokeWidth={2}
      aria-hidden="true"
      className={
        "shrink-0 transition-transform duration-150 ease-out " +
        (open ? "rotate-90" : "")
      }
    />
  );
}

export function PlusIcon() {
  return <Plus size={15} strokeWidth={1.8} aria-hidden="true" />;
}

/** The Library heading's quick actions: New file, New folder, New canvas. */
export function NewFileIcon() {
  return <FilePlus size={15} strokeWidth={1.8} aria-hidden="true" />;
}

export function NewFolderIcon() {
  return <FolderPlus size={15} strokeWidth={1.8} aria-hidden="true" />;
}

/** A Canvas's pen with a small + at its lower right, like the two above. */
export function NewCanvasIcon() {
  return (
    <span aria-hidden="true" className="relative inline-flex size-[15px]">
      <PenTool size={13} strokeWidth={1.8} />
      <Plus
        size={9}
        strokeWidth={2.6}
        className="absolute -right-0.5 -bottom-0.5"
      />
    </span>
  );
}

/** The Library heading's Collapse all. */
export function CollapseAllIcon() {
  return <ChevronsDownUp size={15} strokeWidth={1.8} aria-hidden="true" />;
}

/** ⋯: a heading's menu. */
export function MoreIcon() {
  return <MoreHorizontal size={15} strokeWidth={1.8} aria-hidden="true" />;
}

export function SearchIcon() {
  return <Search size={14} strokeWidth={1.8} aria-hidden="true" />;
}

export function CloseIcon({ size = 14 }: { size?: number }) {
  return <X size={size} strokeWidth={1.8} aria-hidden="true" />;
}
