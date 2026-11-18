import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { TabState } from "../model/types";
import { ImageHost, type ImageHostProps } from "./ImageHost";

function imageTab(path = "C:\\p\\pic.png"): TabState {
  return {
    id: "img",
    kind: "image",
    title: "pic.png",
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

const bytes = (n: number) => new Uint8Array(n).buffer;

let urls = 0;
const created = vi.fn<(b: Blob) => string>(() => `blob:zukai/${++urls}`);
const revoked = vi.fn<(url: string) => void>();
const original = {
  create: URL.createObjectURL,
  revoke: URL.revokeObjectURL,
  width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  height: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  ),
};

beforeAll(() => {
  URL.createObjectURL = created;
  URL.revokeObjectURL = revoked;
  // The viewport is 400 x 300 (jsdom has no layout).
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 400,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 300,
  });
});

afterAll(() => {
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
  if (original.width) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", original.width);
  }
  if (original.height) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientHeight",
      original.height,
    );
  }
});

beforeEach(() => {
  urls = 0;
  created.mockClear();
  revoked.mockClear();
});
afterEach(() => vi.restoreAllMocks());

async function setup(over: Partial<ImageHostProps> = {}) {
  const props: ImageHostProps = {
    tab: imageTab(),
    readBytes: vi.fn(() => Promise.resolve(bytes(10))),
    reloadSeq: 0,
    onInfo: vi.fn(),
    ...over,
  };
  const view = render(<ImageHost {...props} />);
  const img = await screen.findByRole("img");
  return { props, view, img };
}

/** jsdom never decodes images: give it a size, then fire load. */
function loaded(img: HTMLElement, width: number, height: number) {
  Object.defineProperty(img, "naturalWidth", { value: width });
  Object.defineProperty(img, "naturalHeight", { value: height });
  fireEvent.load(img);
}

const viewport = () =>
  document.querySelector<HTMLElement>("[data-image-viewport]")!;
const num = (attr: string) => Number(viewport().getAttribute(attr));
const key = (k: string, code: string) =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: k,
        code,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

describe("ImageHost", () => {
  it("imageFitsAndZooms", async () => {
    const { props, img } = await setup();
    loaded(img, 800, 600);
    // Fits the 400 x 300 viewport, centered.
    expect(viewport()).toHaveAttribute("data-fit", "true");
    expect(num("data-zoom")).toBeCloseTo(0.5);
    expect(num("data-x")).toBeCloseTo(0);
    expect(props.onInfo).toHaveBeenLastCalledWith({
      width: 800,
      height: 600,
      format: "PNG",
      bytes: 10,
    });

    key("=", "Equal");
    expect(viewport()).toHaveAttribute("data-fit", "false");
    expect(num("data-zoom")).toBeCloseTo(0.625);
    key("-", "Minus");
    expect(num("data-zoom")).toBeCloseTo(0.5);
    key("-", "Minus");
    expect(num("data-zoom")).toBeCloseTo(0.4);
    key("0", "Digit0");
    expect(viewport()).toHaveAttribute("data-fit", "true");
    expect(num("data-zoom")).toBeCloseTo(0.5);

    // Mod+wheel zooms toward the cursor: the point under it stays put.
    act(() => {
      viewport().dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -100,
          clientX: 100,
          clientY: 100,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const z = num("data-zoom");
    expect(z).toBeGreaterThan(0.5);
    expect(num("data-x")).toBeCloseTo(100 - (100 * z) / 0.5);
    expect(num("data-y")).toBeCloseTo(100 - (100 * z) / 0.5);

    // Dragging pans.
    const [x, y] = [num("data-x"), num("data-y")];
    fireEvent.mouseDown(viewport(), { button: 0, clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 70, clientY: 80 });
    fireEvent.mouseUp(window, { clientX: 70, clientY: 80 });
    expect(num("data-x")).toBeCloseTo(x + 20);
    expect(num("data-y")).toBeCloseTo(y + 30);
    expect(num("data-zoom")).toBeCloseTo(z);
  });

  it("svgRenderedAsImgNeverInline", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const { view, img } = await setup({
      tab: imageTab("C:\\p\\logo.SVG"),
      readBytes: () => Promise.resolve(svg.buffer as ArrayBuffer),
    });
    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0][0].type).toBe("image/svg+xml");
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toMatch(/^blob:/);
    expect(view.container.querySelector("svg, script, object, iframe")).toBe(
      null,
    );
  });

  it("blobUrlRevokedOnUnmount", async () => {
    const { view, img } = await setup();
    const url = img.getAttribute("src")!;
    expect(revoked).not.toHaveBeenCalled();
    view.unmount();
    expect(revoked).toHaveBeenCalledWith(url);

    // Bytes that arrive after unmount never make a URL.
    let resolve!: (b: ArrayBuffer) => void;
    const late = render(
      <ImageHost
        tab={imageTab()}
        readBytes={() => new Promise((r) => (resolve = r))}
        reloadSeq={0}
      />,
    );
    late.unmount();
    created.mockClear();
    await act(async () => resolve(bytes(3)));
    expect(created).not.toHaveBeenCalled();
  });

  it("reloadOnSeqChange", async () => {
    const readBytes = vi.fn(() => Promise.resolve(bytes(10)));
    const { props, view, img } = await setup({ readBytes });
    loaded(img, 800, 600);
    key("=", "Equal");
    const first = img.getAttribute("src")!;
    expect(readBytes).toHaveBeenCalledTimes(1);

    view.rerender(<ImageHost {...props} reloadSeq={1} />);
    await vi.waitFor(() =>
      expect(screen.getByRole("img").getAttribute("src")).not.toBe(first),
    );
    expect(readBytes).toHaveBeenCalledTimes(2);
    expect(readBytes).toHaveBeenLastCalledWith("C:\\p\\pic.png");
    expect(revoked).toHaveBeenCalledWith(first);
    // The zoom is kept across a reload.
    expect(num("data-zoom")).toBeCloseTo(0.625);
  });

  it("a small image shows at 100% when fitted", async () => {
    const { img } = await setup();
    loaded(img, 40, 30);
    expect(num("data-zoom")).toBe(1);
    expect(num("data-x")).toBe(180);
    expect(num("data-y")).toBe(135);
  });

  it("an unreadable file shows a message instead", async () => {
    render(
      <ImageHost
        tab={imageTab()}
        readBytes={() => Promise.reject(new Error("gone"))}
        reloadSeq={0}
      />,
    );
    expect(
      await screen.findByText("This image can't be shown."),
    ).toBeInTheDocument();
  });
});
