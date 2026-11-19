/**
 * The rich (Milkdown) editor for one Markdown Tab. The Tab's CodeMirror view
 * stays the owner of its text: this parses that text, and writes a user's
 * edits back through the TextBridge.
 *
 * Load this module lazily (`React.lazy`): it pulls in Milkdown.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { detectPlatform } from "../app/shortcuts";
import { canKeep, richPlugins } from "./richMarkdown";

/** How long typing settles before it is written to the Tab's text. */
export const RICH_DEBOUNCE_MS = 300;

/**
 * Tags a transaction that isn't the user's (the mount, a re-parse after an
 * outside change): it never writes the Tab's text.
 */
const PROGRAMMATIC = "zukaiProgrammatic";

const mac = detectPlatform() === "mac";

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
  /**
   * The editor's own UI (toolbar, menus), shown above the text once the
   * editor exists; it reaches the editor through `useRich`.
   */
  children?: ReactNode;
}

/** The live Milkdown editor and its ProseMirror view. */
export interface RichHandle {
  editor: Editor;
  view: EditorView;
}

const RichContext = createContext<RichHandle | null>(null);

/** The enclosing RichEditor's editor and view (null outside one). */
export function useRich(): RichHandle | null {
  return useContext(RichContext);
}

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
  const [handle, setHandle] = useState<RichHandle | null>(null);
  const [fellBack, setFellBack] = useState(false);
  // The latest props, for the editor's long-lived callbacks.
  const latest = useRef({
    readOnly,
    onOpenLink: p.onOpenLink,
    onFallback: p.onFallback,
  });
  useEffect(() => {
    latest.current = {
      readOnly,
      onOpenLink: p.onOpenLink,
      onFallback: p.onFallback,
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

    const fallBack = (notice: string) => {
      if (!live) return;
      setFellBack(true);
      latest.current.onFallback(notice);
    };

    /** Write a pending user edit, if the text it makes is new. */
    const write = () => {
      clearTimeout(timer);
      timer = undefined;
      if (!dirty || !editor || !view) return;
      dirty = false;
      if (latest.current.readOnly) return;
      const md = editor.ctx.get(serializerCtx)(view.state.doc);
      known = md;
      if (md !== bridge.text(id)) bridge.replace(id, md);
    };

    function dispatchTransaction(this: EditorView, tr: Transaction) {
      const user = mounted && tr.docChanged && !tr.getMeta(PROGRAMMATIC);
      if (user && latest.current.readOnly) return;
      this.updateState(this.state.apply(tr));
      if (!user) return;
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(write, RICH_DEBOUNCE_MS);
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

    const onOutside = (text: string) => {
      if (text === known) return;
      known = text;
      // The outside text wins over an edit still waiting to be written.
      clearTimeout(timer);
      timer = undefined;
      dirty = false;
      const seq = ++outsideSeq;
      void canKeep(text).then((ok) => {
        if (!live || seq !== outsideSeq) return;
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
            dispatchTransaction,
            handleDOMEvents: {
              ...o.handleDOMEvents,
              click: onClick,
              blur: () => {
                write();
                return false;
              },
              // Before an app Command (save, close, switch…) reads the text.
              keydown: (_v, e) => {
                if (e.ctrlKey || e.metaKey || e.altKey) write();
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
      // A press anywhere else (a Tab's close button, the status bar) may act
      // on the text without taking the focus first.
      const onPointerDown = (e: PointerEvent) => {
        if (!view?.dom.contains(e.target as Node)) write();
      };
      document.addEventListener("pointerdown", onPointerDown, true);
      off = () => {
        offOutside();
        document.removeEventListener("pointerdown", onPointerDown, true);
      };
      setHandle({ editor: made, view });
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

  if (fellBack) return null;
  return (
    <div
      className="z-rich flex size-full flex-col bg-editor"
      data-rich-editor=""
    >
      {handle && (
        <RichContext.Provider value={handle}>
          <div data-rich-toolbar="" className="shrink-0">
            {p.children}
          </div>
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
