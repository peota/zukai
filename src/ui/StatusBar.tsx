import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import type { ReactNode } from "react";
import type {
  FileFormat,
  ImageInfo,
  LanguageId,
  MarkdownMode,
  PdfInfo,
  PdfZoom,
  PreviewMode,
} from "../model/types";
import type { SaveStatus } from "../storage/autosave";
import { encodingLabel, lineEndingLabel } from "./encodings";
import { Menu } from "./Menu";
import { DirtyDot } from "./git/FolderPicker";
import { MAX_ZOOM, MIN_ZOOM } from "../pdf/zoom";

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
  /** A PDF Tab's page, zoom and size, once a page has shown. */
  pdf?: PdfInfo;
  /** Go to this page (already clamped to 1..pages). */
  onGoToPage?(page: number): void;
  /** Zoom the PDF: a step in or out, fit width, or a scale. */
  onZoom?(zoom: PdfZoom): void;
  /** Bumped by the go to page command: opens the page input. */
  pageInputSignal?: number;
  /** A PDF Tab's quiet "Open with default app". */
  onOpenDefault?(): void;
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
  /**
   * The Git button beside Agent: shows and hides the Git panel. It names
   * the branch of the repo holding the active Tab (a short hash when HEAD
   * is detached), else just "Git". Absent while git sync is off.
   */
  git?: {
    branch?: string;
    state: "none" | "rebasing" | "merging";
    open: boolean;
    /** Some repo folder has uncommitted changes: the amber dot. */
    dirty: boolean;
    hint?: string;
    onToggle(): void;
  };
}

const PANEL_TOGGLE =
  "flex shrink-0 items-center gap-1.5 rounded-[5px] px-2.5 py-1 ";
const panelToggle = (open: boolean) =>
  PANEL_TOGGLE +
  (open ? "bg-row-sel text-text" : "hover:bg-row-hover hover:text-text");

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
  pdf,
  onGoToPage,
  onZoom,
  pageInputSignal,
  onOpenDefault,
  onSettings,
  settingsHint,
  preview,
  markdownMode,
  agent,
  git,
}: StatusBarProps) {
  const rich = markdownMode?.mode === "rich";
  const [formatAt, setFormatAt] = useState<DOMRect | null>(null);
  const closeFormat = useCallback(() => {
    setFormatAt(null);
    onFormatClose?.();
  }, [onFormatClose]);
  const [zoomAt, setZoomAt] = useState<DOMRect | null>(null);
  const closeZoom = useCallback(() => setZoomAt(null), []);
  // Another Tab (or none shown): its zoom menu goes with it.
  if (zoomAt && !pdf) setZoomAt(null);
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
      ) : kindLabel !== undefined && pdf ? (
        <div className="ml-auto flex items-center gap-4 px-2.5 py-1">
          <span>{kindLabel}</span>
          <div className="flex items-center gap-0.5">
            <StepButton
              label="Previous page"
              icon="chevronLeft"
              disabled={pdf.page <= 1}
              onClick={() => onGoToPage?.(pdf.page - 1)}
            />
            <PageField
              pdf={pdf}
              onGoToPage={onGoToPage}
              signal={pageInputSignal}
            />
            <StepButton
              label="Next page"
              icon="chevronRight"
              disabled={pdf.page >= pdf.pages}
              onClick={() => onGoToPage?.(pdf.page + 1)}
            />
          </div>
          <div className="flex items-center gap-0.5">
            <StepButton
              label="Zoom out"
              icon="minus"
              disabled={pdf.zoom <= MIN_ZOOM + ZOOM_EPSILON}
              onClick={() => onZoom?.("out")}
            />
            <button
              type="button"
              tabIndex={-1}
              data-menu-anchor="zoom"
              aria-label="Zoom"
              aria-haspopup="menu"
              aria-expanded={zoomAt !== null}
              title="Zoom"
              onClick={(e) =>
                zoomAt
                  ? closeZoom()
                  : setZoomAt(e.currentTarget.getBoundingClientRect())
              }
              className="-my-1 min-w-[6ch] rounded-[5px] px-1.5 py-1 text-center tabular-nums hover:bg-row-hover hover:text-text aria-expanded:bg-row-sel aria-expanded:text-text"
            >
              {`${Math.round(pdf.zoom * 100)}%`}
            </button>
            <StepButton
              label="Zoom in"
              icon="plus"
              disabled={pdf.zoom >= MAX_ZOOM - ZOOM_EPSILON}
              onClick={() => onZoom?.("in")}
            />
          </div>
          <span>{fileSize(pdf.bytes)}</span>
          {onOpenDefault && (
            <button
              type="button"
              tabIndex={-1}
              onClick={onOpenDefault}
              className="-my-1 rounded-[5px] px-2 py-1 hover:bg-row-hover hover:text-text"
            >
              Open with default app
            </button>
          )}
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
      {(git || agent) && (
        <>
          <span
            aria-hidden="true"
            className="h-4 w-px shrink-0 bg-hairline-strong"
          />
          {/* Git (its panel docks above it) and the agent menu. */}
          <div className="-mr-1 flex min-w-0 shrink-0 items-center gap-1">
            {git && (
              <button
                type="button"
                tabIndex={-1}
                data-git-chip
                aria-pressed={git.open}
                title={
                  (git.branch ? `${git.branch}: Git` : "Git") +
                  (git.hint ? ` (${git.hint})` : "")
                }
                onClick={git.onToggle}
                className={panelToggle(git.open)}
              >
                <Icon
                  name="gitBranch"
                  size={13}
                  className={git.open ? "text-accent" : "text-faint"}
                />
                <span className="max-w-[16ch] truncate">
                  {git.branch ?? "Git"}
                </span>
                {git.state !== "none" && <span>{git.state}</span>}
                {git.dirty && <DirtyDot />}
              </button>
            )}
            {agent && (
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
                className={panelToggle(agent.open)}
              >
                <Icon
                  name="agent"
                  size={14}
                  className={agent.open ? "text-accent" : "text-faint"}
                />
                Agent
              </button>
            )}
          </div>
        </>
      )}
      {zoomAt && pdf && (
        <Menu
          label="Zoom"
          x={zoomAt.left}
          y={zoomAt.top - 4}
          side="above"
          ignoreSelector='[data-menu-anchor="zoom"]'
          onDismiss={closeZoom}
          items={[
            {
              label: "Fit width",
              checked: pdf.fitted,
              onSelect: () => onZoom?.("fit"),
            },
            ...ZOOMS.map((z, i) => ({
              label: `${Math.round(z * 100)}%`,
              separated: i === 0,
              checked:
                !pdf.fitted &&
                Math.round(pdf.zoom * 100) === Math.round(z * 100),
              onSelect: () => onZoom?.(z),
            })),
          ]}
        />
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

/** A zoom this close to a limit is at it (scales come back inexact). */
const ZOOM_EPSILON = 1e-3;

/** The zoom menu's scales, under Fit width. */
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** A small, quiet icon button: a PDF's page and zoom steps. */
function StepButton({
  label,
  icon,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: "chevronLeft" | "chevronRight" | "minus" | "plus";
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="-my-1 flex size-6 shrink-0 items-center justify-center rounded-[5px] text-faint hover:bg-row-hover hover:text-text disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-faint"
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

/** "Page 12 / 340": a click (or the go to page command) turns it into an input. */
function PageField({
  pdf,
  onGoToPage,
  signal,
}: {
  pdf: PdfInfo;
  onGoToPage?(page: number): void;
  signal?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const seen = useRef(signal);
  useEffect(() => {
    if (signal === seen.current) return;
    seen.current = signal;
    setDraft(String(pdf.page));
    setEditing(true);
  }, [signal, pdf.page]);
  if (!editing) {
    return (
      <button
        type="button"
        tabIndex={-1}
        title="Go to page"
        onClick={() => {
          setDraft(String(pdf.page));
          setEditing(true);
        }}
        className="-my-1 rounded-[5px] px-1.5 py-1 tabular-nums hover:bg-row-hover hover:text-text"
      >
        {`Page ${pdf.page} / ${pdf.pages}`}
      </button>
    );
  }
  const commit = () => {
    const n = Math.round(Number(draft));
    setEditing(false);
    if (draft.trim() !== "" && Number.isFinite(n)) {
      onGoToPage?.(Math.min(Math.max(n, 1), pdf.pages));
    }
  };
  return (
    <span className="flex items-center gap-1.5 px-1.5">
      Page
      <input
        type="number"
        aria-label="Go to page"
        autoFocus
        min={1}
        max={pdf.pages}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        className="h-5 w-14 rounded-[4px] border border-hairline-strong bg-transparent px-1 text-text outline-none focus:border-accent"
      />
      {`/ ${pdf.pages}`}
    </span>
  );
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
