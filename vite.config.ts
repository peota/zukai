import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cpSync, createReadStream, statSync } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
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
        const file = resolve(
          excalidrawFonts,
          decodeURIComponent(url.slice(prefix.length)),
        );
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), excalidrawAssets()],

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
