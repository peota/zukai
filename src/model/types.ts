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

export interface TabState {
  id: string;
  title: string;
  renamed: boolean;
  language: LanguageId;
  languagePicked: boolean;
  languageGuessed: boolean;
  selection: { anchor: number; head: number };
  scrollTop: number;
  wrap: boolean;
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
