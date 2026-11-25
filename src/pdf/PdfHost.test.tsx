import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { TabState } from "../model/types";
import type { PdfPosition } from "./positions";
import { PdfHost, type PdfHostProps } from "./PdfHost";

// jsdom can't run pdf.js: a fake viewer stands in for it. It keeps the state
// PdfHost reads and writes, and the test fires its events.

type Listener = (e?: unknown) => void;

class FakeEventBus {
  private map = new Map<string, Set<Listener>>();
  on(name: string, fn: Listener) {
    if (!this.map.has(name)) this.map.set(name, new Set());
    this.map.get(name)!.add(fn);
  }
  off(name: string, fn: Listener) {
    this.map.get(name)?.delete(fn);
  }
  dispatch(name: string, e?: unknown) {
    for (const fn of [...(this.map.get(name) ?? [])]) fn(e);
  }
}

const PAGE_H = 1000;

class FakeViewer {
  static last: FakeViewer | null = null;
  static options: Record<string, unknown> | null = null;
  /** Set to make the next construction throw (as pdf.js may). */
  static throwOnCreate = false;
  container: HTMLDivElement;
  eventBus: FakeEventBus;
  pdfDocument: { numPages: number } | null = null;
  currentPageNumber = 1;
  private scale = 1;
  private value = "auto";
  private divs: HTMLDivElement[] = [];
  scrollPageIntoView = vi.fn((p: { pageNumber: number }) => {
    this.currentPageNumber = p.pageNumber;
  });
  updateScale = vi.fn();
  setDocument = vi.fn((doc: { numPages: number } | null) => {
    this.pdfDocument = doc;
    // pdf.js hands the document to its find controller, which resets.
    const fc = FakeViewer.options?.findController as
      FakeFindController | undefined;
    if (fc) fc.state = null;
    this.divs = Array.from({ length: doc?.numPages ?? 0 }, (_, i) => {
      const div = document.createElement("div");
      Object.defineProperty(div, "offsetTop", { value: i * PAGE_H });
      Object.defineProperty(div, "offsetHeight", { value: PAGE_H });
      return div;
    });
  });
  constructor(o: { container: HTMLDivElement; eventBus: FakeEventBus }) {
    if (FakeViewer.throwOnCreate) throw new TypeError("not a function");
    FakeViewer.options = o;
    this.container = o.container;
    this.eventBus = o.eventBus;
    FakeViewer.last = this;
  }
  get pagesCount() {
    return this.pdfDocument?.numPages ?? 0;
  }
  get currentScale() {
    return this.scale;
  }
  set currentScale(v: number) {
    this.scale = v;
    this.value = String(v);
    this.eventBus.dispatch("scalechanging", { scale: v });
  }
  get currentScaleValue() {
    return this.value;
  }
  set currentScaleValue(v: string) {
    this.value = v;
    // Page width follows the container's width (a 1000px-wide page).
    this.scale = v === "page-width" ? (width - 40) / 1000 : Number(v);
    this.eventBus.dispatch("scalechanging", { scale: this.scale });
  }
  getPageView(i: number) {
    const div = this.divs[i];
    if (!div) return undefined;
    return {
      div,
      viewport: {
        height: PAGE_H,
        // A 792pt-tall page: y grows downward on screen, upward in PDF units.
        convertToPdfPoint: (x: number, y: number) => [x, 792 - y * 0.792],
      },
    };
  }
}

class FakeLinkService {
  externalLinkEnabled = true;
  setViewer = vi.fn();
  setDocument = vi.fn();
}

class FakeFindController {
  static last: FakeFindController | null = null;
  options: { eventBus: FakeEventBus; linkService: FakeLinkService };
  /** The last search, as pdf.js keeps it; null until a find. */
  state: unknown = null;
  constructor(o: { eventBus: FakeEventBus; linkService: FakeLinkService }) {
    this.options = o;
    FakeFindController.last = this;
    o.eventBus.on("find", (e) => (this.state = e));
  }
}

/** jsdom has no ResizeObserver: `resize()` fires every observer. */
class FakeResizeObserver {
  static all = new Set<FakeResizeObserver>();
  constructor(private cb: () => void) {}
  observe() {
    FakeResizeObserver.all.add(this);
  }
  unobserve() {}
  disconnect() {
    FakeResizeObserver.all.delete(this);
  }
  fire() {
    this.cb();
  }
}
const resize = () =>
  act(() => {
    for (const o of [...FakeResizeObserver.all]) o.fire();
  });

const lib = {
  AnnotationMode: { ENABLE: 1 },
  AnnotationEditorType: { DISABLE: -1, NONE: 0 },
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(),
};

vi.mock("./pdfjs", () => ({
  loadPdfjs: () =>
    Promise.resolve({
      lib,
      viewer: {
        EventBus: FakeEventBus,
        PDFLinkService: FakeLinkService,
        PDFViewer: FakeViewer,
        PDFFindController: FakeFindController,
      },
    }),
  pdfAssetParams: () => ({}),
}));

const store = vi.hoisted(() => ({
  get: vi.fn<(path: string) => Promise<PdfPosition | undefined>>(),
  set: vi.fn(),
  flush: vi.fn(),
}));
vi.mock("./positions", () => ({ pdfPositions: store }));

type Props = PdfHostProps;

const PATH = "C:\\docs\\book.pdf";

function pdfTab(path = PATH): TabState {
  return {
    id: "pdf",
    kind: "pdf",
    title: "book.pdf",
    renamed: false,
    language: "plaintext",
    languagePicked: false,
    languageGuessed: true,
    selection: { anchor: 0, head: 0 },
    scrollTop: 0,
    wrap: false,
    file: {
      path,
      format: { encoding: "utf-8", bom: false, lineEnding: "lf", mixed: false },
      fingerprint: null,
      held: "readonly",
    },
  };
}

/** A Tab of its own: the find state is remembered per Tab id. */
const tabWithId = (id: string): TabState => ({ ...pdfTab(), id });

const docTask = (pages: number) => ({
  promise: Promise.resolve({ numPages: pages }),
  destroy: vi.fn(() => Promise.resolve()),
});

let height = 600;
let width = 800;
const original = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientHeight",
);
const originalWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientWidth",
);
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => height,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterAll(() => {
  if (original) {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", original);
  }
  if (originalWidth) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", originalWidth);
  }
  vi.unstubAllGlobals();
});

beforeEach(() => {
  height = 600;
  width = 800;
  FakeViewer.throwOnCreate = false;
  FakeViewer.last = null;
  store.get.mockReset();
  store.set.mockReset();
  store.get.mockResolvedValue(undefined);
  lib.getDocument.mockReset();
  lib.getDocument.mockImplementation(() => docTask(340));
});

async function setup(over: Partial<Props> = {}) {
  const props: Props = {
    tab: pdfTab(),
    readBytes: vi.fn(() => Promise.resolve(new Uint8Array(10).buffer)),
    reloadSeq: 0,
    onInfo: vi.fn(),
    onOpenDefault: vi.fn(),
    ...over,
  };
  const view = render(<PdfHost {...props} />);
  return { props, view };
}

/** The viewer with its document set (the load finished). */
async function loadedViewer(calls = 1): Promise<FakeViewer> {
  await waitFor(() =>
    expect(FakeViewer.last?.setDocument).toHaveBeenCalledTimes(calls),
  );
  return FakeViewer.last!;
}

/** Fires pagesinit and waits for the restore to finish. */
async function pagesInit(v: FakeViewer) {
  await act(async () => {
    v.eventBus.dispatch("pagesinit");
    await Promise.resolve();
  });
}

function scrollTo(v: FakeViewer, top: number) {
  Object.defineProperty(v.container, "scrollTop", {
    value: top,
    writable: true,
    configurable: true,
  });
  fireEvent.scroll(v.container);
}

const modKey = (key: string) =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

describe("PdfHost", () => {
  it("restores_stored_position", async () => {
    store.get.mockResolvedValue({
      page: 47,
      offsetInPage: 0.5,
      zoom: 1.5,
      updatedAt: 1,
    });
    const { props } = await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    expect(store.get).toHaveBeenCalledWith(PATH);
    expect(v.currentScale).toBe(1.5);
    expect(v.scrollPageIntoView).toHaveBeenCalledWith(
      expect.objectContaining({
        pageNumber: 47,
        destArray: [null, { name: "XYZ" }, null, 792 - 500 * 0.792, null],
      }),
    );
    expect(props.onInfo).toHaveBeenLastCalledWith({
      page: 47,
      pages: 340,
      zoom: 1.5,
      fitted: false,
      bytes: 10,
    });
  });

  it("clamps_page_past_end", async () => {
    store.get.mockResolvedValue({
      page: 400,
      offsetInPage: 0,
      zoom: "fit-width",
      updatedAt: 1,
    });
    await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    expect(v.scrollPageIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ pageNumber: 340 }),
    );
    expect(v.currentScaleValue).toBe("page-width");
  });

  it("viewer_is_read_only", async () => {
    await setup();
    await loadedViewer();
    // No annotation editor: it would take drops and keys for as long as a
    // PDF is open.
    expect(FakeViewer.options).toMatchObject({
      annotationEditorMode: -1,
      textLayerMode: 1,
      annotationMode: 1,
    });
  });

  it("default_is_fit_width", async () => {
    await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    expect(v.currentScaleValue).toBe("page-width");
  });

  it("does_not_save_before_restore", async () => {
    let resolve!: (p: PdfPosition | undefined) => void;
    store.get.mockReturnValue(new Promise((r) => (resolve = r)));
    await setup();
    const v = await loadedViewer();
    // Scrolled before pagesinit, and again while the store is still read.
    scrollTo(v, 3000);
    v.eventBus.dispatch("pagesinit");
    scrollTo(v, 4000);
    expect(store.set).not.toHaveBeenCalled();
    await act(async () => resolve(undefined));
  });

  it("does_not_save_when_hidden", async () => {
    const { view } = await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    height = 0;
    scrollTo(v, 3000);
    v.eventBus.dispatch("scalechanging");
    view.unmount();
    expect(store.set).not.toHaveBeenCalled();
  });

  it("saves_on_scroll", async () => {
    store.get.mockResolvedValue({
      page: 47,
      offsetInPage: 0,
      zoom: 1.5,
      updatedAt: 1,
    });
    await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    store.set.mockClear();
    scrollTo(v, 46 * PAGE_H + 500);
    expect(store.set).toHaveBeenLastCalledWith(PATH, {
      page: 47,
      offsetInPage: 0.5,
      zoom: 1.5,
    });
    // The page is the one at the top of the view, whatever the viewer's
    // "current" (most visible) page is.
    scrollTo(v, 47 * PAGE_H + 900);
    expect(store.set).toHaveBeenLastCalledWith(PATH, {
      page: 48,
      offsetInPage: 0.9,
      zoom: 1.5,
    });
  });

  it("saves_once_more_on_unmount", async () => {
    const { view } = await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    Object.defineProperty(v.container, "scrollTop", {
      value: 2 * PAGE_H + 250,
      configurable: true,
    });
    store.set.mockClear();
    view.unmount();
    expect(store.set).toHaveBeenCalledWith(PATH, {
      page: 3,
      offsetInPage: 0.25,
      zoom: "fit-width",
    });
  });

  it("reload_keeps_position", async () => {
    store.get.mockResolvedValue({
      page: 10,
      offsetInPage: 0,
      zoom: 2,
      updatedAt: 1,
    });
    const { props, view } = await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    scrollTo(v, 46 * PAGE_H + 500);
    lib.getDocument.mockImplementation(() => docTask(340));
    view.rerender(<PdfHost {...props} reloadSeq={1} />);
    const v2 = await loadedViewer(3); // the old document unset, the new set
    v2.scrollPageIntoView.mockClear();
    await pagesInit(v2);
    expect(store.get).toHaveBeenCalledTimes(1);
    expect(v2.currentScale).toBe(2);
    expect(v2.scrollPageIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ pageNumber: 47 }),
    );
  });

  it("keys_zoom_when_focused", async () => {
    store.get.mockResolvedValue({
      page: 1,
      offsetInPage: 0,
      zoom: 1.6,
      updatedAt: 1,
    });
    await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    modKey("=");
    expect(v.currentScale).toBeCloseTo(2);
    modKey("-");
    expect(v.currentScale).toBeCloseTo(1.6);
    modKey("0");
    expect(v.currentScaleValue).toBe("page-width");
  });

  it("keys_only_when_focused", async () => {
    store.get.mockResolvedValue({
      page: 1,
      offsetInPage: 0,
      zoom: 1.5,
      updatedAt: 1,
    });
    await setup({ keys: false });
    const v = await loadedViewer();
    await pagesInit(v);
    modKey("=");
    expect(v.currentScale).toBe(1.5);
  });

  it("mod_wheel_zooms_toward_pointer", async () => {
    await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    // The viewer sits right of the sidebar and below the tab bar; pdf.js
    // wants the pointer relative to the container.
    v.container.getBoundingClientRect = () =>
      new DOMRect(200, 100, width, height);
    const wheel = new WheelEvent("wheel", {
      deltaY: -100,
      ctrlKey: true,
      clientX: 230,
      clientY: 140,
      cancelable: true,
    });
    act(() => {
      v.container.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(true);
    expect(v.updateScale).toHaveBeenCalledWith(
      expect.objectContaining({ origin: [30, 40] }),
    );
    expect(v.updateScale.mock.calls[0][0].scaleFactor).toBeCloseTo(1.1);
  });

  it("go_to_page", async () => {
    const { props, view } = await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    view.rerender(<PdfHost {...props} goToPage={{ page: 999, seq: 1 }} />);
    expect(v.currentPageNumber).toBe(340);
  });

  it("zoom_request_steps_sets_and_fits", async () => {
    const { props, view } = await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    // 800px wide: fitted to 0.76.
    expect(props.onInfo).toHaveBeenLastCalledWith(
      expect.objectContaining({ zoom: 0.76, fitted: true }),
    );
    view.rerender(<PdfHost {...props} zoomRequest={{ zoom: "in", seq: 1 }} />);
    expect(v.currentScale).toBeCloseTo(0.95);
    expect(props.onInfo).toHaveBeenLastCalledWith(
      expect.objectContaining({ fitted: false }),
    );
    view.rerender(<PdfHost {...props} zoomRequest={{ zoom: "out", seq: 2 }} />);
    expect(v.currentScale).toBeCloseTo(0.76);
    view.rerender(<PdfHost {...props} zoomRequest={{ zoom: 9, seq: 3 }} />);
    expect(v.currentScale).toBe(5);
    view.rerender(<PdfHost {...props} zoomRequest={{ zoom: 0.5, seq: 4 }} />);
    expect(v.currentScale).toBe(0.5);
    view.rerender(<PdfHost {...props} zoomRequest={{ zoom: "fit", seq: 5 }} />);
    expect(v.currentScaleValue).toBe("page-width");
    expect(props.onInfo).toHaveBeenLastCalledWith(
      expect.objectContaining({ zoom: 0.76, fitted: true }),
    );
  });

  it("zoom_request_to_the_same_scale_reports_not_fitted", async () => {
    width = 1040; // fitted to exactly 100%
    const { props, view } = await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    expect(props.onInfo).toHaveBeenLastCalledWith(
      expect.objectContaining({ zoom: 1, fitted: true }),
    );
    view.rerender(<PdfHost {...props} zoomRequest={{ zoom: 1, seq: 1 }} />);
    expect(props.onInfo).toHaveBeenLastCalledWith(
      expect.objectContaining({ zoom: 1, fitted: false }),
    );
  });

  it("zoom_request_not_replayed_on_remount", async () => {
    // A Tab shown again mounts with the last request it was given.
    await setup({ zoomRequest: { zoom: 3, seq: 7 } });
    const v = await loadedViewer();
    await pagesInit(v);
    expect(v.currentScaleValue).toBe("page-width");
    expect(v.currentScale).toBeCloseTo(0.76);
  });

  it("go_to_page_not_replayed_on_remount", async () => {
    await setup({ goToPage: { page: 99, seq: 3 } });
    const v = await loadedViewer();
    await pagesInit(v);
    expect(v.currentPageNumber).toBe(1);
  });

  it("find_request_opens_bar", async () => {
    const { props, view } = await setup({ tab: tabWithId("open") });
    const v = await loadedViewer();
    await pagesInit(v);
    // pdf.js's find controller, on the viewer's bus and link service.
    const fc = FakeFindController.last!;
    expect(FakeViewer.options?.findController).toBe(fc);
    expect(fc.options.eventBus).toBe(v.eventBus);
    expect(screen.queryByRole("search")).toBeNull();
    const finds = vi.fn();
    v.eventBus.on("find", finds);
    view.rerender(
      <PdfHost {...props} findRequest={{ mode: "find", seq: 1 }} />,
    );
    const input = screen.getByRole("textbox", { name: "Find" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "spec" } });
    expect(finds).toHaveBeenLastCalledWith({
      source: null,
      type: "",
      query: "spec",
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: false,
      matchDiacritics: false,
    });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(finds).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "again", findPrevious: true }),
    );
    // Mod+F again while open: back to the same field, its text kept.
    act(() => v.container.focus());
    view.rerender(
      <PdfHost {...props} findRequest={{ mode: "find", seq: 2 }} />,
    );
    expect(screen.getByRole("textbox", { name: "Find" })).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("spec");
  });

  it("find_shows_match_count", async () => {
    const { props, view } = await setup({ tab: tabWithId("count") });
    const v = await loadedViewer();
    await pagesInit(v);
    view.rerender(
      <PdfHost {...props} findRequest={{ mode: "find", seq: 1 }} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), {
      target: { value: "spec" },
    });
    act(() =>
      v.eventBus.dispatch("updatefindcontrolstate", {
        state: 0,
        matchesCount: { current: 1, total: 41 },
      }),
    );
    expect(screen.getByText("1 of 41")).toBeInTheDocument();
    act(() =>
      v.eventBus.dispatch("updatefindmatchescount", {
        matchesCount: { current: 3, total: 41 },
      }),
    );
    expect(screen.getByText("3 of 41")).toBeInTheDocument();
  });

  it("find_escape_closes_and_focuses_viewer", async () => {
    const { props, view } = await setup({ tab: tabWithId("esc") });
    const v = await loadedViewer();
    await pagesInit(v);
    const closes = vi.fn();
    v.eventBus.on("findbarclose", closes);
    view.rerender(
      <PdfHost {...props} findRequest={{ mode: "find", seq: 1 }} />,
    );
    const input = screen.getByRole("textbox", { name: "Find" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    expect(closes).toHaveBeenCalledWith({ source: null });
    expect(v.container).toHaveFocus();
  });

  it("find_input_keeps_page_keys", async () => {
    const { props, view } = await setup({ tab: tabWithId("keys") });
    const v = await loadedViewer();
    await pagesInit(v);
    view.rerender(
      <PdfHost {...props} findRequest={{ mode: "find", seq: 1 }} />,
    );
    const input = screen.getByRole("textbox", { name: "Find" });
    const end = new KeyboardEvent("keydown", {
      key: "End",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(end);
    });
    expect(end.defaultPrevented).toBe(false);
    expect(v.currentPageNumber).toBe(1);
  });

  it("find_state_is_remembered_per_tab", async () => {
    const { props, view } = await setup({ tab: tabWithId("mem") });
    const v = await loadedViewer();
    await pagesInit(v);
    view.rerender(
      <PdfHost {...props} findRequest={{ mode: "find", seq: 1 }} />,
    );
    const input = screen.getByRole("textbox", { name: "Find" });
    fireEvent.change(input, { target: { value: "spec" } });
    fireEvent.keyDown(input, { key: "Escape" });
    // Shown again later (the Tab was switched away and back).
    view.unmount();
    const again = render(
      <PdfHost {...props} findRequest={{ mode: "find", seq: 1 }} />,
    );
    const v2 = await loadedViewer();
    await pagesInit(v2);
    expect(screen.queryByRole("search")).toBeNull(); // never replayed
    again.rerender(
      <PdfHost {...props} findRequest={{ mode: "find", seq: 2 }} />,
    );
    expect(screen.getByRole("textbox", { name: "Find" })).toHaveValue("spec");
    // Another Tab starts empty.
    again.unmount();
    const other = tabWithId("other");
    const third = render(
      <PdfHost {...props} tab={other} findRequest={{ mode: "find", seq: 2 }} />,
    );
    await pagesInit(await loadedViewer());
    expect(screen.queryByRole("search")).toBeNull();
    third.rerender(
      <PdfHost {...props} tab={other} findRequest={{ mode: "find", seq: 3 }} />,
    );
    expect(screen.getByRole("textbox", { name: "Find" })).toHaveValue("");
  });

  it("find_reopen_shows_last_highlights", async () => {
    const { props, view } = await setup({ tab: tabWithId("hl") });
    const v = await loadedViewer();
    await pagesInit(v);
    const finds = vi.fn();
    v.eventBus.on("find", finds);
    view.rerender(
      <PdfHost {...props} findRequest={{ mode: "find", seq: 1 }} />,
    );
    const input = screen.getByRole("textbox", { name: "Find" });
    fireEvent.change(input, { target: { value: "spec" } });
    fireEvent.keyDown(input, { key: "Escape" });
    finds.mockClear();
    view.rerender(
      <PdfHost {...props} findRequest={{ mode: "find", seq: 2 }} />,
    );
    // Highlights back on, without moving to another match.
    expect(finds).toHaveBeenCalledTimes(1);
    expect(finds).toHaveBeenCalledWith(
      expect.objectContaining({ type: "highlightallchange", query: "spec" }),
    );
    expect(screen.getByRole("textbox", { name: "Find" })).toHaveValue("spec");
  });

  it("find_reopen_on_fresh_viewer_does_not_move", async () => {
    // A search made earlier in this Tab, before it was switched away.
    const { props, view } = await setup({ tab: tabWithId("fresh") });
    const v = await loadedViewer();
    await pagesInit(v);
    view.rerender(
      <PdfHost {...props} findRequest={{ mode: "find", seq: 1 }} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), {
      target: { value: "spec" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find" }), {
      key: "Escape",
    });
    view.unmount();
    // Shown again: a new viewer, whose find controller has no search. A
    // highlight request there would go to the first match and save it.
    const again = render(<PdfHost {...props} />);
    const v2 = await loadedViewer();
    await pagesInit(v2);
    const finds = vi.fn();
    v2.eventBus.on("find", finds);
    again.rerender(
      <PdfHost {...props} findRequest={{ mode: "find", seq: 2 }} />,
    );
    expect(screen.getByRole("textbox", { name: "Find" })).toHaveValue("spec");
    expect(finds).not.toHaveBeenCalled();
  });

  it("refits_width_on_resize", async () => {
    await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    expect(v.currentScale).toBeCloseTo(0.76);
    scrollTo(v, 2 * PAGE_H + 250);
    v.scrollPageIntoView.mockClear();
    width = 540; // a Split, or the sidebar opened
    resize();
    expect(v.currentScaleValue).toBe("page-width");
    expect(v.currentScale).toBeCloseTo(0.5);
    // The same place, on the same page.
    expect(v.scrollPageIntoView).toHaveBeenCalledWith(
      expect.objectContaining({
        pageNumber: 3,
        destArray: [null, { name: "XYZ" }, null, 792 - 250 * 0.792, null],
      }),
    );
    // Too narrow to fit: pdf.js would compute a negative scale.
    width = 30;
    resize();
    expect(v.currentScale).toBeCloseTo(0.5);
  });

  it("default_fit_never_passes_200_percent", async () => {
    width = 3040; // a wide window: page width alone would be 300%
    await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    expect(v.currentScale).toBeCloseTo(2);
    // Still the fitted zoom, not a zoom the user chose.
    store.set.mockClear();
    scrollTo(v, 250);
    expect(store.set).toHaveBeenLastCalledWith(
      PATH,
      expect.objectContaining({ zoom: "fit-width" }),
    );
  });

  it("capped_fit_follows_resizes", async () => {
    width = 3040;
    await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    width = 540;
    resize();
    expect(v.currentScale).toBeCloseTo(0.5);
    width = 3040;
    resize();
    expect(v.currentScale).toBeCloseTo(2);
  });

  it("mod_0_fits_with_the_cap", async () => {
    store.get.mockResolvedValue({
      page: 1,
      offsetInPage: 0,
      zoom: 1.6,
      updatedAt: 1,
    });
    width = 3040;
    await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    modKey("0");
    expect(v.currentScale).toBeCloseTo(2);
  });

  it("keeps_set_zoom_on_resize", async () => {
    store.get.mockResolvedValue({
      page: 1,
      offsetInPage: 0,
      zoom: 1.5,
      updatedAt: 1,
    });
    await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    width = 540;
    resize();
    expect(v.currentScale).toBe(1.5);
  });

  it("defers_restore_until_sized", async () => {
    store.get.mockResolvedValue({
      page: 47,
      offsetInPage: 0.5,
      zoom: 1.5,
      updatedAt: 1,
    });
    height = 0; // laid out hidden
    const { props } = await setup();
    const v = await loadedViewer();
    await pagesInit(v);
    expect(v.scrollPageIntoView).not.toHaveBeenCalled();
    // Sized, before the restore: nothing is saved over the stored place.
    height = 600;
    scrollTo(v, 0);
    v.eventBus.dispatch("scalechanging");
    expect(store.set).not.toHaveBeenCalled();
    resize();
    expect(v.currentScale).toBe(1.5);
    expect(v.scrollPageIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ pageNumber: 47 }),
    );
    expect(props.onInfo).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 47, zoom: 1.5 }),
    );
    scrollTo(v, 46 * PAGE_H + 500);
    expect(store.set).toHaveBeenLastCalledWith(PATH, {
      page: 47,
      offsetInPage: 0.5,
      zoom: 1.5,
    });
  });

  it("tears_down_viewer_on_unmount", async () => {
    const { view } = await setup();
    await loadedViewer();
    const signal = FakeViewer.options?.abortSignal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it("viewer_setup_failure_notice", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    FakeViewer.throwOnCreate = true;
    await setup();
    expect(
      await screen.findByText("This file can't be shown as a PDF."),
    ).toBeInTheDocument();
    error.mockRestore();
  });

  it("password_notice", async () => {
    lib.getDocument.mockImplementation(() => ({
      promise: Promise.reject({ name: "PasswordException" }),
      destroy: vi.fn(() => Promise.resolve()),
    }));
    const { props } = await setup();
    expect(
      await screen.findByText("This PDF is password-protected."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open with default app" }),
    );
    expect(props.onOpenDefault).toHaveBeenCalled();
    expect(props.onInfo).toHaveBeenLastCalledWith(null);
  });

  it("invalid_notice", async () => {
    lib.getDocument.mockImplementation(() => ({
      promise: Promise.reject({ name: "InvalidPDFException" }),
      destroy: vi.fn(() => Promise.resolve()),
    }));
    await setup();
    expect(
      await screen.findByText("This file can't be shown as a PDF."),
    ).toBeInTheDocument();
  });

  it("too_large_notice", async () => {
    await setup({
      readBytes: vi.fn(() =>
        Promise.reject({ kind: "too_large", message: "too large" }),
      ),
    });
    expect(
      await screen.findByText("Too large to show in Zukai."),
    ).toBeInTheDocument();
  });
});
