import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { TextBridge } from "../editor/EditorHost";
import RichEditor, { useRich, type RichEditorProps } from "./RichEditor";

const hook = vi.hoisted(() => ({
  /** Runs as the editor is being built (after its last text check). */
  building: null as null | (() => void),
}));

vi.mock("./richMarkdown", async (orig) => {
  const m = await orig<typeof import("./richMarkdown")>();
  return {
    ...m,
    richPlugins: () => {
      hook.building?.();
      return m.richPlugins();
    },
  };
});

/** A TextBridge over plain strings, with a way to change a text "outside". */
function fakeBridge(texts: Record<string, string>) {
  const listeners = new Map<string, Set<(text: string) => void>>();
  const bridge = {
    text: (id: string) => texts[id] ?? null,
    replace: vi.fn((id: string, text: string) => {
      texts[id] = text;
    }),
    onOutsideChange: (id: string, cb: (text: string) => void) => {
      const set = listeners.get(id) ?? new Set();
      listeners.set(id, set);
      set.add(cb);
      return () => set.delete(cb);
    },
    clearHistory: vi.fn(),
    hidden: () => [],
    readOnly: () => false,
    ready: async () => {},
    /** A reload, or anything else not written by the rich editor. */
    outside(id: string, text: string) {
      texts[id] = text;
      for (const cb of listeners.get(id) ?? []) cb(text);
    },
  };
  return bridge satisfies TextBridge;
}

/** Hands the test each editor's ProseMirror view, by Tab id. */
const views = new Map<string, EditorView>();
function Grab({ id }: { id: string }) {
  const rich = useRich();
  if (rich) views.set(id, rich.view);
  return null;
}

function mount(
  bridge: TextBridge,
  over: Partial<RichEditorProps> = {},
  id = "a",
) {
  const props: RichEditorProps = {
    id,
    bridge,
    readOnly: false,
    focused: true,
    fontSize: 14,
    onOpenLink: vi.fn(),
    onFallback: vi.fn(),
    ...over,
  };
  const r = render(
    <RichEditor {...props}>
      <Grab id={id} />
      {over.children}
    </RichEditor>,
  );
  return { ...r, props };
}

async function viewOf(id = "a"): Promise<EditorView> {
  const view = await waitFor(() => {
    const v = views.get(id);
    expect(v).toBeDefined();
    return v!;
  });
  // The view is seen while rendering: let its effects (wheel, focus) run.
  await act(async () => {});
  return view;
}

const settle = () => new Promise((r) => setTimeout(r, 450));

describe("RichEditor", () => {
  beforeEach(() => {
    views.clear();
    hook.building = null;
  });

  it("opening_does_not_write", async () => {
    const bridge = fakeBridge({ a: "# Hi\n\n* a\n" });
    const r = mount(bridge);
    await viewOf();
    await waitFor(() => expect(r.container.textContent).toContain("Hi"));
    await act(settle);
    r.unmount();
    expect(bridge.replace).not.toHaveBeenCalled();
  });

  it("typing_writes_markdown", async () => {
    const bridge = fakeBridge({ a: "# Hi\n\n* a\n" });
    mount(bridge);
    const view = await viewOf();
    act(() => view.dispatch(view.state.tr.insertText("Oh ", 1)));
    await waitFor(() =>
      expect(bridge.replace).toHaveBeenCalledWith(
        "a",
        expect.stringContaining("# Oh Hi"),
      ),
    );
    expect(bridge.replace).toHaveBeenCalledTimes(1);
  });

  it("an_app_shortcut_or_a_press_elsewhere_writes_at_once", async () => {
    const bridge = fakeBridge({ a: "# Hi\n" });
    mount(bridge);
    const view = await viewOf();
    act(() => view.dispatch(view.state.tr.insertText("Oh ", 1)));
    // Mod+S reads the text right after this key: it can't wait.
    fireEvent.keyDown(view.dom, { key: "s", code: "KeyS", ctrlKey: true });
    expect(bridge.replace).toHaveBeenCalledWith("a", "# Oh Hi\n");
    act(() => view.dispatch(view.state.tr.insertText("!", 6)));
    fireEvent.pointerDown(document.body);
    expect(bridge.replace).toHaveBeenLastCalledWith("a", "# Oh Hi!\n");
  });

  it("outside_change_rerenders_without_writing", async () => {
    const bridge = fakeBridge({ a: "# Hi\n" });
    const r = mount(bridge);
    await viewOf();
    act(() => bridge.outside("a", "# Reloaded\n\nfrom disk\n"));
    await waitFor(() => expect(r.container.textContent).toContain("Reloaded"));
    await act(settle);
    r.unmount();
    expect(bridge.replace).not.toHaveBeenCalled();
  });

  it("read_only_refuses_edits", async () => {
    const bridge = fakeBridge({ a: "# Hi\n" });
    mount(bridge, { readOnly: true });
    const view = await viewOf();
    expect(view.dom.getAttribute("contenteditable")).toBe("false");
    act(() => view.dispatch(view.state.tr.insertText("Oh ", 1)));
    expect(view.state.doc.textContent).toBe("Hi");
    await act(settle);
    expect(bridge.replace).not.toHaveBeenCalled();
  });

  it("ctrl_click_opens_link", async () => {
    const bridge = fakeBridge({ a: "[site](https://example.com)\n" });
    const r = mount(bridge);
    await viewOf();
    const link = await waitFor(() => r.container.querySelector("a")!);
    fireEvent.click(link, { ctrlKey: true, metaKey: true });
    expect(r.props.onOpenLink).toHaveBeenCalledWith("https://example.com");
  });

  it("plain_click_does_not", async () => {
    const bridge = fakeBridge({ a: "[site](https://example.com)\n" });
    const r = mount(bridge);
    await viewOf();
    const link = await waitFor(() => r.container.querySelector("a")!);
    fireEvent.click(link);
    expect(r.props.onOpenLink).not.toHaveBeenCalled();
  });

  it("image_shows_alt_text", async () => {
    const bridge = fakeBridge({ a: "![a cat](cat.png)\n" });
    const r = mount(bridge);
    await viewOf();
    await waitFor(() =>
      expect(r.container.textContent).toContain("[image: a cat]"),
    );
    // (ProseMirror's own separator after an inline node is no image.)
    expect(
      r.container.querySelector("img:not(.ProseMirror-separator)"),
    ).toBeNull();
  });

  it("unkeepable_note_falls_back", async () => {
    const bridge = fakeBridge({
      a: "See [the docs][1].\n\n[1]: https://example.com/docs\n",
    });
    const r = mount(bridge);
    await waitFor(() =>
      expect(r.props.onFallback).toHaveBeenCalledWith(
        "This note uses Markdown the rich editor can't keep",
      ),
    );
    expect(r.container.querySelector(".ProseMirror")).toBeNull();
    expect(bridge.replace).not.toHaveBeenCalled();
  });

  it("two_rich_tabs_in_a_split_are_independent", async () => {
    const bridge = fakeBridge({ a: "# One\n", b: "# Two\n" });
    mount(bridge, {}, "a");
    mount(bridge, { focused: false }, "b");
    const [va, vb] = await Promise.all([viewOf("a"), viewOf("b")]);
    expect(va).not.toBe(vb);
    act(() => vb.dispatch(vb.state.tr.insertText("Second ", 1)));
    await waitFor(() =>
      expect(bridge.replace).toHaveBeenCalledWith(
        "b",
        expect.stringContaining("# Second Two"),
      ),
    );
    expect(bridge.replace).not.toHaveBeenCalledWith("a", expect.anything());
    act(() => bridge.outside("a", "# Changed\n"));
    await waitFor(() => expect(va.state.doc.textContent).toBe("Changed"));
    expect(vb.state.doc.textContent).toBe("Second Two");
  });

  it("outside_change_during_create_is_shown_and_not_reverted", async () => {
    const bridge = fakeBridge({ a: "# Before\n" });
    hook.building = () => {
      hook.building = null;
      bridge.outside("a", "# After\n");
    };
    mount(bridge);
    const view = await viewOf();
    await waitFor(() => expect(view.state.doc.textContent).toBe("After"));
    await act(settle);
    expect(bridge.replace).not.toHaveBeenCalled();
    expect(bridge.text("a")).toBe("# After\n");
  });

  it("altgr_keys_do_nothing_structural", async () => {
    const bridge = fakeBridge({ a: "Hi\n" });
    mount(bridge);
    const view = await viewOf();
    // AltGr+7 is "{" on a German layout; AltGr+C is "ć" in Polish.
    for (const [key, code, keyCode] of [
      ["{", "Digit7", 55],
      ["[", "Digit8", 56],
      ["}", "Digit0", 48],
      ["²", "Digit2", 50],
      ["ć", "KeyC", 67],
      ["ź", "KeyX", 88],
    ] as const) {
      fireEvent.keyDown(view.dom, {
        key,
        code,
        keyCode,
        ctrlKey: true,
        altKey: true,
      });
    }
    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.firstChild!.type.name).toBe("paragraph");
    view.state.doc.descendants((n) => {
      expect(n.marks.map((m) => m.type.name)).toEqual([]);
    });
  });

  it("mod_wheel_zooms", async () => {
    const bridge = fakeBridge({ a: "Hi\n" });
    const onZoom = vi.fn();
    mount(bridge, { onZoom });
    const view = await viewOf();
    fireEvent.wheel(view.dom, { deltaY: -100, ctrlKey: true });
    expect(onZoom).toHaveBeenCalledWith(1);
    fireEvent.wheel(view.dom, { deltaY: 100, ctrlKey: true });
    expect(onZoom).toHaveBeenLastCalledWith(-1);
    // A plain wheel just scrolls.
    fireEvent.wheel(view.dom, { deltaY: 100 });
    expect(onZoom).toHaveBeenCalledTimes(2);
  });

  it("a_pending_edit_is_registered_and_flushed_on_request", async () => {
    const bridge = fakeBridge({ a: "# Hi\n" });
    type Sync = { pending(): boolean; flush(): void };
    let sync: Sync | null = null;
    const off = vi.fn();
    const register = vi.fn((_id: string, s: Sync) => {
      sync = s;
      return off;
    });
    const r = mount(bridge, { register });
    const view = await viewOf();
    expect(register).toHaveBeenCalledWith("a", expect.anything());
    expect(sync!.pending()).toBe(false);
    act(() => view.dispatch(view.state.tr.insertText("Oh ", 1)));
    expect(sync!.pending()).toBe(true);
    sync!.flush();
    expect(sync!.pending()).toBe(false);
    expect(bridge.replace).toHaveBeenCalledWith("a", "# Oh Hi\n");
    r.unmount();
    expect(off).toHaveBeenCalled();
  });

  it("turning_read_only_keeps_a_pending_edit", async () => {
    const bridge = fakeBridge({ a: "# Hi\n" });
    const r = mount(bridge);
    const view = await viewOf();
    act(() => view.dispatch(view.state.tr.insertText("Oh ", 1)));
    r.rerender(
      <RichEditor {...r.props} readOnly>
        <Grab id="a" />
      </RichEditor>,
    );
    // Written if the Tab's text still takes it; never silently dropped.
    await waitFor(() =>
      expect(bridge.replace).toHaveBeenCalledWith("a", "# Oh Hi\n"),
    );
  });

  it("an_outside_change_never_drops_a_pending_edit", async () => {
    const bridge = fakeBridge({ a: "# Hi\n" });
    const onConflict = vi.fn();
    mount(bridge, { onConflict });
    const view = await viewOf();
    act(() => view.dispatch(view.state.tr.insertText("Oh ", 1)));
    act(() => bridge.outside("a", "# Other\n"));
    // The edit is kept as the conflict's "mine": the app holds the Tab
    // first, then the edit is written (never cleared, never silent).
    await waitFor(() =>
      expect(bridge.replace).toHaveBeenCalledWith("a", "# Oh Hi\n"),
    );
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(onConflict.mock.invocationCallOrder[0]).toBeLessThan(
      bridge.replace.mock.invocationCallOrder[0],
    );
    expect(view.state.doc.textContent).toBe("Oh Hi");
  });

  it("a_throwing_ui_listener_never_loses_an_edit", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      function Thrower() {
        const rich = useRich();
        useEffect(
          () =>
            rich?.subscribe(() => {
              throw new Error("listener broke");
            }),
          [rich],
        );
        return null;
      }
      const bridge = fakeBridge({ a: "# Hi\n" });
      mount(bridge, { children: <Thrower /> });
      const view = await viewOf();
      act(() => view.dispatch(view.state.tr.insertText("Oh ", 1)));
      await waitFor(() =>
        expect(bridge.replace).toHaveBeenCalledWith("a", "# Oh Hi\n"),
      );
    } finally {
      error.mockRestore();
    }
  });

  it("only_an_app_shortcut_writes_at_once", async () => {
    const bridge = fakeBridge({ a: "# Hi\n" });
    mount(bridge);
    const view = await viewOf();
    act(() => view.dispatch(view.state.tr.insertText("Oh ", 1)));
    // AltGr+E is "ę" in Polish (Ctrl+Alt on Windows): a character, not a
    // Command, so it waits for the debounce like typing.
    fireEvent.keyDown(view.dom, {
      key: "ę",
      code: "KeyE",
      ctrlKey: true,
      altKey: true,
    });
    fireEvent.keyDown(view.dom, {
      key: "Control",
      code: "ControlLeft",
      ctrlKey: true,
    });
    expect(bridge.replace).not.toHaveBeenCalled();
    fireEvent.keyDown(view.dom, { key: "s", code: "KeyS", ctrlKey: true });
    expect(bridge.replace).toHaveBeenCalledWith("a", "# Oh Hi\n");
  });

  it("the_editable_area_is_a_named_textbox", async () => {
    const bridge = fakeBridge({ a: "# Hi\n" });
    mount(bridge);
    const view = await viewOf();
    expect(view.dom.getAttribute("role")).toBe("textbox");
    expect(view.dom.getAttribute("aria-multiline")).toBe("true");
    expect(view.dom.getAttribute("aria-label")).toBe("Rich editor");
  });
});
