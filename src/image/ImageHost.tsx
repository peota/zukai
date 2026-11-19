import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { detectPlatform } from "../app/shortcuts";
import { isEditorTarget } from "../app/browserGuard";
import type { ImageInfo, TabState } from "../model/types";

export interface ImageHostProps {
  /** An Image Tab (a File). */
  tab: TabState;
  /** The File's bytes, read by Rust under the grants. */
  readBytes(path: string): Promise<ArrayBuffer>;
  /** Bumped when the File changed on disk: read it again. */
  reloadSeq: number;
  /** The loaded image's size and format; null when nothing is shown. */
  onInfo?(info: ImageInfo | null): void;
  /** Mod+= / Mod+- / Mod+0 are its own (default); off for an unfocused half. */
  keys?: boolean;
}

/** MIME type and status-bar name, by extension. */
const FORMATS: Record<string, { mime: string; name: string }> = {
  png: { mime: "image/png", name: "PNG" },
  jpg: { mime: "image/jpeg", name: "JPEG" },
  jpeg: { mime: "image/jpeg", name: "JPEG" },
  gif: { mime: "image/gif", name: "GIF" },
  webp: { mime: "image/webp", name: "WebP" },
  bmp: { mime: "image/bmp", name: "BMP" },
  svg: { mime: "image/svg+xml", name: "SVG" },
};

function formatOf(path: string) {
  const dot = path.lastIndexOf(".");
  const ext = dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
  return FORMATS[ext] ?? { mime: "application/octet-stream", name: "Image" };
}

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 32;
const KEY_STEP = 1.25;
const WHEEL_STEP = 1.1;

/** Where the image sits: its top-left corner in the viewport, and its scale. */
interface View {
  fit: boolean;
  zoom: number;
  x: number;
  y: number;
}

const FIT: View = { fit: true, zoom: 1, x: 0, y: 0 };

/** Fitted into `w` x `h`, centered; never blown up past 100%. */
function fitted(nat: Size, w: number, h: number): View {
  const zoom =
    nat.w > 0 && nat.h > 0 && w > 0 && h > 0
      ? Math.min(1, w / nat.w, h / nat.h)
      : 1;
  return {
    fit: true,
    zoom,
    x: (w - nat.w * zoom) / 2,
    y: (h - nat.h * zoom) / 2,
  };
}

/** `v` zoomed by `factor`, keeping the point (`px`, `py`) where it is. */
function zoomAt(v: View, factor: number, px: number, py: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
  const k = zoom / v.zoom;
  return { fit: false, zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}

interface Size {
  w: number;
  h: number;
}

/**
 * Transparency shows as a checkerboard behind the picture only; the rest of
 * the viewer is the editor ground, like every other Tab. The squares stay
 * 8px on screen at any zoom.
 */
const checker = (zoom: number): CSSProperties => ({
  backgroundImage:
    "repeating-conic-gradient(var(--z-hairline-strong) 0 25%, var(--z-sunken) 0 50%)",
  backgroundSize: `${16 / zoom}px ${16 / zoom}px`,
});

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
 * A read-only Image Tab. The bytes become a `blob:` URL shown in an `<img>`,
 * so an SVG is only ever an image (its scripts never run). Fits by default;
 * Mod+= / Mod+- / Mod+0 and Mod+wheel zoom, dragging pans.
 */
export function ImageHost({
  tab,
  readBytes,
  reloadSeq,
  onInfo,
  keys = true,
}: ImageHostProps) {
  const path = tab.file?.path ?? "";
  const missing = tab.file?.held === "missing";
  const format = formatOf(path);
  const [src, setSrc] = useState<{ url: string; bytes: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [nat, setNat] = useState<Size | null>(null);
  const [box, setBox] = useState<Size>({ w: 0, h: 0 });
  const [manual, setManual] = useState<View | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const view = manual ?? (nat ? fitted(nat, box.w, box.h) : FIT);
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  });

  // Read the bytes; a new URL per read, revoked when replaced or unmounted.
  useEffect(() => {
    if (!path || missing) return;
    let live = true;
    let url: string | null = null;
    readBytes(path).then(
      (buf) => {
        if (!live) return;
        url = URL.createObjectURL(new Blob([buf], { type: format.mime }));
        setFailed(false);
        // A new image: its size is known once it loads.
        setNat(null);
        setSrc({ url, bytes: buf.byteLength });
      },
      (err: unknown) => {
        console.error("read image", err);
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, missing, reloadSeq, readBytes, format.mime]);

  // The viewport's size, for fitting.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomBy = useCallback((factor: number, px?: number, py?: number) => {
    const el = ref.current;
    const cx = px ?? (el ? el.clientWidth / 2 : 0);
    const cy = py ?? (el ? el.clientHeight / 2 : 0);
    setManual(zoomAt(viewRef.current, factor, cx, cy));
  }, []);

  // Mod+= / Mod+- / Mod+0, wherever the focus is while this Tab is shown.
  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      // Typing somewhere (a sidebar field, a rename) keeps its own keys.
      if (typesText(e.target)) return;
      const mac = platform === "mac";
      if (!(mac ? e.metaKey : e.ctrlKey) || (mac ? e.ctrlKey : e.metaKey)) {
        return;
      }
      if (e.altKey) return;
      if (e.key === "=" || e.key === "+" || e.code === "NumpadAdd") {
        zoomBy(KEY_STEP);
      } else if (e.key === "-" || e.code === "NumpadSubtract") {
        zoomBy(1 / KEY_STEP);
      } else if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") {
        setManual(null);
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, keys]);

  // Mod+wheel zooms toward the cursor; a plain wheel pans. Not passive, so
  // the page itself never scrolls or zooms.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomBy(
          e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP,
          e.clientX - r.left,
          e.clientY - r.top,
        );
      } else {
        const v = viewRef.current;
        setManual({ ...v, fit: false, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, view: viewRef.current };
    const move = (m: MouseEvent) =>
      setManual({
        ...start.view,
        fit: false,
        x: start.view.x + m.clientX - start.x,
        y: start.view.y + m.clientY - start.y,
      });
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const size = { w: img.naturalWidth, h: img.naturalHeight };
    setNat(size);
    setFailed(false);
    if (src) {
      onInfo?.({
        width: size.w,
        height: size.h,
        format: format.name,
        bytes: src.bytes,
      });
    }
  };

  // Nothing shown: the status bar shows no size either.
  useEffect(() => {
    if (missing || failed) onInfo?.(null);
  }, [missing, failed, onInfo]);

  const message = missing ? null : failed ? "This image can't be shown." : null;

  return (
    <div
      ref={ref}
      data-image-viewport=""
      data-fit={String(view.fit)}
      data-zoom={view.zoom}
      data-x={view.x}
      data-y={view.y}
      onMouseDown={onMouseDown}
      className="relative size-full cursor-grab select-none overflow-hidden bg-editor active:cursor-grabbing"
    >
      {message ? (
        <div className="flex size-full items-center justify-center text-[12px] text-muted">
          {message}
        </div>
      ) : (
        src &&
        !missing && (
          <img
            src={src.url}
            alt={tab.title}
            draggable={false}
            onLoad={onLoad}
            onError={() => setFailed(true)}
            className="absolute left-0 top-0 max-w-none origin-top-left"
            style={{
              ...checker(view.zoom),
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              opacity: nat ? 1 : 0,
              imageRendering: view.zoom > 2 ? "pixelated" : "auto",
            }}
          />
        )
      )}
    </div>
  );
}
