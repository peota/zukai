import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  EventBus,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import { detectPlatform } from "../app/shortcuts";
import { isEditorTarget } from "../app/browserGuard";
import type { FindRequest } from "../find/findExtension";
import type { PdfInfo, TabState } from "../model/types";
import { loadPdfjs, pdfAssetParams, type Pdfjs } from "./pdfjs";
import { pdfPositions, type PdfPosition } from "./positions";
import "./pdf.css";

export interface PdfHostProps {
  /** A PDF Tab (a File). */
  tab: TabState;
  /** The File's bytes, read by Rust under the grants. */
  readBytes(path: string): Promise<ArrayBuffer>;
  /** Bumped when the File changed on disk: read it again. */
  reloadSeq: number;
  /** Zoom and page keys are its own (default); off for an unfocused half. */
  keys?: boolean;
  /** The page, page count, zoom and size; null when nothing is shown. */
  onInfo?(info: PdfInfo | null): void;
  /** The error notice's "Open with default app". */
  onOpenDefault?(): void;
  /** Find in the PDF (the find bar comes with Find). */
  findRequest?: FindRequest | null;
  /** Go to a page (from the status bar); acted on when `seq` changes. */
  goToPage?: { page: number; seq: number } | null;
}

type Position = Omit<PdfPosition, "updatedAt">;

interface Session {
  lib: Pdfjs["lib"];
  eventBus: EventBus;
  linkService: PDFLinkService;
  viewer: PDFViewer;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const KEY_STEP = 1.25;
const WHEEL_STEP = 1.1;

const TOO_LARGE = "Too large to show in Zukai.";
const PASSWORD = "This PDF is password-protected.";
const CANT_SHOW = "This file can't be shown as a PDF.";

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

function noticeFor(err: unknown): string {
  const e = err as { kind?: unknown; name?: unknown } | null;
  if (e?.kind === "too_large") return TOO_LARGE;
  if (e?.name === "PasswordException") return PASSWORD;
  return CANT_SHOW;
}

interface PageView {
  div?: HTMLElement;
  viewport?: {
    height: number;
    convertToPdfPoint(x: number, y: number): number[];
  };
}
const pageView = (viewer: PDFViewer, page: number) =>
  viewer.getPageView(page - 1) as PageView | undefined;

/**
 * Where the view is: the page at its top edge, how far down that page the
 * edge is (0–1), and the zoom. None while the container has no size (hidden),
 * where the scroll position means nothing.
 */
function positionOf(
  viewer: PDFViewer,
  container: HTMLElement,
): Position | null {
  const n = viewer.pagesCount;
  if (n < 1 || container.clientHeight <= 0) return null;
  const top = container.scrollTop;
  const div = (p: number) => pageView(viewer, p)?.div;
  // The viewer's current page is the most visible one; walk to the one at
  // the top edge.
  let page = clamp(viewer.currentPageNumber, 1, n);
  while (page > 1 && (div(page)?.offsetTop ?? 0) > top) page--;
  while (page < n) {
    const d = div(page);
    if (!d || d.offsetHeight <= 0 || d.offsetTop + d.offsetHeight > top) break;
    page++;
  }
  const d = div(page);
  const h = d?.offsetHeight ?? 0;
  return {
    page,
    offsetInPage: d && h > 0 ? clamp((top - d.offsetTop) / h, 0, 1) : 0,
    zoom:
      viewer.currentScaleValue === "page-width"
        ? "fit-width"
        : clamp(viewer.currentScale, MIN_ZOOM, MAX_ZOOM),
  };
}

/** Shows `pos` (fit width when there is none), its page clamped. */
function restore(viewer: PDFViewer, pos: Position | null | undefined) {
  if (!pos || pos.zoom === "fit-width") viewer.currentScaleValue = "page-width";
  else viewer.currentScale = pos.zoom;
  if (!pos) return;
  const pageNumber = clamp(pos.page, 1, viewer.pagesCount);
  const vp = pageView(viewer, pageNumber)?.viewport;
  // XYZ's top is in PDF units, which grow upward from the page's bottom.
  const top = vp
    ? vp.convertToPdfPoint(0, pos.offsetInPage * vp.height)[1]
    : null;
  viewer.scrollPageIntoView({
    pageNumber,
    destArray: [null, { name: "XYZ" }, null, top, null],
  });
}

const platform = detectPlatform();

/** A field, an editable element or the editor: where Mod+- etc. aren't ours. */
function typesText(t: EventTarget | null): boolean {
  return (
    t instanceof Element &&
    (isEditorTarget(t) ||
      t.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
      ) !== null)
  );
}

/**
 * A read-only PDF Tab: pdf.js's viewer (continuous scroll, lazy page
 * rendering, a text layer) in Zukai's colours, with no pdf.js toolbar. It
 * opens where the File was last left (the per-File position store) and keeps
 * that place across a reload from disk. Mod+= / Mod+- / Mod+0 and Mod+wheel
 * zoom; PageUp / PageDown / Home / End move through the pages.
 */
export function PdfHost({
  tab,
  readBytes,
  reloadSeq,
  keys = true,
  onInfo,
  onOpenDefault,
  goToPage,
}: PdfHostProps) {
  const path = tab.file?.path ?? "";
  const missing = tab.file?.held === "missing";
  const hostRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<Session | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The viewer, for a request outside its effects (go to page). */
  const viewerRef = useRef<PDFViewer | null>(null);
  /** The shown document's position has been applied: saving may begin. */
  const restoredRef = useRef(false);
  /** The last position known for a path: what a reload restores. */
  const lastRef = useRef<{ path: string; pos: Position } | null>(null);
  const onInfoRef = useRef(onInfo);
  useLayoutEffect(() => {
    onInfoRef.current = onInfo;
  });

  // pdf.js and one viewer for this Tab's life; documents come and go below.
  useEffect(() => {
    let live = true;
    loadPdfjs().then(
      ({ lib, viewer: v }) => {
        const container = containerRef.current;
        const inner = innerRef.current;
        if (!live || !container || !inner) return;
        const eventBus = new v.EventBus();
        const linkService = new v.PDFLinkService({ eventBus });
        // Web links stay inert; "Open with default app" is the way out.
        linkService.externalLinkEnabled = false;
        const viewer = new v.PDFViewer({
          container,
          viewer: inner,
          eventBus,
          linkService,
          textLayerMode: 1, // TextLayerMode.ENABLE
          annotationMode: lib.AnnotationMode.ENABLE,
        });
        linkService.setViewer(viewer);
        viewerRef.current = viewer;
        setPdf({ lib, eventBus, linkService, viewer });
      },
      (err: unknown) => {
        console.error("load pdf.js", err);
        if (live) setNotice(CANT_SHOW);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  // Load the document; restore its position; save it as it moves. A layout
  // effect, so the cleanup's last save runs before an unmount detaches the
  // container (a detached one has no size, and is never saved).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!pdf || !container || !path || missing) return;
    const { lib, eventBus, linkService, viewer } = pdf;
    let live = true;
    let task: PDFDocumentLoadingTask | null = null;
    let bytes = 0;
    restoredRef.current = false;
    onInfoRef.current?.(null);
    // A reload keeps the place it had; a first load asks the store.
    const carried = lastRef.current?.path === path ? lastRef.current.pos : null;

    const report = () => {
      if (!live || !restoredRef.current) return;
      onInfoRef.current?.({
        page: viewer.currentPageNumber,
        pages: viewer.pagesCount,
        zoom: viewer.currentScale,
        bytes,
      });
    };
    /** Never before the restore, and never while hidden. */
    const save = () => {
      if (!restoredRef.current) return;
      const pos = positionOf(viewer, container);
      if (!pos) return;
      lastRef.current = { path, pos };
      pdfPositions.set(path, pos);
    };
    const onPagesInit = async () => {
      let pos: Position | null | undefined = carried;
      if (!pos) {
        try {
          pos = await pdfPositions.get(path);
        } catch (err) {
          console.error("read pdf position", err);
        }
      }
      if (!live) return;
      restore(viewer, pos);
      restoredRef.current = true;
      if (pos) lastRef.current = { path, pos };
      report();
    };
    const onScale = () => {
      report();
      save();
    };
    eventBus.on("pagesinit", onPagesInit);
    eventBus.on("pagechanging", report);
    eventBus.on("scalechanging", onScale);
    container.addEventListener("scroll", save, { passive: true });

    void (async () => {
      const buf = await readBytes(path);
      if (!live) return;
      bytes = buf.byteLength;
      task = lib.getDocument({
        data: new Uint8Array(buf),
        ...pdfAssetParams(),
      });
      const doc = await task.promise;
      if (!live) return;
      setNotice(null);
      viewer.setDocument(doc);
      linkService.setDocument(doc, null);
    })().catch((err: unknown) => {
      if (!live) return;
      console.error("open pdf", err);
      setNotice(noticeFor(err));
      onInfoRef.current?.(null);
    });

    return () => {
      save();
      live = false;
      restoredRef.current = false;
      container.removeEventListener("scroll", save);
      eventBus.off("pagesinit", onPagesInit);
      eventBus.off("pagechanging", report);
      eventBus.off("scalechanging", onScale);
      if (task) {
        viewer.setDocument(null);
        linkService.setDocument(null, null);
        void task.destroy();
      }
    };
  }, [pdf, path, missing, reloadSeq, readBytes]);

  // Nothing shown: the status bar shows nothing either.
  useEffect(() => {
    if (missing) onInfoRef.current?.(null);
  }, [missing]);

  // Zoom and page keys, wherever the focus is while this Tab is shown.
  useEffect(() => {
    if (!keys || !pdf) return;
    const { viewer } = pdf;
    const container = containerRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (!restoredRef.current || !container || typesText(e.target)) return;
      const mac = platform === "mac";
      const mod = mac ? e.metaKey : e.ctrlKey;
      const otherMod = mac ? e.ctrlKey : e.metaKey;
      if (mod && !otherMod && !e.altKey) {
        if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") {
          viewer.currentScale = clamp(
            viewer.currentScale * KEY_STEP,
            MIN_ZOOM,
            MAX_ZOOM,
          );
        } else if (e.key === "-" || e.code === "NumpadSubtract") {
          viewer.currentScale = clamp(
            viewer.currentScale / KEY_STEP,
            MIN_ZOOM,
            MAX_ZOOM,
          );
        } else if (
          e.key === "0" ||
          e.code === "Digit0" ||
          e.code === "Numpad0"
        ) {
          viewer.currentScaleValue = "page-width";
        } else {
          return;
        }
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      // Plain navigation keys only from this viewer or nowhere in particular,
      // so a list elsewhere (the sidebar) keeps its own Home / End.
      const t = e.target;
      if (!(
        t === document.body ||
        (t instanceof Node && hostRef.current?.contains(t))
      )) {
        return;
      }
      if (e.key === "PageDown") container.scrollTop += container.clientHeight;
      else if (e.key === "PageUp")
        container.scrollTop -= container.clientHeight;
      else if (e.key === "Home") viewer.currentPageNumber = 1;
      else if (e.key === "End") viewer.currentPageNumber = viewer.pagesCount;
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, pdf]);

  // Mod+wheel zooms toward the pointer. Not passive, so the page itself
  // never zooms; a plain wheel scrolls as usual.
  useEffect(() => {
    const container = containerRef.current;
    if (!pdf || !container) return;
    const { viewer } = pdf;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (!restoredRef.current) return;
      const from = viewer.currentScale;
      const to = clamp(
        e.deltaY < 0 ? from * WHEEL_STEP : from / WHEEL_STEP,
        MIN_ZOOM,
        MAX_ZOOM,
      );
      if (to === from) return;
      viewer.updateScale({
        scaleFactor: to / from,
        origin: [e.clientX, e.clientY],
      });
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [pdf]);

  // Go to a page: only a request made while shown (a new `seq`).
  const goSeq = useRef(goToPage?.seq ?? 0);
  useEffect(() => {
    if (!goToPage || goToPage.seq === goSeq.current) return;
    goSeq.current = goToPage.seq;
    const viewer = viewerRef.current;
    if (!viewer || !restoredRef.current) return;
    viewer.currentPageNumber = clamp(
      Math.round(goToPage.page),
      1,
      viewer.pagesCount,
    );
  }, [goToPage]);

  const message = missing ? null : notice;

  return (
    <div ref={hostRef} className="relative size-full bg-editor">
      {/* pdf.js requires an absolutely positioned scroll container. */}
      <div
        ref={containerRef}
        data-pdf-viewer=""
        className={
          "zukai-pdf absolute inset-0 overflow-auto" +
          (message || missing ? " invisible" : "")
        }
      >
        <div ref={innerRef} className="pdfViewer" />
      </div>
      {message && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ui-sm text-muted">
          <p>{message}</p>
          {onOpenDefault && (
            <button
              type="button"
              onClick={onOpenDefault}
              className="rounded-[6px] bg-bar-btn-bg px-2.5 py-1 font-medium text-text shadow-[0_0_0_1px_var(--z-bar-btn-ring)] hover:bg-bar-btn-hover"
            >
              Open with default app
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default PdfHost;
