import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import type { FileFormat, LanguageId } from "../model/types";
import type { SaveStatus } from "../storage/autosave";
import { encodingLabel, lineEndingLabel } from "./encodings";
import { Menu } from "./Menu";
import type { ImageInfo } from "../image/ImageHost";

export type FormatKind = "beautify" | "minify";

export interface StatusBarProps {
  line: number;
  col: number;
  language: LanguageId;
  saveStatus: SaveStatus;
  onPickLanguage(): void;
  /** What a Scratchpad shows (it's always written this way). */
  platformLineEnding: "lf" | "crlf";
  /** Absent for a Scratchpad. */
  file?: { format: FileFormat; readonly: boolean };
  /** Open the menu above this chip. */
  onEncodingMenu(anchor: DOMRect): void;
  onLineEndingMenu(anchor: DOMRect): void;
  /** Which of those menus is open, to highlight its chip. */
  openMenu?: "encoding" | "lineEnding" | null;
  /** The `{ } Format` chip, for JSON. */
  showFormat: boolean;
  onFormat(kind: FormatKind): void;
  /** The Format menu closed (picked or dismissed): refocus the editor. */
  onFormatClose?(): void;
  /** A short message, e.g. "Open files, not folders". */
  notice?: string;
  /** Shown next to Beautify. */
  beautifyHint?: string;
  /**
   * A Tab that isn't text (a Canvas) shows only this label: no position,
   * Language, encoding, line ending or Format.
   */
  kindLabel?: string;
  /** An Image Tab: shown in place of `kindLabel` once the image has loaded. */
  image?: ImageInfo;
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

const CHIP =
  "rounded-[4px] px-1.5 py-0.5 hover:bg-surface hover:text-muted aria-expanded:bg-surface aria-expanded:text-text aria-expanded:shadow-float";

export function StatusBar({
  line,
  col,
  language,
  saveStatus,
  onPickLanguage,
  platformLineEnding,
  file,
  onEncodingMenu,
  onLineEndingMenu,
  openMenu = null,
  showFormat,
  onFormat,
  onFormatClose,
  notice,
  beautifyHint,
  kindLabel,
  image,
}: StatusBarProps) {
  const [formatAt, setFormatAt] = useState<DOMRect | null>(null);
  const closeFormat = useCallback(() => {
    setFormatAt(null);
    onFormatClose?.();
  }, [onFormatClose]);
  const scratchEnding = platformLineEnding === "crlf" ? "CRLF" : "LF";

  return (
    <div className="flex h-6 shrink-0 select-none items-center gap-3 bg-chrome px-3 text-[11px] text-faint">
      {kindLabel === undefined ? (
        <span>{file?.readonly ? "Read-only" : `Ln ${line}, Col ${col}`}</span>
      ) : (
        file?.readonly && <span>Read-only</span>
      )}
      {saveStatus === "error" && (
        <span role="status" className="text-danger">
          Not saved
        </span>
      )}
      {notice && (
        <span role="status" className="min-w-0 truncate text-muted">
          {notice}
        </span>
      )}
      {kindLabel !== undefined && image ? (
        <div className="ml-auto flex items-center gap-3 px-1.5 py-0.5">
          <span>{`${image.width} × ${image.height}`}</span>
          <span>{image.format}</span>
          <span>{fileSize(image.bytes)}</span>
        </div>
      ) : kindLabel !== undefined ? (
        <span className="ml-auto px-1.5 py-0.5">{kindLabel}</span>
      ) : (
        <div className="ml-auto flex items-center gap-1.5">
          {showFormat && (
            <Chip
              anchor="format"
              expanded={formatAt !== null}
              onClick={(r) => (formatAt ? closeFormat() : setFormatAt(r))}
            >
              {"{ } Format"}
            </Chip>
          )}
          <button
            type="button"
            tabIndex={-1}
            data-language-button
            onClick={onPickLanguage}
            className={CHIP}
          >
            {LANGUAGE_LABELS[language]}
          </button>
          {file ? (
            <>
              <Chip
                anchor="encoding"
                expanded={openMenu === "encoding"}
                onClick={onEncodingMenu}
              >
                {encodingLabel(file.format)}
              </Chip>
              <Chip
                anchor="lineEnding"
                expanded={openMenu === "lineEnding"}
                onClick={onLineEndingMenu}
              >
                {lineEndingLabel(file.format)}
              </Chip>
            </>
          ) : (
            <>
              <span className="px-1.5 py-0.5">UTF-8</span>
              <span className="px-1.5 py-0.5">{scratchEnding}</span>
            </>
          )}
        </div>
      )}
      {formatAt && kindLabel === undefined && (
        <Menu
          label="Format"
          x={formatAt.right}
          y={formatAt.top - 4}
          side="above"
          align="end"
          ignoreSelector='[data-menu-anchor="format"]'
          onDismiss={closeFormat}
          items={[
            {
              label: "Beautify",
              hint: beautifyHint,
              onSelect: () => onFormat("beautify"),
            },
            { label: "Minify", onSelect: () => onFormat("minify") },
          ]}
        />
      )}
    </div>
  );
}

/** "512 B", "1.5 KB", "10 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Number(kb.toFixed(1))} KB`;
  return `${Number((kb / 1024).toFixed(1))} MB`;
}

function Chip({
  anchor,
  expanded,
  onClick,
  children,
}: {
  anchor: string;
  expanded: boolean;
  onClick(rect: DOMRect): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-menu-anchor={anchor}
      aria-haspopup="menu"
      aria-expanded={expanded}
      onClick={(e) => onClick(e.currentTarget.getBoundingClientRect())}
      className={CHIP}
    >
      {children}
    </button>
  );
}
