import { Suspense, lazy, useCallback, useState } from "react";
import type {
  ImageInfo,
  MarkdownMode,
  PdfInfo,
  PdfZoom,
  TableInfo,
  TableUnreadable,
  TabState,
} from "../model/types";
import type { FindRequest } from "../find/findExtension";
import type { TextBridge } from "../editor/EditorHost";
import type { RichSync } from "../rich/RichEditor";
import { isTextKind } from "../model/kinds";
import { FileBar, type FileBarProps } from "../ui/FileBar";
import { CanvasHost, type CanvasHostProps } from "../canvas/CanvasHost";
import { ImageHost, type ImageHostProps } from "../image/ImageHost";
import {
  MarkdownPreview,
  type MarkdownPreviewProps,
} from "../markdown/MarkdownPreview";
import { SplitHandle } from "../markdown/SplitHandle";
import { DiffPane } from "../git/diff/DiffPane";
import type { FolderGit } from "../git/api";

/** Milkdown stays out of the main bundle until a note is shown in Rich. */
const RichEditor = lazy(() => import("../rich/RichEditor"));
/** pdf.js and its viewer stay out of the main bundle until a PDF is shown. */
const PdfHost = lazy(() => import("../pdf/PdfHost"));
/** The Table grid stays out of the main bundle until a Table is shown. */
const TableHost = lazy(() => import("../table/TableHost"));
/** An Unreadable Table's notice (it reads the text again on Try table view). */
const TableNotice = lazy(() => import("../table/TableNotice"));

export interface TabPaneProps
  extends
    Omit<FileBarProps, "tab">,
    Omit<CanvasHostProps, "activeId">,
    Pick<ImageHostProps, "readBytes" | "reloadSeq">,
    Pick<MarkdownPreviewProps, "feed" | "onOpenLink"> {
  tab: TabState;
  /** The focused Tab (the active one): it alone takes keys. */
  focused: boolean;
  /** A press inside an unfocused Tab's area focuses it. */
  onFocus(): void;
  /** Where the (single) editor puts a text Tab's view; null when gone. */
  slotRef(id: string, el: HTMLElement | null): void;
  /** The editor's share beside a Markdown preview (0.2–0.8). */
  previewSplit: number;
  onPreviewSplit(r: number): void;
  /** The image's size and format, for the reload `seq` it was read at. */
  onImageInfo(id: string, seq: number, info: ImageInfo | null): void;
  /** A PDF's page, zoom and size, for the reload `seq` it was read at. */
  onPdfInfo?(id: string, seq: number, info: PdfInfo | null): void;
  /** A go-to-page request, for the one PDF Tab it names. */
  goToPage?: { tabId: string; page: number; seq: number } | null;
  /** A zoom request, for the one PDF Tab it names. */
  zoomRequest?: { tabId: string; zoom: PdfZoom; seq: number } | null;
  /** Find, for the one PDF Tab it names (a PDF Tab's own find bar). */
  findRequest?: FindRequest | null;
  /** A Markdown Tab's editor (null for any other Tab). */
  mode: MarkdownMode | null;
  /** How the rich editor reaches the Tab's text (null until it exists). */
  bridge: TextBridge | null;
  /** The editor's text size in px. */
  fontSize: number;
  /** The rich editor couldn't show the Tab (it goes to Markdown). */
  onRichFallback(notice: string): void;
  /** Bump to give the keyboard back to the editor. */
  focusSignal?: number;
  /** Mod+wheel over the text: 1 bigger, -1 smaller. */
  onZoom(dir: 1 | -1): void;
  /** Where the rich editor reports an edit it hasn't written yet. */
  registerRich(id: string, sync: RichSync): () => void;
  /** The rich editor's pending edit met an outside change. */
  onRichConflict(): void;
  /** A folder's git status: a diff Tab reads both sides again as it changes. */
  gitStatus(folder: string): FolderGit | undefined;
  /** A diff Tab's Open file: the real File in a normal Tab. */
  onOpenFile(path: string): void;
  /** A Table Tab's rows, columns and Delimiter, from its grid. */
  onTableInfo?(id: string, info: TableInfo | null): void;
  /** This Table Tab's Unreadable notice, if its text didn't read. */
  tableNotice?: TableUnreadable | null;
  onTableNotice?(id: string, notice: TableUnreadable | null): void;
  /**
   * Mod+F on a Table Tab in the grid; it names its Tab, so it never reaches
   * the other Split half's grid.
   */
  tableFilterRequest?: { tabId: string; seq: number } | null;
}

/**
 * Each text Tab's slot element, by id, and the `slotRef` that keeps it: a
 * new map only when a slot comes, goes or changes.
 */
export function useSlots() {
  const [slots, setSlots] = useState<ReadonlyMap<string, HTMLElement>>(
    () => new Map(),
  );
  const slotRef = useCallback(
    (id: string, el: HTMLElement | null) =>
      setSlots((m) => {
        if (el ? m.get(id) === el : !m.has(id)) return m;
        const next = new Map(m);
        if (el) next.set(id, el);
        else next.delete(id);
        return next;
      }),
    [],
  );
  return [slots, slotRef] as const;
}

/**
 * One Tab's area: its file bar, then its text (the editor's slot, with a
 * Markdown preview beside it or instead of it), canvas, image, PDF or diff.
 */
export function TabPane(p: TabPaneProps) {
  const { tab, focused, onFocus, slotRef, onImageInfo, onPdfInfo, reloadSeq } =
    p;
  const id = tab.id;
  /** A Text or Table Tab: either way its text is in the editor's slot. */
  const isText = isTextKind(tab.kind);
  /** A Table Tab in its grid View: the slot stays, hidden, under the grid. */
  const grid = tab.kind === "table" && tab.tableView !== "raw";
  /** A Table Tab in raw text: its notice reads the text to stay current. */
  const rawTable = tab.kind === "table" && tab.tableView === "raw";
  const isMarkdown = tab.kind === "text" && tab.language === "markdown";
  const rich = isMarkdown && p.mode === "rich";
  /** A Markdown Tab's preview; any other Tab is just edited. */
  const previewMode = (isMarkdown && !rich && tab.preview) || "edit";
  const slot = useCallback(
    (el: HTMLElement | null) => slotRef(id, el),
    [slotRef, id],
  );
  const onInfo = useCallback(
    (info: ImageInfo | null) => onImageInfo(id, reloadSeq, info),
    [onImageInfo, id, reloadSeq],
  );
  const onPdfTabInfo = useCallback(
    (info: PdfInfo | null) => onPdfInfo?.(id, reloadSeq, info),
    [onPdfInfo, id, reloadSeq],
  );
  const { onTableInfo, onTableNotice } = p;
  const onTableTabInfo = useCallback(
    (info: TableInfo | null) => onTableInfo?.(id, info),
    [onTableInfo, id],
  );
  const onTableTabNotice = useCallback(
    (notice: TableUnreadable | null) => onTableNotice?.(id, notice),
    [onTableNotice, id],
  );

  return (
    <div
      className="flex size-full flex-col"
      onPointerDownCapture={focused ? undefined : onFocus}
      onFocusCapture={focused ? undefined : onFocus}
    >
      <FileBar
        key={id}
        tab={tab}
        unreadable={p.unreadable}
        onKeepMine={p.onKeepMine}
        onLoadDisk={p.onLoadDisk}
        onSaveAs={p.onSaveAs}
        onSaveToOriginal={p.onSaveToOriginal}
        onReopenWithEncoding={p.onReopenWithEncoding}
        onConvertToUtf8={p.onConvertToUtf8}
        onOpenDefault={p.onOpenDefault}
        onReveal={p.onReveal}
        revealLabel={p.revealLabel}
      />
      {(rawTable || (tab.kind === "table" && p.tableNotice)) && (
        <Suspense fallback={null}>
          <TableNotice
            key={id}
            tab={tab}
            bridge={p.bridge}
            notice={p.tableNotice ?? null}
            check={rawTable}
            onNotice={onTableTabNotice}
            onTabPatch={p.onTabPatch}
          />
        </Suspense>
      )}
      <div className="min-h-0 flex-1 bg-editor">
        {isText && (
          <div className="flex size-full">
            <div
              ref={slot}
              className={
                grid || rich || previewMode === "only"
                  ? "hidden"
                  : previewMode === "split"
                    ? "relative size-full min-w-0 shrink-0"
                    : "relative size-full min-w-0 flex-1"
              }
              style={
                previewMode === "split"
                  ? { flexBasis: `${p.previewSplit * 100}%` }
                  : undefined
              }
            />
            {grid && (
              <Suspense fallback={<div className="size-full bg-editor" />}>
                <TableHost
                  key={id}
                  tab={tab}
                  bridge={p.bridge}
                  focused={focused}
                  fontSize={p.fontSize}
                  onTabPatch={p.onTabPatch}
                  onInfo={onTableTabInfo}
                  onNotice={onTableTabNotice}
                  filterSignal={
                    p.tableFilterRequest?.tabId === id
                      ? p.tableFilterRequest.seq
                      : 0
                  }
                />
              </Suspense>
            )}
            {rich && (
              <Suspense fallback={<div className="size-full bg-editor" />}>
                {p.bridge ? (
                  <RichEditor
                    key={id}
                    id={id}
                    bridge={p.bridge}
                    readOnly={p.isReadOnly(id)}
                    focused={focused}
                    fontSize={p.fontSize}
                    onOpenLink={p.onOpenLink}
                    onFallback={p.onRichFallback}
                    focusSignal={p.focusSignal}
                    onZoom={p.onZoom}
                    register={p.registerRich}
                    onConflict={p.onRichConflict}
                  />
                ) : (
                  <div className="size-full bg-editor" />
                )}
              </Suspense>
            )}
            {previewMode === "split" && (
              <SplitHandle ratio={p.previewSplit} onRatio={p.onPreviewSplit} />
            )}
            {previewMode !== "edit" && (
              <div className="size-full min-w-0 flex-1 bg-editor">
                <MarkdownPreview
                  key={id}
                  id={id}
                  loadContent={p.loadContent}
                  feed={p.feed}
                  onOpenLink={p.onOpenLink}
                />
              </div>
            )}
          </div>
        )}
        <CanvasHost
          tabs={p.tabs}
          activeId={id}
          loadContent={p.loadContent}
          onChange={p.onChange}
          onTabPatch={p.onTabPatch}
          replaceRequests={p.replaceRequests}
          isReadOnly={p.isReadOnly}
          theme={p.theme}
          onShortcut={p.onShortcut}
        />
        {tab.kind === "diff" && tab.diff && (
          <DiffPane
            key={id}
            target={tab.diff}
            fontSize={p.fontSize}
            onOpenFile={p.onOpenFile}
            refreshKey={p.gitStatus(tab.diff.folder)}
          />
        )}
        {tab.kind === "image" && tab.file && (
          <ImageHost
            key={id}
            tab={tab}
            readBytes={p.readBytes}
            reloadSeq={reloadSeq}
            onInfo={onInfo}
            keys={focused}
          />
        )}
        {tab.kind === "pdf" && tab.file && (
          <Suspense fallback={<div className="size-full bg-editor" />}>
            <PdfHost
              key={id}
              tab={tab}
              readBytes={p.readBytes}
              reloadSeq={reloadSeq}
              onInfo={onPdfTabInfo}
              keys={focused}
              onOpenDefault={p.onOpenDefault}
              findRequest={p.findRequest?.tabId === id ? p.findRequest : null}
              goToPage={p.goToPage?.tabId === id ? p.goToPage : null}
              zoomRequest={p.zoomRequest?.tabId === id ? p.zoomRequest : null}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
