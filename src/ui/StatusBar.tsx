import type { LanguageId } from "../model/types";
import type { SaveStatus } from "../storage/autosave";

export interface StatusBarProps {
  line: number;
  col: number;
  language: LanguageId;
  saveStatus: SaveStatus;
  onPickLanguage(): void;
}

export const LANGUAGE_LABELS: Record<LanguageId, string> = {
  plaintext: "Plain Text",
  markdown: "Markdown",
  json: "JSON",
  javascript: "JavaScript",
  typescript: "TypeScript",
  html: "HTML",
  xml: "XML",
  css: "CSS",
  sql: "SQL",
  python: "Python",
  yaml: "YAML",
  shell: "Shell",
};

export function StatusBar({
  line,
  col,
  language,
  saveStatus,
  onPickLanguage,
}: StatusBarProps) {
  return (
    <div className="flex h-6 shrink-0 select-none items-center gap-3 bg-chrome px-3 text-[11px] text-faint">
      <span>
        Ln {line}, Col {col}
      </span>
      {saveStatus === "error" && (
        <span role="status" className="text-danger">
          Not saved
        </span>
      )}
      <button
        type="button"
        tabIndex={-1}
        onClick={onPickLanguage}
        className="ml-auto rounded-[4px] px-1.5 py-0.5 hover:bg-surface hover:text-muted"
      >
        {LANGUAGE_LABELS[language]}
      </button>
    </div>
  );
}
