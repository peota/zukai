import { describe, expect, it } from "vitest";
import {
  allowsContextMenu,
  blocksBrowserKey,
  isEditorTarget,
  richHandled,
} from "./browserGuard";
import type { Platform } from "./shortcuts";

type Ev = Parameters<typeof blocksBrowserKey>[0];
const ev = (key: string, code: string, o: Partial<Ev> = {}): Ev => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...o,
});

describe.each(["mac", "other"] as Platform[])("blocksBrowserKey (%s)", (p) => {
  const mod: Partial<Ev> = p === "mac" ? { metaKey: true } : { ctrlKey: true };
  it("blocks reload and print everywhere", () => {
    for (const inEditor of [false, true]) {
      expect(blocksBrowserKey(ev("F5", "F5"), p, inEditor)).toBe(true);
      expect(
        blocksBrowserKey(ev("F5", "F5", { ctrlKey: true }), p, inEditor),
      ).toBe(true);
      expect(blocksBrowserKey(ev("r", "KeyR", mod), p, inEditor)).toBe(true);
      expect(
        blocksBrowserKey(
          ev("R", "KeyR", { ...mod, shiftKey: true }),
          p,
          inEditor,
        ),
      ).toBe(true);
      expect(blocksBrowserKey(ev("p", "KeyP", mod), p, inEditor)).toBe(true);
    }
  });
  it("matches the typed letter on other layouts", () => {
    // Dvorak: the key printed "r" is physical KeyO.
    expect(blocksBrowserKey(ev("r", "KeyO", mod), p, false)).toBe(true);
    expect(blocksBrowserKey(ev("к", "KeyR", mod), p, false)).toBe(true);
  });
  it("blocks F3 only outside the editor and find bar", () => {
    expect(blocksBrowserKey(ev("F3", "F3"), p, false)).toBe(true);
    expect(blocksBrowserKey(ev("F3", "F3", { shiftKey: true }), p, false)).toBe(
      true,
    );
    expect(blocksBrowserKey(ev("F3", "F3"), p, true)).toBe(false);
  });
  it("leaves ordinary keys alone", () => {
    expect(blocksBrowserKey(ev("r", "KeyR"), p, false)).toBe(false);
    expect(blocksBrowserKey(ev("a", "KeyA", mod), p, false)).toBe(false);
    expect(blocksBrowserKey(ev("F4", "F4"), p, false)).toBe(false);
  });
});

describe("DOM targets", () => {
  const make = (html: string) => {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.append(root);
    return root;
  };

  it("knows the editor and the find bar", () => {
    const root = make(
      '<div class="cm-editor"><div class="cm-content" id="c"></div></div>' +
        '<div data-find-bar><input id="f"></div><button id="b"></button>',
    );
    expect(isEditorTarget(root.querySelector("#c"))).toBe(true);
    expect(isEditorTarget(root.querySelector("#f"))).toBe(true);
    expect(isEditorTarget(root.querySelector("#b"))).toBe(false);
    expect(isEditorTarget(null)).toBe(false);
    root.remove();
  });

  it("allows the context menu only in text fields and the editor", () => {
    const root = make(
      '<div class="cm-editor"><span id="c">x</span></div><input id="i">' +
        '<textarea id="t"></textarea><div id="tab">Tab</div>',
    );
    expect(allowsContextMenu(root.querySelector("#c"))).toBe(true);
    expect(allowsContextMenu(root.querySelector("#i"))).toBe(true);
    expect(allowsContextMenu(root.querySelector("#t"))).toBe(true);
    expect(allowsContextMenu(root.querySelector("#tab"))).toBe(false);
    expect(allowsContextMenu(document)).toBe(false);
    root.remove();
  });
  it("a key the rich editor used is its own", () => {
    const root = make(
      '<div data-rich-editor><div class="ProseMirror" id="r"></div></div>' +
        '<div id="o"></div>',
    );
    const at = (id: string, defaultPrevented: boolean) => ({
      target: root.querySelector(id),
      defaultPrevented,
    });
    expect(richHandled(at("#r", true))).toBe(true);
    expect(richHandled(at("#r", false))).toBe(false);
    expect(richHandled(at("#o", true))).toBe(false);
    expect(allowsContextMenu(root.querySelector("#r"))).toBe(true);
    root.remove();
  });
});
