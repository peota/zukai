import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { TextBridge } from "../editor/EditorHost";
import RichEditor, { useRich, type RichEditorProps } from "./RichEditor";

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
    </RichEditor>,
  );
  return { ...r, props };
}

async function viewOf(id = "a"): Promise<EditorView> {
  return waitFor(() => {
    const v = views.get(id);
    expect(v).toBeDefined();
    return v!;
  });
}

const settle = () => new Promise((r) => setTimeout(r, 450));

describe("RichEditor", () => {
  beforeEach(() => views.clear());

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
});
