import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import type { TabState } from "../model/types";
import type { CanvasHostProps } from "./CanvasHost";

interface FakeApi {
  updateScene: ReturnType<typeof vi.fn>;
  addFiles: ReturnType<typeof vi.fn>;
  history: { clear: ReturnType<typeof vi.fn> };
  getAppState(): object;
  getSceneElementsIncludingDeleted(): unknown[];
}
type El = { id: string; version: number; isDeleted?: boolean };
type OnChange = (
  elements: El[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
) => void;

/** What the fake Excalidraw saw: its latest props and its API. */
const fx = vi.hoisted(() => ({
  imported: vi.fn(),
  keydown: vi.fn(),
  props: null as null | Record<string, unknown>,
  api: null as null | FakeApi,
}));

vi.mock("@excalidraw/excalidraw", async () => {
  fx.imported();
  const React = await import("react");
  function Excalidraw(props: Record<string, unknown>) {
    fx.props = props;
    React.useEffect(() => {
      const api: FakeApi = {
        updateScene: vi.fn(),
        addFiles: vi.fn(),
        history: { clear: vi.fn() },
        getAppState: () => ({}),
        getSceneElementsIncludingDeleted: () => [],
      };
      fx.api = api;
      (props.excalidrawAPI as (a: FakeApi) => void)(api);
      // Once, on mount, like the real one.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="excalidraw" tabIndex={0} onKeyDown={fx.keydown}>
        {props.children as ReactNode}
      </div>
    );
  }
  const Item = () => null;
  const MainMenu = Object.assign(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
    {
      Separator: Item,
      DefaultItems: {
        Export: Item,
        SaveAsImage: Item,
        SearchMenu: Item,
        Help: Item,
        ClearCanvas: Item,
        ChangeCanvasBackground: Item,
      },
    },
  );
  return {
    Excalidraw,
    MainMenu,
    CaptureUpdateAction: { NEVER: "NEVER" },
    restoreElements: (elements: El[]) => elements,
    restoreAppState: (appState: object, local: object) => ({
      ...local,
      ...appState,
    }),
    // Like the real one, only these appState keys are exported ("local").
    serializeAsJSON: (
      elements: El[],
      appState: Record<string, unknown>,
      files: object,
      type: string,
    ) =>
      JSON.stringify({
        type: "excalidraw",
        source: type,
        elements,
        appState: Object.fromEntries(
          Object.entries(appState).filter(([k]) =>
            [
              "gridSize",
              "gridStep",
              "gridModeEnabled",
              "viewBackgroundColor",
            ].includes(k),
          ),
        ),
        files,
      }),
  };
});
vi.mock("@excalidraw/excalidraw/index.css", () => ({}));

function tab(id: string, over: Partial<TabState> = {}): TabState {
  return {
    id,
    kind: "canvas",
    title: id,
    renamed: false,
    language: "plaintext",
    languagePicked: false,
    languageGuessed: false,
    selection: { anchor: 0, head: 0 },
    scrollTop: 0,
    wrap: false,
    ...over,
  };
}

const scene = (...elements: El[]) =>
  JSON.stringify({ type: "excalidraw", version: 2, elements, appState: {} });
const A1 = { id: "a", version: 1 };

async function setup(over: Partial<CanvasHostProps> = {}) {
  const { CanvasHost } = await import("./CanvasHost");
  const props: CanvasHostProps = {
    tabs: [tab("c")],
    activeId: "c",
    loadContent: () => Promise.resolve(scene(A1)),
    onChange: vi.fn(),
    onTabPatch: vi.fn(),
    replaceRequests: [],
    isReadOnly: () => false,
    theme: "light",
    onShortcut: vi.fn(),
    ...over,
  };
  const r = render(<CanvasHost {...props} />);
  const rerender = (next: Partial<CanvasHostProps>) => {
    Object.assign(props, next);
    r.rerender(<CanvasHost {...props} />);
  };
  return { ...r, props, rerender };
}

/** The fake Excalidraw is mounted and has handed over its API. */
async function mounted() {
  await screen.findByTestId("excalidraw");
  await waitFor(() => expect(fx.api).not.toBeNull());
  return {
    api: fx.api!,
    change: (...args: Parameters<OnChange>) =>
      act(() => (fx.props!.onChange as OnChange)(...args)),
  };
}

beforeEach(() => {
  fx.props = null;
  fx.api = null;
  fx.keydown.mockClear();
});

describe("CanvasHost", () => {
  it("excalidrawNotImportedForTextOnlySession", async () => {
    // A fresh module graph, so nothing earlier has loaded Excalidraw.
    vi.resetModules();
    fx.imported.mockClear();
    const text = tab("t", { kind: "text" });
    const { rerender } = await setup({ tabs: [text], activeId: "t" });
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(fx.imported).not.toHaveBeenCalled();
    expect(screen.queryByTestId("excalidraw")).toBeNull();
    // The first canvas Tab loads it.
    rerender({ tabs: [text, tab("c")], activeId: "c" });
    await mounted();
    expect(fx.imported).toHaveBeenCalledTimes(1);
  });

  it("viewportChangesDoNotSave", async () => {
    const { props } = await setup();
    const { change } = await mounted();
    change([A1], { scrollX: 40, scrollY: -8, zoom: { value: 2 } }, {});
    change(
      [A1],
      {
        scrollX: 40,
        scrollY: -8,
        zoom: { value: 2 },
        selectedElementIds: { a: true },
      },
      {},
    );
    expect(props.onChange).not.toHaveBeenCalled();
    // The viewport is remembered in the Tab instead (debounced).
    await waitFor(() =>
      expect(props.onTabPatch).toHaveBeenCalledWith("c", {
        viewport: { scrollX: 40, scrollY: -8, zoom: 2 },
      }),
    );
    expect(props.onTabPatch).toHaveBeenCalledTimes(1);
  });

  it("elementChangeSavesSerializedJson", async () => {
    const { props } = await setup();
    const { change } = await mounted();
    const moved = [{ id: "a", version: 2 }];
    change(moved, {}, {});
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith(
      "c",
      JSON.stringify({
        type: "excalidraw",
        source: "local",
        elements: moved,
        appState: {},
        files: {},
      }),
    );
    // The same drawing again (a re-render, a pointer move): no new save.
    change([{ id: "a", version: 2 }], { scrollX: 1 }, {});
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it("backgroundChangeAloneSaves", async () => {
    const { props } = await setup();
    const { change } = await mounted();
    change([A1], { viewBackgroundColor: "#1e1e1e", scrollX: 3 }, {});
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse((props.onChange as ReturnType<typeof vi.fn>).mock.calls[0][1])
        .appState,
    ).toEqual({ viewBackgroundColor: "#1e1e1e" });
    // The same background again (with a scroll): no new save.
    change([A1], { viewBackgroundColor: "#1e1e1e", scrollX: 9 }, {});
    expect(props.onChange).toHaveBeenCalledTimes(1);
  });

  it("restores the remembered viewport and follows the theme live", async () => {
    const viewport = { scrollX: 5, scrollY: 6, zoom: 1.5 };
    const { rerender } = await setup({ tabs: [tab("c", { viewport })] });
    await mounted();
    const initial = fx.props!.initialData as { appState: object };
    expect(initial.appState).toMatchObject({
      scrollX: 5,
      scrollY: 6,
      zoom: { value: 1.5 },
    });
    expect(fx.props!.theme).toBe("light");
    expect(fx.props!.isCollaborating).toBe(false);
    rerender({ theme: "dark" });
    expect(fx.props!.theme).toBe("dark");
  });

  it("excalidrawHandlesKeysLocally", async () => {
    await setup();
    await mounted();
    expect(fx.props!.handleKeyboardGlobally).toBe(false);
  });

  it("a read-only canvas shows the drawing and never saves", async () => {
    const { props } = await setup({ isReadOnly: () => true });
    const { change } = await mounted();
    expect(fx.props!.viewModeEnabled).toBe(true);
    change([{ id: "a", version: 5 }], {}, {});
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("invalidCanvasOpensReadOnlyWithBar", async () => {
    const { props } = await setup({
      loadContent: () => Promise.resolve("{ not a drawing"),
    });
    expect(
      await screen.findByText(
        "This file isn't a valid Excalidraw drawing, so it's open read-only to protect it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("excalidraw")).toBeNull();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("replaceRequestUpdatesSceneOnce", async () => {
    const { props, rerender } = await setup();
    const { api, change } = await mounted();
    const b = { id: "b", version: 3 };
    const replaceRequests = [{ seq: 1, id: "c", text: scene(b) }];
    rerender({ replaceRequests });
    expect(api.updateScene).toHaveBeenCalledTimes(1);
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ elements: [b], captureUpdate: "NEVER" }),
    );
    expect(api.history.clear).toHaveBeenCalledTimes(1);
    // Applied once, whatever re-renders follow.
    rerender({ theme: "dark" });
    rerender({ replaceRequests: [...replaceRequests] });
    expect(api.updateScene).toHaveBeenCalledTimes(1);
    expect(api.history.clear).toHaveBeenCalledTimes(1);
    // Excalidraw reporting the replaced scene back is not an edit.
    change([b], {}, {});
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("a replace with an invalid drawing turns the canvas read-only", async () => {
    const { rerender } = await setup();
    await mounted();
    rerender({ replaceRequests: [{ seq: 1, id: "c", text: "garbage" }] });
    expect(
      await screen.findByText(/isn't a valid Excalidraw drawing/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("excalidraw")).toBeNull();
  });

  it("modShiftEGoesToAppNotExcalidraw", async () => {
    const { props } = await setup();
    await mounted();
    const canvas = screen.getByTestId("excalidraw");
    canvas.focus();
    fireEvent.keyDown(canvas, {
      key: "E",
      code: "KeyE",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(props.onShortcut).toHaveBeenCalledWith({ type: "focusSidebar" });
    expect(fx.keydown).not.toHaveBeenCalled();
    // Excalidraw's own keys still reach it.
    fireEvent.keyDown(canvas, { key: "r", code: "KeyR" });
    expect(fx.keydown).toHaveBeenCalledTimes(1);
    expect(props.onShortcut).toHaveBeenCalledTimes(1);
    // So do the text editor's commands (find, wrap, format): Excalidraw's
    // Ctrl+F is its search.
    fireEvent.keyDown(canvas, { key: "f", code: "KeyF", ctrlKey: true });
    fireEvent.keyDown(canvas, { key: "z", code: "KeyZ", altKey: true });
    fireEvent.keyDown(canvas, {
      key: "F",
      code: "KeyF",
      altKey: true,
      shiftKey: true,
    });
    expect(fx.keydown).toHaveBeenCalledTimes(4);
    expect(props.onShortcut).toHaveBeenCalledTimes(1);
    // Zoom keys are Excalidraw's own zoom on a canvas.
    fireEvent.keyDown(canvas, { key: "=", code: "Equal", ctrlKey: true });
    fireEvent.keyDown(canvas, { key: "-", code: "Minus", ctrlKey: true });
    fireEvent.keyDown(canvas, { key: "0", code: "Digit0", ctrlKey: true });
    expect(fx.keydown).toHaveBeenCalledTimes(7);
    expect(props.onShortcut).toHaveBeenCalledTimes(1);
  });
});
