# PDF viewer: design

Date: 2026-11-25. Status: draft for approval.

## Intent

Users read long PDFs (specs, papers, manuals) in Zukai over several sessions. They need to read comfortably (zoom, move between pages), pull passages into their notes (select and copy), find things in a 300-page document (Find), and land back where they stopped every time they open the file.

## Goals

- A new read-only Kind, **PDF**, for `.pdf` Files.
- Continuous vertical scroll through all pages, rendered lazily so large documents stay fast.
- Zoom: Mod+= / Mod+- / Mod+0, like Image, plus Mod+wheel zooming at the pointer. The default is fit width.
- Moving around: scroll, PageUp/PageDown, Home/End, and jump to page (click the page number in the status bar, or a shortcut).
- Text selection and copy (Mod+C), through a pdf.js text layer.
- Find (Mod+F, F3 / Shift+F3) with a match count and highlighted matches.
- **Last position is remembered per file.** Opening a PDF, from any Tab and after closing it or restarting, restores its page, the offset within that page, and the zoom.

## Non-goals (first version)

- Outline / table of contents panel. This comes next and should be easy to add (see Approaches).
- Annotations, form filling, editing, printing, or saving a PDF.
- PDF Scratchpads. A PDF is only ever a File.
- Thumbnails sidebar, two-page spread, rotation.
- Following links inside the PDF. Internal links may work for free with pdf.js, which is fine. External links are not opened.

## Anti-goals

- Landing on page 1 of a document you were halfway through. That defeats the point.
- A viewer that looks like an embedded web page (the stock pdf.js toolbar or chrome), or whose shortcuts fight the app's.
- Slowing down app launch, or a text-only session. pdf.js loads only when a PDF Tab first opens.
- Running anything from the PDF. No PDF JavaScript, no live links, nothing beyond the CSP.

## Constraints (from the project)

- CSP: `object-src 'none'`, `worker-src 'self' blob:`. The webview's built-in PDF viewer can't be used (WebKitGTK on Linux has none anyway). Rendering is in-app.
- Assets ship with the app and never come from a CDN. The pdf.js worker, CMaps and standard fonts are bundled.
- Bytes are read through Rust under the grants (`file_read_bytes`, as Image does). The general read cap is `MAX_OPEN_BYTES` = 50 MB (`src-tauri/src/files/io.rs`). PDFs get 300 MB (see Size cap).
- Vocabulary follows `CONTEXT.md`: add **PDF** to Kind and a glossary entry.
- Must work on Windows (WebView2), macOS (WKWebView) and Linux (WebKitGTK).

## Approaches

- **A. pdf.js's viewer layer (`pdfjs-dist/web/pdf_viewer`: `PDFViewer`, `EventBus`, `PDFFindController`, `PDFLinkService`) wrapped in a React `PdfHost`. Chosen.** It gives continuous scroll, lazy page rendering, the text layer and find out of the box, on the engine Firefox uses. The cost: we fit around its DOM and CSS, the worker is ~1 MB, and it loads lazily. The outline can later come from `pdfDocument.getOutline()` plus the link service.
- **B. pdf.js for parsing only, with our own viewer.** Full control, but it rebuilds lazy rendering, the text layer and especially find (matches across line wraps, highlighting). Rejected as much more code for the same result.
- **C. Native rendering in Rust (PDFium).** Fast and sharp, but it ships a binary per OS, and selection and find would have to be rebuilt over images. That works against "copy into notes". Rejected.
- Stock `viewer.html` in an iframe: rejected. Wrong look, and its shortcuts conflict with the app's.

The user handed the choice of approach to me. A is my call.

## Design

### Kind and opening

- `src/model/kinds.ts`: add `"pdf"` to `Kind`, with a `PDF_EXTS = [".pdf"]` that maps to it. Update the session's `KINDS` list, the Sidebar icon, and the "Save As refuses a Kind change" rule.
- A PDF Tab is read-only, like Image: nothing to save, and the File reloads when it changes on disk. FileBar keeps "Open with default app" (see below).

### PdfHost (`src/pdf/PdfHost.tsx`)

- Modelled on `ImageHost`: props `tab`, `readBytes`, `reloadSeq`, `keys` (zoom/navigation keys only when focused, for Splits), `onInfo` (for the status bar), plus position in and out (below).
- Lazy-imports `pdfjs-dist` and the viewer on first mount. The worker is a bundled asset (Vite `?url`), loaded from `'self'`. It uses pdf.js's `legacy/` build (library, viewer, CSS and worker): the modern build relies on JS too new for WKWebView and WebKitGTK (`Map.prototype.getOrInsertComputed`, `Math.sumPrecise`, …), which the legacy build polyfills.
- `isEvalSupported: false`, and the PDF's own scripting is disabled. Links: internal links navigate, external links do nothing.
- The viewer is themed to Zukai: the page background is the app background, pages have a subtle shadow, and selection uses the accent colour. There is no pdf.js toolbar.
- Errors: an encrypted or corrupt PDF shows a short notice in the Tab, like an invalid drawing on a Canvas, with an "Open with default app" button. A password prompt is out of scope.

### Size cap (decided by the owner)

- PDFs get their own higher read cap of 300 MB and are loaded whole. The cap for every other file stays 50 MB. This needs a small Rust change, for example a `file_read_bytes` variant or a cap parameter chosen by extension in Rust, never trusted from the UI.
- A PDF over 300 MB shows a notice in the Tab ("Too large to show in Zukai") with "Open with default app".
- Streaming byte ranges was considered and rejected for now as a much bigger build.

### Open with default app (decided by the owner)

- PDF Tabs keep a small, quiet "Open with default app" action, so printing, forms, passwords and external links stay one click away. It gets its own FileBar branch or status-bar action, which the builder picks to match the app's restrained look. For Image, FileBar shows no bar while the file is present; PDF differs here on purpose.
- The missing-file and disk-change behaviour otherwise matches Image.

### Status bar

`PDF · Page 12 / 340 · 125% · 4.2 MB`. Clicking the page number opens a small inline "go to page" input. This follows the Image pattern (`ImageInfo` → a `PdfInfo`).

### Find

- Mod+F in a PDF Tab opens a find bar without replace. It has the case-sensitive and whole-word toggles. Regexp is hidden, because PDFFindController has no regexp.
- It reuses `FindBar`'s look and layout. `FindBar` is tied to CodeMirror today, so the builder should pull out the presentational part, or add a PDF mode, rather than fork the styling.
- It shows the match count ("3 of 41") from PDFFindController's `updatefindmatchescount`. Enter / F3 goes to the next match, Shift+Enter / Shift+F3 to the previous one, and Esc closes the bar.

### Remembered position (per file)

- What is stored: `{ page, offsetInPage (0–1 fraction of page height), zoom (number | "fit-width"), updatedAt }`, keyed by the file's absolute path, normalised the same way the app already normalises paths for grants and recents.
- Where it is stored: one JSON file in Zukai's storage directory (for example `pdf-positions.json`), written atomically through the existing `atomic.rs`, with new Rust commands `pdf_positions_read` / `pdf_positions_write`. It is never written into the PDF, and it is separate from the Session.
- When it is written: debounced (about 1 s) after scrolling or zooming stops, and also when the Tab closes and when the app exits.
- When it is restored: once the document has loaded, before the first paint where possible, so the user doesn't see page 1 flash first.
- Capped at the 500 most recently used entries, with the oldest dropped.
- The per-file store is the only source of truth for a PDF's position. A PDF Tab stores no viewport or scroll in the Session. (My call.)
- Older Sessions saved a `.pdf` Tab as Kind "text". On restore, a Tab whose path ends in `.pdf` is remapped to the PDF Kind. This is a one-time migration, and the "Kind never changes" rule is about edits, not this upgrade. (My call.)
- Edge cases:
  - The file changed on disk: reload and keep the position. If the page no longer exists, go to the last page.
  - The file was renamed or moved: its position is forgotten, which is accepted.
  - The same PDF is open in two Tabs or both halves of a Split: the last one to write wins.
  - A malformed store is ignored and rebuilt, like a malformed viewport.

## Left to the builder

- The exact `pdfjs-dist` version. Pin it, following the project's rule for heavy dependencies (Excalidraw is pinned). Also how the worker, CMaps and standard fonts are bundled under the CSP.
- The jump-to-page shortcut. Mod+G is free (only Mod+Shift+G is taken) and is the suggestion.
- Debounce timing, the zoom steps (reuse Image's ×1.25 key step and ×1.1 wheel step), and min/max zoom.
- How the text layer and find highlight colours map onto each theme.
- Tests: the kind mapping, round-tripping the position store (including the cap and malformed input), restoring the position, clamping the page, and the Find wiring. Mock pdf.js where jsdom can't run it.
