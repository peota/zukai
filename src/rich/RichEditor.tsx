/**
 * The rich (Milkdown) editor for one Markdown Tab. The Tab's CodeMirror view
 * stays the owner of its text: this parses that text, and writes a user's
 * edits back through the TextBridge.
 *
 * Load this module lazily (`React.lazy`): it pulls in Milkdown.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  parserCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { imageSchema } from "@milkdown/kit/preset/commonmark";
import { Slice } from "@milkdown/kit/prose/model";
import type { Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $view } from "@milkdown/kit/utils";
import type { TextBridge } from "../editor/EditorHost";
import {
  CANT_KEEP_NOTICE,
  TOO_LARGE_NOTICE,
  tooLargeForRich,
} from "../model/markdownMode";
import { detectPlatform, matchShortcut } from "../app/shortcuts";
import { toggleTask, toggleTaskAt } from "./commands";
import { canKeep, richPlugins } from "./richMarkdown";
import { PROGRAMMATIC, RichContext, type RichHandle } from "./richContext";
import { RichToolbar } from "./RichToolbar";
import { SlashMenu } from "./SlashMenu";

export { useRich, type RichHandle } from "./richContext";

/** How long typing settles before it is written to the Tab's text. */
export const RICH_DEBOUNCE_MS = 300;

const platform = detectPlatform();
const mac = platform === "mac";

export interface RichEditorProps {
  id: string;
  bridge: TextBridge;
  readOnly: boolean;
  /** Takes the keyboard when this turns true. */
  focused: boolean;
  /** The content's text size in px. */
  fontSize: number;
  /** Ctrl+click (Cmd+click on macOS) on an http(s) or mailto link. */
  onOpenLink(href: string): void;
  /** The note can't be shown here: show it as Markdown, with `notice`. */
  onFallback(notice: string): void;
  /** Bump to take the keyboard back (e.g. after a popup closed). */
  focusSignal?: number;
  /** Mod+wheel over the text: 1 bigger, -1 smaller. */
  onZoom?(dir: 1 | -1): void;
  /**
   * Tells the app about an edit not yet written, and lets it write it now
   * (before a save, close, exit or disk check). Returns the unregister.
   */
  register?(id: string, sync: RichSync): () => void;
  /**
   * The Tab's text changed from outside while an edit was pending: hold it
   * as a conflict. The edit is written right after (as its "mine").
   */
  onConflict?(): void;
  /**
   * The editor's own UI (toolbar, menus), shown above the text once the
   * editor exists; it reaches the editor through `useRich`.
   */
  children?: ReactNode;
}

/** A rich editor's edit not yet in the Tab's text. */
export interface RichSync {
  pending(): boolean;
  /** Write it now (through the Tab's change path). */
  flush(): void;
}

/** Wheel distance per zoom step, as in the plain editor. */
const ZOOM_WHEEL_STEP = 100;

/** Images are never loaded: their alt text stands in, as in the preview. */
const imageAsAlt = () =>
  $view(imageSchema.node, () => (node) => {
    const dom = document.createElement("span");
    dom.className = "z-md-img";
    dom.contentEditable = "false";
    const alt = (node.attrs.alt as string | undefined) ?? "";
    dom.textContent = alt ? `[image: ${alt}]` : "[image]";
    return { dom, ignoreMutation: () => true };
  });

const WEB_LINK = /^(https?:|mailto:)/i;

export function RichEditor(p: RichEditorProps) {
  const { id, bridge, readOnly, focused, fontSize, focusSignal } = p;
  const root = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<Omit<RichHandle, "readOnly"> | null>(
    null,
  );
  const [fellBack, setFellBack] = useState(false);
  // The latest props, for the editor's long-lived callbacks.
  const latest = useRef({
    readOnly,
    onOpenLink: p.onOpenLink,
    onFallback: p.onFallback,
    onZoom: p.onZoom,
    register: p.register,
    onConflict: p.onConflict,
  });
  useEffect(() => {
    latest.current = {
      readOnly,
      onOpenLink: p.onOpenLink,
      onFallback: p.onFallback,
      onZoom: p.onZoom,
      register: p.register,
      onConflict: p.onConflict,
    };
  });

  useEffect(() => {
    let live = true;
    let editor: Editor | null = null;
    let view: EditorView | null = null;
    /** Set once the editor exists: earlier transactions are its mount. */
    let mounted = false;
    /** A user edit not yet written. */
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** The text last parsed or written: its echo is nothing new. */
    let known = "";
    /** Bumped per outside change: only the newest one is shown. */
    let outsideSeq = 0;
    let off = () => {};
    /** The editor's own UI, told of every transaction. */
    const listeners = new Set<(tr: Transaction) => void>();

    const fallBack = (notice: string) => {
      if (!live) return;
      setFellBack(true);
      latest.current.onFallback(notice);
    };

    /**
     * Write a pending user edit into the Tab's text. It stays pending until
     * the text has it (a read-only Tab refuses it): never silently dropped.
     */
    const write = () => {
      clearTimeout(timer);
      timer = undefined;
      if (!dirty || !editor || !view) return;
      const md = editor.ctx.get(serializerCtx)(view.state.doc);
      if (md !== bridge.text(id)) bridge.replace(id, md);
      if (bridge.text(id) === md) {
        dirty = false;
        known = md;
      }
    };

    function dispatchTransaction(this: EditorView, tr: Transaction) {
      const user = mounted && tr.docChanged && !tr.getMeta(PROGRAMMATIC);
      if (user && latest.current.readOnly) return;
      this.updateState(this.state.apply(tr));
      // Marked before the UI hears of it: a failing listener can't lose it.
      if (user) {
        dirty = true;
        clearTimeout(timer);
        timer = setTimeout(write, RICH_DEBOUNCE_MS);
      }
      for (const cb of [...listeners]) {
        try {
          cb(tr);
        } catch (err) {
          console.error("rich editor UI failed", err);
        }
      }
    }

    /** Show the Tab's new text; anything not yet written gives way to it. */
    const reparse = (text: string) => {
      if (!editor || !view) return;
      const doc = editor.ctx.get(parserCtx)(text);
      if (!doc) return;
      const { state } = view;
      view.dispatch(
        state.tr
          .replace(0, state.doc.content.size, new Slice(doc.content, 0, 0))
          .setMeta(PROGRAMMATIC, true)
          .setMeta("addToHistory", false),
      );
    };

    /** A pending edit met an outside change: it becomes the conflict's mine. */
    const keepAsConflict = () => {
      if (!live || !dirty) return;
      // Holding the Tab writes the edit first (the app flushes on a hold).
      latest.current.onConflict?.();
      write();
    };

    const onOutside = (text: string) => {
      if (text === known) return;
      const seq = ++outsideSeq;
      if (dirty) {
        // Not expected (a pending edit makes a disk change a conflict, and
        // in-app actions write it first), but never silent: the Tab is held
        // as a conflict and the edit written as its "mine", once the plain
        // editor's update is over (never from inside it).
        queueMicrotask(keepAsConflict);
        return;
      }
      known = text;
      void canKeep(text).then((ok) => {
        if (!live || seq !== outsideSeq) return;
        if (dirty) return keepAsConflict();
        if (ok) reparse(text);
        else fallBack(CANT_KEEP_NOTICE);
      });
    };

    const onClick = (_view: EditorView, e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a) return false;
      // Never navigate the app's own page.
      e.preventDefault();
      if (!(mac ? e.metaKey : e.ctrlKey)) return false;
      const href = (a.getAttribute("href") ?? "").trim();
      if (WEB_LINK.test(href)) latest.current.onOpenLink(href);
      return true;
    };

    /** A press on a checklist item's box (drawn left of its text) ticks it. */
    const onMouseDown = (v: EditorView, e: MouseEvent) => {
      const li = e.target;
      if (e.button !== 0 || !(li instanceof HTMLLIElement)) return false;
      if (li.dataset.itemType !== "task") return false;
      if (e.clientX >= li.getBoundingClientRect().left) return false;
      e.preventDefault();
      if (v.editable) toggleTaskAt(v, v.posAtDOM(li, 0));
      return true;
    };

    /** Mod+Enter in a checklist item ticks or unticks it. */
    const onKeyDown = (v: EditorView, e: KeyboardEvent) => {
      const mod = mac ? e.metaKey : e.ctrlKey;
      const other = mac ? e.ctrlKey : e.metaKey;
      if (e.key !== "Enter" || !mod || other || e.altKey || e.shiftKey) {
        return false;
      }
      return v.editable && toggleTask(v);
    };

    void (async () => {
      try {
        await bridge.ready(id);
      } catch {
        return; // The Tab closed, or its text couldn't load.
      }
      // Check the text the editor will show (it may change meanwhile).
      const current = () => bridge.text(id) ?? "";
      let text: string | null = null;
      while (live && text !== current()) {
        text = current();
        if (tooLargeForRich(text)) return fallBack(TOO_LARGE_NOTICE);
        if (!(await canKeep(text))) return fallBack(CANT_KEEP_NOTICE);
      }
      if (!live || text === null || !root.current) return;
      known = text;
      const made = Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root.current);
          ctx.set(defaultValueCtx, text);
          ctx.update(editorViewOptionsCtx, (o) => ({
            ...o,
            editable: () => !latest.current.readOnly,
            attributes: {
              ...(typeof o.attributes === "object" ? o.attributes : {}),
              role: "textbox",
              "aria-multiline": "true",
              "aria-label": "Rich editor",
            },
            dispatchTransaction,
            handleKeyDown: onKeyDown,
            handleDOMEvents: {
              ...o.handleDOMEvents,
              click: onClick,
              mousedown: onMouseDown,
              blur: () => {
                write();
                return false;
              },
              // Before an app Command (save, close, switch…) reads the text.
              // Only a Command's key: AltGr characters (Ctrl+Alt) type.
              keydown: (_v, e) => {
                if (matchShortcut(e, platform)) write();
                return false;
              },
            },
          }));
        })
        .use(richPlugins())
        .use(imageAsAlt());
      await made.create();
      if (!live) {
        await made.destroy();
        return;
      }
      editor = made;
      view = made.ctx.get(editorViewCtx);
      mounted = true;
      const offOutside = bridge.onOutsideChange(id, onOutside);
      // A change while the editor was being made is shown now.
      const now = bridge.text(id) ?? "";
      if (now !== known) onOutside(now);
      const unregister =
        latest.current.register?.(id, { pending: () => dirty, flush: write }) ??
        (() => {});
      // A press anywhere else (a Tab's close button, the status bar) may act
      // on the text without taking the focus first.
      const onPointerDown = (e: PointerEvent) => {
        if (!view?.dom.contains(e.target as Node)) write();
      };
      document.addEventListener("pointerdown", onPointerDown, true);
      off = () => {
        offOutside();
        unregister();
        document.removeEventListener("pointerdown", onPointerDown, true);
      };
      setHandle({
        editor: made,
        view,
        subscribe: (cb) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
      });
    })().catch((err) => {
      console.error("rich editor failed", err);
      fallBack(CANT_KEEP_NOTICE);
    });

    return () => {
      live = false;
      write();
      off();
      setHandle(null);
      void editor?.destroy();
    };
  }, [id, bridge]);

  // Read-only follows the Tab (a close, a held File).
  useEffect(() => {
    handle?.view.setProps({ editable: () => !readOnly });
  }, [handle, readOnly]);

  useEffect(() => {
    if (focused && handle) handle.view.focus();
  }, [focused, handle, focusSignal]);

  // Mod+wheel zooms the text, as in the plain editor; the page never zooms.
  useEffect(() => {
    const el = root.current;
    if (!handle || !el) return;
    let sum = 0;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      // A wheel in lines or pages counts as whole notches.
      sum +=
        e.deltaMode === 0 ? e.deltaY : Math.sign(e.deltaY) * ZOOM_WHEEL_STEP;
      if (Math.abs(sum) < ZOOM_WHEEL_STEP) return;
      const dir = sum < 0 ? 1 : -1;
      sum = 0;
      latest.current.onZoom?.(dir);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [handle]);

  const rich = useMemo<RichHandle | null>(
    () => (handle ? { ...handle, readOnly } : null),
    [handle, readOnly],
  );

  if (fellBack) return null;
  return (
    <div
      className="z-rich flex size-full flex-col bg-editor"
      data-rich-editor=""
    >
      {rich && (
        <RichContext.Provider value={rich}>
          <div data-rich-toolbar="" className="shrink-0">
            <RichToolbar />
            {p.children}
          </div>
          <SlashMenu />
        </RichContext.Provider>
      )}
      <div
        ref={root}
        className="z-md min-h-0 flex-1 overflow-auto px-8 py-6"
        style={{ fontSize }}
      />
    </div>
  );
}

export default RichEditor;
