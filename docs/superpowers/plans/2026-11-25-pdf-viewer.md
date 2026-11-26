# PDF Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open `.pdf` Files in a read-only PDF Kind with continuous scroll, zoom, page navigation, text selection and copy, and Find. Every PDF reopens at the page, offset and zoom where the user left it.

**Architecture:** pdf.js's viewer layer (`PDFViewer`, `EventBus`, `PDFLinkService`, `PDFFindController`) is wrapped in a lazily loaded React `PdfHost`, modelled on `ImageHost`. Bytes come through Rust under the grants, with a 300 MB cap for `.pdf`. Positions live in one per-file JSON store in Zukai's data dir. They are written through a debounced Saver and flushed before exit.

**Tech Stack:** React 19, TypeScript, Vitest, Tauri 2 / Rust, `pdfjs-dist@6.5.438` (pinned exact; published 2026-11-01).

**Spec:** `docs/superpowers/specs/2026-11-25-pdf-viewer-design.md`

## Global Constraints

- Kind name `"pdf"`, extension `.pdf` (case-insensitive). A PDF is only ever a File, never a Scratchpad.
- PDF read cap: 300 MB (`300 * 1024 * 1024`). Every other file keeps `MAX_OPEN_BYTES` = 50 MB. The cap is chosen in Rust from the path's extension and never passed from the UI.
- Over the cap, the Tab shows: "Too large to show in Zukai", with an "Open with default app" button.
- pdf.js loads only when a PDF Tab first mounts (dynamic `import()`). Worker, CMaps and standard fonts are bundled with the app. No CDN.
- CSP stays unchanged: `object-src 'none'`, `worker-src 'self' blob:`. Pass `isEvalSupported: false` and `enableScripting: false`. External links do nothing.
- Position store: `pdf-positions.json` in `storage::data_dir`, written atomically. Each entry is `{ page, offsetInPage (0–1), zoom (number | "fit-width"), updatedAt }`, keyed by `pathKey(path, platform)`. At most 500 entries, newest first. Writes are debounced at 1000 ms.
- Default zoom is `"fit-width"`. Key zoom step ×1.25, wheel step ×1.1, zoom range 0.25–5 (pdf.js scale).
- Status bar: `PDF · Page 12 / 340 · 125% · 4.2 MB`.
- Jump to page: Mod+G.
- Copy follows `CONTEXT.md` vocabulary (Tab, File, Kind).

## Review Focus

1. **A PDF in a background Tab, or a just-mounted one, must never overwrite its stored position with page 1.** Only save after the restore has been applied, and only while the viewer is visible with a non-zero size. (Test: Task 6.)
2. **A 50–300 MB PDF must not reload forever.** Its fingerprint has to be a real hash, not the "unread" empty hash, or every disk check looks like a change. (Test: Task 1.)
3. **When the file changes on disk and the stored page is now beyond the page count,** land on the last page, not page 1 or an error. (Test: Task 6.)
4. **In a Split, only the focused half takes Mod+= / Mod+G / PageDown.** Both halves showing the same PDF must not fight over the store; the last write wins, and nothing breaks. (Test: Task 6.)
5. **A Session from before this change, with a `.pdf` Tab saved as Kind "text",** restores as a PDF Tab and is never shown as garbage text. (Test: Task 3.)

---

### Task 1: Rust — 300 MB cap for PDFs

**Files:**
- Modify: `src-tauri/src/files/io.rs` (`MAX_OPEN_BYTES`, `read_bytes`, `read_capped`)
- Modify: `src-tauri/src/files/fingerprint.rs` (`fingerprint_of`, which calls `read_capped`)
- Modify: every other `read_capped` caller (`grep -rn read_capped src-tauri/src`)

**Interfaces:**
- Produces: `pub const MAX_PDF_BYTES: u64 = 300 * 1024 * 1024;` and `pub(crate) fn open_cap(path: &Path) -> u64` (300 MB if the extension is `pdf` in any case, else `MAX_OPEN_BYTES`). `read_capped(f: &File, len: u64, cap: u64)`. `read_bytes(path)` and `fingerprint_of(path)` use `open_cap(path)`. `file_read` (text) keeps `MAX_OPEN_BYTES`, so a PDF is never decoded as text past 50 MB.

- [ ] **Step 1: Write failing tests** in `io.rs` tests: `open_cap_is_larger_for_pdf` (`open_cap(Path::new("a/B.PDF")) == MAX_PDF_BYTES`, `open_cap(Path::new("a.png")) == MAX_OPEN_BYTES`), and `read_capped_honours_cap` (an 11-byte file with cap 10 → `None`, with cap 11 → `Some`). In `fingerprint.rs` tests: `pdf_over_open_cap_is_hashed`. Create a sparse 60 MB `big.pdf` with `File::set_len`, check that `fingerprint_of` returns a non-empty `hash`, and that the same file named `big.bin` gets an empty hash.
- [ ] **Step 2: Run** `cd src-tauri && cargo test files::` → expect a compile failure (`open_cap` is undefined).
- [ ] **Step 3: Implement** `MAX_PDF_BYTES`, `open_cap`, and the `cap` parameter. Thread the cap through all callers: text reads pass `MAX_OPEN_BYTES`, while byte reads and fingerprints pass `open_cap(path)`. Update the `read_bytes_checked` doc comment ("an Image or a PDF").
- [ ] **Step 4: Run** `cd src-tauri && cargo test` → all pass. Also run `cargo clippy -- -D warnings` → clean.
- [ ] **Step 5: Commit** `feat(files): 300 MB read cap for PDFs`

### Task 2: Rust + API — PDF position store file

**Files:**
- Create: `src-tauri/src/storage/pdf_positions.rs`
- Modify: `src-tauri/src/storage/mod.rs` (`pub mod pdf_positions;`)
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs` (register the commands next to `session_read` / `session_write`)
- Modify: `src/storage/api.ts`

**Interfaces:**
- Produces (Rust): `pub fn read(base: &Path) -> Result<Option<String>>` and `pub fn write(base: &Path, json: &str) -> Result<()>` on `base.join("pdf-positions.json")`, using `atomic_write`. These mirror `storage/session.rs`. Commands: `pdf_positions_read(app) -> Result<Option<String>>` and `pdf_positions_write(app, json: String) -> Result<()>`, both via `blocking`.
- Produces (TS): `readPdfPositions(): Promise<string | null>` and `writePdfPositions(json: string): Promise<void>` in `src/storage/api.ts`.

- [ ] **Step 1: Write failing tests** in `pdf_positions.rs`: `missing_is_none`, and `write_then_read_round_trips` (write `{"a":1}`, then read it back as `Some`).
- [ ] **Step 2: Run** `cargo test pdf_positions` → FAIL (no module).
- [ ] **Step 3: Implement** the module, the commands, the registration and the TS wrappers. The Rust side does not validate the JSON; the UI parses defensively (Task 4).
- [ ] **Step 4: Run** `cargo test pdf_positions` → PASS. Run `pnpm typecheck` → clean.
- [ ] **Step 5: Commit** `feat(storage): pdf-positions.json read/write`

### Task 3: Model — the PDF Kind

**Files:**
- Modify: `src/model/kinds.ts`, `src/model/kinds.test.ts`
- Modify: `src/model/session.ts`, `src/model/session.test.ts`
- Modify: `src/ui/icons.tsx` (+ its test in `src/ui/Sidebar.test.tsx`)

**Interfaces:**
- Produces: `Kind = "text" | "canvas" | "image" | "pdf" | "diff"`, `PDF_EXT = ".pdf"`, `kindOf("x.PDF") === "pdf"`. Also `isViewerKind(kind: Kind | undefined): boolean`, true for `"image"` and `"pdf"`: read-only Kinds whose text is never kept, shadowed or saved.
- Session: `KINDS` includes `"pdf"`. A new `withPdfKind(t)` runs after `withKind` and remaps `kind: "text"` with `file.path` ending in `.pdf` (any case) to `"pdf"`, dropping `markdownMode`, `hidden` and `preview*` fields if present.
- Icon: a `"pdf"` icon key (lucide `FileText`) for `.pdf` rows.

- [ ] **Step 1: Write failing tests:**
  - `kindOf("C:\\docs\\Spec.PDF") === "pdf"`.
  - `isViewerKind("pdf")` and `isViewerKind("image")` are true; `isViewerKind("text")` is false.
  - Session: a v-current session with `{ kind: "text", file: { path: "/a/b.pdf", … } }` parses to `kind: "pdf"`.
  - `{ kind: "pdf", file: … }` round-trips.
  - Sidebar: `iconOf(row("spec.pdf")) === "pdf"`.
- [ ] **Step 2: Run** `pnpm vitest run src/model src/ui/Sidebar.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Save As's Kind-change refusal (`useLibrary.ts:825`) already compares `kindOf`, so it covers `.pdf` without a change; add one assertion to its existing test.
- [ ] **Step 4: Run** the same command → PASS. Then `pnpm typecheck` will list every exhaustive `switch` on `Kind` that needs a `"pdf"` arm. Give each one the `"image"` arm's behaviour for now (Task 5 makes it explicit).
- [ ] **Step 5: Commit** `feat(model): PDF Kind`

### Task 4: Position store (TS)

**Files:**
- Create: `src/pdf/positions.ts`, `src/pdf/positions.test.ts`

**Interfaces:**
- Consumes: `readPdfPositions` / `writePdfPositions` (Task 2), `createSaver` (`src/storage/autosave.ts`), `pathKey` + `detectPlatform`.
- Produces:
  ```ts
  export type PdfZoom = number | "fit-width";
  export interface PdfPosition { page: number; offsetInPage: number; zoom: PdfZoom; updatedAt: number }
  export const MAX_ENTRIES = 500;
  export function parsePositions(json: string | null): Map<string, PdfPosition>; // drops malformed entries; garbage → empty
  export function serializePositions(m: Map<string, PdfPosition>): string;       // newest first, first MAX_ENTRIES
  export interface PdfPositionStore {
    get(path: string): Promise<PdfPosition | undefined>; // loads the file once, lazily
    set(path: string, pos: Omit<PdfPosition, "updatedAt">): void; // debounced 1000 ms write
    flush(): Promise<void>;
  }
  export function createPdfPositionStore(io?: { read(): Promise<string | null>; write(json: string): Promise<void> }, now?: () => number): PdfPositionStore;
  export const pdfPositions: PdfPositionStore; // the app's singleton
  ```
  Validity rules: `page` is an integer ≥ 1. `offsetInPage` is in [0, 1]. `zoom` is `"fit-width"` or a finite number in [0.25, 5]. `updatedAt` is finite.

- [ ] **Step 1: Write failing tests:**
  - `parsePositions` of `"{broken"` → empty map.
  - An entry with `page: 0` or `zoom: "huge"` is dropped and its siblings are kept.
  - `serializePositions` of 501 entries keeps the 500 with the highest `updatedAt`.
  - `set` twice within 1000 ms → `io.write` is called once with the latest value (fake timers).
  - Keys are case-insensitive on Windows: `set("C:\\A.pdf")`, then `get("c:\\a.pdf")` returns it (mock the platform as windows).
  - `flush()` writes a pending `set` immediately.
- [ ] **Step 2: Run** `pnpm vitest run src/pdf/positions.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Use one `createSaver((_, json) => io.write(json), 1000)` with the fixed id `"pdf-positions"`. Do **not** add it to `useWorkspace`'s `savers` array, because that would make the status bar's save indicator flicker while scrolling (see Task 7 for the exit flush).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(pdf): per-file position store`

### Task 5: Viewer-Kind plumbing — PDFs are read-only Files

**Files:**
- Modify: `src/app/files/loading.ts` (`readFileText`), `src/app/files/closeReopen.ts`, `src/app/files/context.ts` (`keepAside`), `src/app/files/barActions.ts`, `src/app/files/save.ts`, `src/files/documentWriter.ts`
- Modify: `src/ui/FileBar.tsx`
- Modify: `src/app/useWorkspace.ts` (`"zoom"`, `"find"`/`"replace"` cases)
- Tests: the matching `*.test.ts(x)` next to each

**Interfaces:**
- Consumes: `isViewerKind` (Task 3).
- Produces:
  - Every `kind === "image"` check in the files listed above becomes `isViewerKind(kind)`.
  - `save.ts` exports `PDF_READ_ONLY = "PDFs are read-only in Zukai"` and returns it for `"pdf"` where it returns `IMAGE_READ_ONLY` for images.
  - **Loading a PDF never reads its text.** `readFileText` for a `"pdf"` Tab calls `fileFingerprint(path)` instead of `readDisk`. If the result is `null`, it patches `held: "missing"`. On success it patches `{ ...settled, fingerprint, held: null }` and returns `""`. That's how disk changes and Missing still reach the Tab without a 300 MB text decode.
  - FileBar for `"pdf"`: a missing File shows the same error bar as Image. Otherwise it shows **no bar**. ("Open with default app" lives in the status bar; see Task 7.)
  - `useWorkspace` `"zoom"`: a `"pdf"` Tab zooms itself, as Image does (no `zoomEditor`). `"find"` / `"replace"` on a `"pdf"` Tab: `setFindRequest({ mode: "find", seq })` without touching the Markdown mode. PdfHost consumes it.

- [ ] **Step 1: Write failing tests:**
  - loading: a `"pdf"` Tab's `loadContent` resolves `""`, calls `fileFingerprint` and never calls `fileRead`, and patches the fingerprint.
  - A gone file → `held: "missing"`.
  - save: Mod+S on a PDF Tab shows `PDF_READ_ONLY`.
  - context: `keepAside` on a PDF Tab never schedules a write.
  - FileBar: a PDF Tab with `held: null` renders nothing; with `held: "missing"`, it renders "was moved or deleted".
  - useWorkspace: the `"replace"` command on a PDF Tab yields `findRequest.mode === "find"`.
- [ ] **Step 2: Run** `pnpm vitest run src/app src/ui/FileBar.test.tsx src/files` → the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` → all pass. Run `pnpm typecheck` → clean.
- [ ] **Step 5: Commit** `feat(pdf): PDF Tabs are read-only viewer Files`

### Task 6: PdfHost — render, navigate, zoom, remember

**Files:**
- Modify: `package.json` / `pnpm-lock.yaml` (`pnpm add pdfjs-dist@6.5.438 --save-exact`)
- Modify: `vite.config.ts` only if needed to copy `pdfjs-dist/cmaps` and `pdfjs-dist/standard_fonts` into the build (for example a small `viteStaticCopy`-free plugin, or `?url` imports). Assets are served from `'self'`.
- Create: `src/pdf/pdfjs.ts` (the lazy loader), `src/pdf/PdfHost.tsx`, `src/pdf/PdfHost.test.tsx`, `src/pdf/pdf.css` (imports `pdfjs-dist/web/pdf_viewer.css`, then Zukai overrides)
- Modify: `src/app/TabPane.tsx` (render `PdfHost` for `"pdf"`, like `ImageHost`), `src/model/types.ts`

**Interfaces:**
- Consumes: `pdfPositions` (Task 4), `fileReadBytes`, `reloadSeq`, `keys` (focused half), `isEditorTarget`, `detectPlatform`.
- Produces:
  ```ts
  // src/model/types.ts
  export interface PdfInfo { page: number; pages: number; zoom: number /* scale, 1 = 100% */; bytes: number }
  // src/pdf/pdfjs.ts
  export function loadPdfjs(): Promise<{ lib: typeof import("pdfjs-dist"); viewer: typeof import("pdfjs-dist/web/pdf_viewer.mjs") }>; // memoised; sets GlobalWorkerOptions.workerSrc from `pdfjs-dist/build/pdf.worker.min.mjs?url`
  // src/pdf/PdfHost.tsx
  export interface PdfHostProps {
    tab: TabState; readBytes(path: string): Promise<ArrayBuffer>; reloadSeq: number;
    keys?: boolean; onInfo?(info: PdfInfo | null): void;
    onOpenDefault?(): void;            // for the error notice
    findRequest?: FindRequest | null;  // consumed in Task 8
    goToPage?: { page: number; seq: number } | null; // from the status bar (Task 7)
  }
  ```
- Behaviour:
  - Open the document with `getDocument({ data, isEvalSupported: false, enableScripting: false, cMapUrl, cMapPacked: true, standardFontDataUrl })`. Create `EventBus`, `PDFLinkService` (`externalLinkEnabled: false`) and `PDFViewer({ container, eventBus, linkService, textLayerMode: 1 /* ENABLE */, annotationMode: AnnotationMode.ENABLE })`. Don't create a toolbar.
  - **Restore:** on `pagesinit`, `await pdfPositions.get(path)`. Set `currentScaleValue = "page-width"` for `"fit-width"`, otherwise `currentScale = zoom`. Then call `scrollPageIntoView({ pageNumber: clamp(page, 1, pagesCount), destArray: [null, { name: "XYZ" }, 0, topInPdfUnits(offsetInPage), null] })`. Equivalently, set `container.scrollTop` to the page's `offsetTop + offsetInPage * height` after layout; pick whichever the tests can pin. Set a `restored` flag only after this.
  - **Save:** on container `scroll` and on `scalechanging`, if `restored && container.clientHeight > 0`, compute `{ page: currentPageNumber, offsetInPage: (scrollTop - pageDiv.offsetTop) / pageDiv.offsetHeight clamped to [0,1], zoom: currentScaleValue === "page-width" ? "fit-width" : currentScale }` and call `pdfPositions.set`. On unmount, `set` once more under the same guard.
  - **Reload** (`reloadSeq` bump): capture the current position, destroy the old document, load the new bytes, and restore the captured position (clamped). Don't re-read the store.
  - **Keys** (window `keydown`, only when `keys !== false` and not `isEditorTarget`):
    - Mod+= / Mod+- multiply `currentScale` by 1.25 / 0.8, clamped to [0.25, 5].
    - Mod+0 sets `"page-width"`.
    - PageUp/PageDown scroll by one container height; Home/End go to the first/last page.
    - Mod+G opens the status bar's go-to-page input. PdfHost calls `onInfo` and App owns the input (Task 7); PdfHost exposes nothing extra.
    - Mod+wheel zooms ×1.1 toward the pointer. A non-passive listener on the container calls `preventDefault`.
  - **Info:** call `onInfo({ page, pages, zoom: currentScale, bytes })` on `pagechanging`, `scalechanging` and load, and `onInfo(null)` while loading or on error.
  - **Errors** are a notice centred in the Tab, with an "Open with default app" button calling `onOpenDefault`:
    - `PasswordException` → "This PDF is password-protected."
    - `InvalidPDFException` / other errors → "This file can't be shown as a PDF."
    - Rust `too_large` → "Too large to show in Zukai."
  - Theme: the container background is `var(--bg)` or its equivalent app token, pages get a subtle shadow, and `::selection` in the text layer uses the accent colour. No pdf.js chrome.

- [ ] **Step 1: Write failing tests** in `PdfHost.test.tsx`. Mock `src/pdf/pdfjs.ts` with a fake viewer: an `EventBus`-like emitter, settable `currentScale`/`currentScaleValue`, `currentPageNumber`, `pagesCount`, and a spy `scrollPageIntoView`. Mock `pdfPositions`.
  - `restores_stored_position`: the store has `{ page: 47, offsetInPage: 0.5, zoom: 1.5 }` and there are 340 pages. After `pagesinit`, `currentScale === 1.5` and `scrollPageIntoView` is called with `pageNumber: 47`.
  - `clamps_page_past_end`: the store has page 400 and there are 340 pages → `pageNumber: 340`.
  - `default_is_fit_width`: no entry → `currentScaleValue === "page-width"`.
  - `does_not_save_before_restore`: a scroll event before `pagesinit` → `pdfPositions.set` is not called.
  - `does_not_save_when_hidden`: `clientHeight` is 0 and a scroll event fires → `set` is not called.
  - `saves_on_scroll`: after restore, a scroll → `set(path, { page, offsetInPage, zoom })`.
  - `reload_keeps_position`: bump `reloadSeq` → the new document restores the pre-reload page without calling `pdfPositions.get` again.
  - `keys_only_when_focused`: with `keys={false}`, Mod+= leaves `currentScale` unchanged.
  - `password_notice`: `getDocument` rejects with `{ name: "PasswordException" }` → the notice text shows, and clicking "Open with default app" calls `onOpenDefault`.
  - `too_large_notice`: `readBytes` rejects with `{ kind: "too_large" }` → "Too large to show in Zukai."
- [ ] **Step 2: Run** `pnpm vitest run src/pdf` → FAIL.
- [ ] **Step 3: Install** `pdfjs-dist@6.5.438` (exact), then implement `pdfjs.ts`, `PdfHost.tsx`, `pdf.css`, and the TabPane branch. Pass `onOpenDefault` through TabPane from App's existing `openDefault` handler (`App.tsx:528`).
- [ ] **Step 4: Run** `pnpm test` → PASS. Run `pnpm typecheck` and `pnpm lint` → clean. Run `pnpm build` → it succeeds, and `dist/` contains the worker, `cmaps/` and `standard_fonts/`. The main chunk must not contain pdf.js: `grep -l "PDFViewer" dist/assets/index-*.js` → no match.
- [ ] **Step 5: Commit** `feat(pdf): PdfHost viewer with remembered position`

### Task 7: Status bar, go to page, Open with default app, exit flush

**Files:**
- Modify: `src/ui/StatusBar.tsx`, `src/ui/StatusBar.test.tsx`
- Modify: `src/App.tsx` (a `pdfInfo` map that mirrors `imageInfo`, `kindLabel` "PDF", the go-to-page state, Mod+G)
- Modify: `src/app/shortcuts.ts`, `src/app/shortcuts.test.ts`, `src/app/shortcutList.ts` (a `{ type: "goToPage" }` command on Mod+G)
- Modify: `src/app/useWorkspace.ts` (`beforeExit` also awaits `pdfPositions.flush()`)

**Interfaces:**
- Consumes: `PdfInfo` (Task 6), `PdfHostProps.goToPage`, `pdfPositions.flush` (Task 4).
- Produces:
  - `StatusBarProps.pdf?: PdfInfo`. It renders `PDF`, `Page {page} / {pages}` as a button, `{Math.round(zoom*100)}%`, and `fileSize(bytes)`.
  - `StatusBarProps.onGoToPage?(page: number): void`. Clicking the page button, or the `goToPage` command, swaps the button for a small number input. Enter commits a value clamped to [1, pages]; Esc or blur cancels.
  - `StatusBarProps.onOpenDefault?(): void`. For PDF Tabs (not executables; `.pdf` never is), it renders a quiet text button "Open with default app" at the end of the PDF group.
  - App turns `onGoToPage(n)` into `goToPage={{ page: n, seq }}` for the active PDF Tab, and PdfHost sets `currentPageNumber = page`.

- [ ] **Step 1: Write failing tests:**
  - StatusBar with `pdf={{ page: 12, pages: 340, zoom: 1.25, bytes: 4_404_019 }}` shows "Page 12 / 340", "125%" and "4.2 MB".
  - Clicking "Page 12 / 340", typing 999 and pressing Enter → `onGoToPage(340)`.
  - Esc → not called.
  - The "Open with default app" button calls `onOpenDefault`.
  - Shortcuts: Mod+G → `{ type: "goToPage" }`, and Mod+Shift+G is unchanged.
  - useWorkspace: the exit flush awaits `pdfPositions.flush` (mock it and assert it was called before `app_exit_after_flush`).
- [ ] **Step 2: Run** `pnpm vitest run src/ui/StatusBar.test.tsx src/app` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(pdf): status bar page, zoom, go to page`

### Task 8: Find in a PDF

**Files:**
- Create: `src/find/PdfFindBar.tsx`, `src/find/PdfFindBar.test.tsx`
- Modify: `src/pdf/PdfHost.tsx` (create `PDFFindController({ eventBus, linkService })`, `viewer.setFindController`, and render the bar on `findRequest`)
- Modify: `src/find/FindBar.tsx` only to export the shared pieces the PDF bar reuses. Keep the same markup and class names, so the look comes from the same CSS with no copied styles.

**Interfaces:**
- Produces:
  ```ts
  export interface PdfFindState { search: string; caseSensitive: boolean; wholeWord: boolean }
  export interface PdfFindBarProps {
    initial: PdfFindState;
    count: { current: number; total: number } | null; // from updatefindmatchescount
    onQuery(state: PdfFindState, opts: { again: boolean; previous: boolean }): void;
    onClose(state: PdfFindState): void;
  }
  ```
  PdfHost maps `onQuery` to `eventBus.dispatch("find", { source: null, type: again ? "again" : "", query: search, caseSensitive, entireWord: wholeWord, highlightAll: true, findPrevious: previous, matchDiacritics: false })`. Close dispatches `"findbarclose"`. The count comes from `updatefindmatchescount` / `updatefindcontrolstate` (`matchesCount.current/total`). The state is remembered per Tab in memory, like `FindState`.
- Behaviour:
  - Typing searches live.
  - Enter or F3 → next; Shift+Enter or Shift+F3 → previous; Esc closes and returns focus to the viewer.
  - The count label uses `FindBar`'s wording: "No results", or "3 of 41".
  - There is no replace row and no regexp toggle.

- [ ] **Step 1: Write failing tests:**
  - Typing "spec" → `onQuery({ search: "spec", … }, { again: false, previous: false })`.
  - Shift+Enter → `previous: true, again: true`.
  - With `count={{ current: 3, total: 41 }}` it shows "3 of 41"; with `{ current: 0, total: 0 }` and a search, it shows "No results".
  - Esc → `onClose`.
  - There is no "Replace" input and no regexp toggle.
  - In `PdfHost.test.tsx`, `find_request_opens_bar` checks that a `findRequest` bump renders the bar and that a query dispatches `"find"` on the fake event bus.
- [ ] **Step 2: Run** `pnpm vitest run src/find src/pdf` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`, `pnpm typecheck` and `pnpm lint` → all pass and clean.
- [ ] **Step 5: Commit** `feat(pdf): find in PDF`

### Task 9: Docs and end-to-end check in the app

**Files:**
- Modify: `CONTEXT.md` (Kind list gets **PDF**, plus a glossary entry in the style of **Image**: read-only, continuous scroll, the zoom keys, Mod+G, Find, select and copy, the position remembered per file in Zukai's storage, the 300 MB cap, Open with default app)
- Modify: `PRODUCT.md` (the Capabilities Kinds line)
- Modify: `src/dev/preview.ts` only if it lists one fixture per Kind (add a PDF fixture tab)

- [ ] **Step 1: Update the docs** as above.
- [ ] **Step 2: Manual check** with `pnpm app`, opening a real multi-hundred-page PDF:
  - Scroll to about page 47 and zoom to 150%. Close the Tab and reopen the file → it lands on page 47 at 150%.
  - Quit and restart the app → the same.
  - Select a paragraph, press Mod+C, and paste into a Text Tab → the text arrives.
  - Mod+F with a word → you see the count and highlights. F3 and Shift+F3 move between matches.
  - Mod+G 300 Enter → you're on page 300.
  - Overwrite the file on disk with a shorter PDF → it reloads and lands on its last page.
  - Open a password-protected PDF → the notice shows, and "Open with default app" works.
  - Split two PDFs → keys only act in the focused half.
  - Then check `%APPDATA%/Zukai/pdf-positions.json` and confirm it has one entry per file.
- [ ] **Step 3: Run** `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `cd src-tauri && cargo test` → all green.
- [ ] **Step 4: Commit** `docs: PDF Kind`
