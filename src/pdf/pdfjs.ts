// pdf.js's legacy build: the modern one uses brand-new JS (Map's
// getOrInsertComputed, Math.sumPrecise, Promise.try, Uint8Array.fromBase64…)
// that WKWebView and WebKitGTK may not have yet; the legacy build carries
// polyfills for it. The same version, and the same assets.
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

export interface Pdfjs {
  lib: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  viewer: typeof import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
}

/**
 * Where the app serves pdf.js's CMaps, standard fonts, wasm decoders and ICC
 * profiles: by the dev server and copied into the build (vite.config.ts), so
 * they come from 'self', never a CDN.
 */
export const PDFJS_ASSETS = "/pdfjs-assets/";

/** The asset folders for `getDocument`, as absolute URLs with a trailing slash. */
export function pdfAssetParams() {
  const at = (dir: string) =>
    new URL(`${PDFJS_ASSETS}${dir}/`, window.location.href).href;
  return {
    cMapUrl: at("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: at("standard_fonts"),
    wasmUrl: at("wasm"),
    iccUrl: at("iccs"),
  };
}

let loading: Promise<Pdfjs> | null = null;

/**
 * pdf.js and its viewer layer, loaded once on first use (they stay out of the
 * main bundle). The viewer reads `globalThis.pdfjsLib`, which the library
 * sets, so the library is evaluated first.
 */
export function loadPdfjs(): Promise<Pdfjs> {
  loading ??= (async () => {
    const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    const viewer = await import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
    return { lib, viewer };
  })().catch((err: unknown) => {
    // A failed chunk load can be retried by the next viewer.
    loading = null;
    throw err;
  });
  return loading;
}
