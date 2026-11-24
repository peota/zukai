import { useCallback, useState } from "react";
import { Icon } from "./icons";
import type { ReactNode } from "react";
import type {
  FileFormat,
  ImageInfo,
  LanguageId,
  MarkdownMode,
  PreviewMode,
} from "../model/types";
import type { SaveStatus } from "../storage/autosave";
import { encodingLabel, lineEndingLabel } from "./encodings";
import { Menu } from "./Menu";

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
  /** The Format chip, for JSON. */
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
  /**
   * A Markdown Tab's preview switch (Edit, Split, Preview); `hint` is its
   * shortcut, shown in the tooltip.
   */
  preview?: {
    mode: "edit" | PreviewMode;
    onChange(mode: "edit" | PreviewMode): void;
    hint?: string;
  };
  /**
   * A Markdown Tab's editor switch (Rich, Markdown); `hint` is its shortcut.
   * Rich has no preview and no line and column.
   */
  markdownMode?: {
    mode: MarkdownMode;
    onChange(mode: MarkdownMode): void;
    hint?: string;
  };
  /** The gear at the far left; its tooltip shows `settingsHint`. */
  onSettings?(): void;
  settingsHint?: string;
  /**
   * The Agent button at the far right: it opens the New terminal menu above
   * it. `open` is whether that menu is open; `hint` its shortcut.
   */
  agent?: { open: boolean; onOpen(anchor: DOMRect): void; hint: string };
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
  csharp: "C#",
  yaml: "YAML",
  shell: "Shell",
};

const CHIP =
  "rounded-[5px] px-2.5 py-1 hover:bg-row-hover hover:text-text aria-expanded:bg-row-sel aria-expanded:text-text";

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
  onSettings,
  settingsHint,
  preview,
  markdownMode,
  agent,
}: StatusBarProps) {
  const rich = markdownMode?.mode === "rich";
  const [formatAt, setFormatAt] = useState<DOMRect | null>(null);
  const closeFormat = useCallback(() => {
    setFormatAt(null);
    onFormatClose?.();
  }, [onFormatClose]);
  const scratchEnding = platformLineEnding === "crlf" ? "CRLF" : "LF";

  return (
    <div className="flex h-8 shrink-0 select-none items-center gap-4 border-t border-hairline bg-chrome px-4 text-ui-sm text-muted">
      {onSettings && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Settings"
          title={settingsHint ? `Settings (${settingsHint})` : "Settings"}
          onClick={onSettings}
          className="-ml-1 flex size-6 shrink-0 items-center justify-center rounded-[5px] text-faint hover:bg-row-hover hover:text-text"
        >
          <Icon name="settings" size={14} />
        </button>
      )}
      {kindLabel === undefined && !rich ? (
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
        <div className="ml-auto flex items-center gap-4 px-2.5 py-1">
          <span>{`${image.width} × ${image.height}`}</span>
          <span>{image.format}</span>
          <span>{fileSize(image.bytes)}</span>
        </div>
      ) : kindLabel !== undefined ? (
        <span className="ml-auto px-2.5 py-1">{kindLabel}</span>
      ) : (
        <div className="ml-auto flex items-center gap-2">
          {markdownMode && <ModeSwitch {...markdownMode} />}
          {preview && !rich && <PreviewSwitch {...preview} />}
          {(markdownMode || preview) && (
            <span
              aria-hidden="true"
              className="mx-1 h-4 w-px bg-hairline-strong"
            />
          )}
          {showFormat && (
            <Chip
              anchor="format"
              expanded={formatAt !== null}
              onClick={(r) => (formatAt ? closeFormat() : setFormatAt(r))}
            >
              <span className="flex items-center gap-1.5">
                <Icon name="data" size={13} />
                Format
              </span>
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
              <span className="px-2.5 py-1">UTF-8</span>
              <span className="px-2.5 py-1">{scratchEnding}</span>
            </>
          )}
        </div>
      )}
      {agent && (
        <>
          <span
            aria-hidden="true"
            className="h-4 w-px shrink-0 bg-hairline-strong"
          />
          <button
            type="button"
            tabIndex={-1}
            data-z-agent-menu="status"
            aria-haspopup="menu"
            aria-expanded={agent.open}
            title={`Agent (${agent.hint})`}
            onClick={(e) =>
              agent.onOpen(e.currentTarget.getBoundingClientRect())
            }
            className={
              "-mr-1 flex shrink-0 items-center gap-1.5 rounded-[5px] px-2.5 py-1 " +
              (agent.open
                ? "bg-row-sel text-text"
                : "hover:bg-row-hover hover:text-text")
            }
          >
            <Icon
              name="agent"
              size={14}
              className={agent.open ? "text-accent" : "text-faint"}
            />
            Agent
          </button>
        </>
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

const MARKDOWN_MODES: { id: MarkdownMode; label: string }[] = [
  { id: "rich", label: "Rich" },
  { id: "markdown", label: "Markdown" },
];

/** The rich editor or the Markdown source, for a Markdown Tab. */
function ModeSwitch({
  mode,
  onChange,
  hint,
}: NonNullable<StatusBarProps["markdownMode"]>) {
  return (
    <Radios
      label="Markdown editor"
      hint={hint}
      value={mode}
      options={MARKDOWN_MODES}
      onChange={onChange}
    />
  );
}

/** A row of chips, one of them chosen. */
function Radios<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { id: T; label: string }[];
  onChange(v: T): void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      className="flex items-center gap-px rounded-[6px] bg-row-hover p-px"
    >
      {options.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          tabIndex={-1}
          aria-checked={value === m.id}
          onClick={() => onChange(m.id)}
          className={
            "rounded-[5px] px-2.5 py-0.5 " +
            (value === m.id
              ? "bg-surface text-text shadow-tab"
              : "hover:text-text")
          }
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

const PREVIEW_MODES: { id: "edit" | PreviewMode; label: string }[] = [
  { id: "edit", label: "Edit" },
  { id: "split", label: "Split" },
  { id: "only", label: "Preview" },
];

/** Edit, Split or Preview for a Markdown Tab. */
function PreviewSwitch({
  mode,
  onChange,
  hint,
}: NonNullable<StatusBarProps["preview"]>) {
  return (
    <Radios
      label="Markdown preview"
      hint={hint}
      value={mode}
      options={PREVIEW_MODES}
      onChange={onChange}
    />
  );
}
