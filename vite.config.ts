import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cpSync, createReadStream, statSync } from "node:fs";
import { extname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

/** Where the app serves Excalidraw's assets (EXCALIDRAW_ASSET_PATH). */
const EXCALIDRAW_ASSETS = "/excalidraw-assets/";
const excalidrawFonts = fileURLToPath(
  new URL(
    "./node_modules/@excalidraw/excalidraw/dist/prod/fonts",
    import.meta.url,
  ),
);

/**
 * Excalidraw's fonts ship with the app, at /excalidraw-assets/fonts/: served
 * by the dev server and copied into the build, so they're never fetched from
 * a CDN.
 */
function excalidrawAssets(): Plugin {
  const prefix = `${EXCALIDRAW_ASSETS}fonts/`;
  return {
    name: "zukai-excalidraw-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith(prefix)) return next();
        let name: string;
        try {
          name = decodeURIComponent(url.slice(prefix.length));
        } catch {
          return next(); // A malformed %-escape (URIError).
        }
        const file = resolve(excalidrawFonts, name);
        const rel = relative(excalidrawFonts, file);
        if (rel.startsWith("..") || isAbsolute(rel)) return next();
        try {
          if (!statSync(file).isFile()) return next();
        } catch {
          return next();
        }
        res.setHeader("Content-Type", "font/woff2");
        createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      if (!options.dir) return;
      cpSync(excalidrawFonts, join(options.dir, prefix), { recursive: true });
    },
  };
}

/** Where the app serves pdf.js's assets (PDFJS_ASSETS in src/pdf/pdfjs.ts). */
const PDFJS_ASSETS = "/pdfjs-assets/";
const pdfjsDist = fileURLToPath(
  new URL("./node_modules/pdfjs-dist", import.meta.url),
);
/** The folders `getDocument` fetches from (cMapUrl, standardFontDataUrl, …). */
const PDFJS_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"];
const PDFJS_TYPES: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript",
  ".ttf": "font/ttf",
};

/**
 * pdf.js's CMaps, standard fonts, wasm decoders and ICC profiles ship with the
 * app, at /pdfjs-assets/<dir>/: served by the dev server and copied into the
 * build, so they come from 'self' and never from a CDN.
 */
function pdfjsAssets(): Plugin {
  return {
    name: "zukai-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith(PDFJS_ASSETS)) return next();
        let name: string;
        try {
          name = decodeURIComponent(url.slice(PDFJS_ASSETS.length));
        } catch {
          return next(); // A malformed %-escape (URIError).
        }
        if (!PDFJS_DIRS.includes(name.split("/")[0])) return next();
        const file = resolve(pdfjsDist, name);
        const rel = relative(pdfjsDist, file);
        if (rel.startsWith("..") || isAbsolute(rel)) return next();
        try {
          if (!statSync(file).isFile()) return next();
        } catch {
          return next();
        }
        res.setHeader(
          "Content-Type",
          PDFJS_TYPES[extname(file)] ?? "application/octet-stream",
        );
        createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      if (!options.dir) return;
      for (const dir of PDFJS_DIRS) {
        cpSync(join(pdfjsDist, dir), join(options.dir, PDFJS_ASSETS, dir), {
          recursive: true,
        });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), excalidrawAssets(), pdfjsAssets()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
