import { useCallback, useState } from "react";
import type { ImageInfo, TabState } from "../model/types";
import { FileBar, type FileBarProps } from "../ui/FileBar";
import { CanvasHost, type CanvasHostProps } from "../canvas/CanvasHost";
import { ImageHost, type ImageHostProps } from "../image/ImageHost";
import {
  MarkdownPreview,
  type MarkdownPreviewProps,
} from "../markdown/MarkdownPreview";
import { SplitHandle } from "../markdown/SplitHandle";

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
 * Markdown preview beside it or instead of it), canvas or image.
 */
export function TabPane(p: TabPaneProps) {
  const { tab, focused, onFocus, slotRef, onImageInfo, reloadSeq } = p;
  const id = tab.id;
  const isText = tab.kind === "text";
  const isMarkdown = isText && tab.language === "markdown";
  /** A Markdown Tab's preview; any other Tab is just edited. */
  const previewMode = (isMarkdown && tab.preview) || "edit";
  const slot = useCallback(
    (el: HTMLElement | null) => slotRef(id, el),
    [slotRef, id],
  );
  const onInfo = useCallback(
    (info: ImageInfo | null) => onImageInfo(id, reloadSeq, info),
    [onImageInfo, id, reloadSeq],
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
      <div className="min-h-0 flex-1 bg-editor">
        {isText && (
          <div className="flex size-full">
            <div
              ref={slot}
              className={
                previewMode === "only"
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
      </div>
    </div>
  );
}
