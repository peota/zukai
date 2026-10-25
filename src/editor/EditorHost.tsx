import { useEffect, useLayoutEffect, useRef } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type ViewUpdate,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  highlightSelectionMatches,
  selectNextOccurrence,
} from "@codemirror/search";
import type { LanguageId, TabState } from "../model/types";
import { zukaiTheme } from "./theme";
import { loadLanguage } from "./languages";
import { GUESS_PREFIX, guessLanguage } from "./guess";

export interface EditorHostProps {
  tabs: TabState[];
  activeId: string;
  loadContent(id: string): Promise<string>;
  onChange(id: string, text: string): void;
  onTabPatch(id: string, patch: Partial<TabState>): void;
  onCursor(line: number, col: number): void;
  /** A closing Tab is read-only, so nothing typed during a close is lost. */
  isClosing?(id: string): boolean;
  /** Bump to move focus back to the active editor (e.g. after a popup). */
  focusSignal?: number;
}

/** Selection and scroll are reported back this long after they settle. */
const PATCH_DELAY = 300;

interface Entry {
  view: EditorView;
  wrapper: HTMLDivElement;
  language: Compartment;
  wrap: Compartment;
  readOnly: Compartment;
  /** What each compartment currently holds (or is loading, for language). */
  current: { language: LanguageId; wrap: boolean; readOnly: boolean };
  /** Guessing is tried at most once per Tab. */
  guessed: boolean;
  pending: Partial<TabState>;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Last scroll offset while visible; display:none can reset it. */
  scrollTop: number;
}

const wrapExt = (on: boolean): Extension => (on ? EditorView.lineWrapping : []);
const readOnlyExt = (on: boolean): Extension => [EditorState.readOnly.of(on)];

const baseSetup: Extension = [
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  history(),
  drawSelection(),
  EditorState.allowMultipleSelections.of(true),
  bracketMatching(),
  indentOnInput(),
  closeBrackets(),
  highlightSelectionMatches(),
  keymap.of([
    { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    indentWithTab,
  ]),
  zukaiTheme,
];

function clampSelection(state: TabState, length: number) {
  const clamp = (n: number) => Math.max(0, Math.min(length, n | 0));
  return {
    anchor: clamp(state.selection.anchor),
    head: clamp(state.selection.head),
  };
}

export function EditorHost(props: EditorHostProps) {
  const { tabs, activeId, isClosing, focusSignal } = props;
  const container = useRef<HTMLDivElement>(null);
  const views = useRef(new Map<string, Entry>());
  const creating = useRef(new Set<string>());
  /** Latest props, for listeners and async callbacks. */
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  const tabOf = (id: string) => latest.current.tabs.find((t) => t.id === id);

  const flushPatch = (id: string, e: Entry) => {
    clearTimeout(e.timer);
    e.timer = undefined;
    if (Object.keys(e.pending).length === 0) return;
    const patch = e.pending;
    e.pending = {};
    if (tabOf(id)) latest.current.onTabPatch(id, patch);
  };

  const queuePatch = (id: string, e: Entry, patch: Partial<TabState>) => {
    Object.assign(e.pending, patch);
    clearTimeout(e.timer);
    e.timer = setTimeout(() => flushPatch(id, e), PATCH_DELAY);
  };

  const reportCursor = (view: EditorView) => {
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    latest.current.onCursor(line.number, head - line.from + 1);
  };

  const applyLanguage = (e: Entry, id: LanguageId) => {
    e.current.language = id;
    loadLanguage(id).then(
      (ext) => {
        // Skip if the view is gone or another Language was chosen meanwhile.
        if (e.current.language !== id || !e.view.dom.isConnected) return;
        e.view.dispatch({ effects: e.language.reconfigure(ext) });
      },
      (err: unknown) => console.error(`load language ${id} failed`, err),
    );
  };

  const maybeGuess = (id: string, e: Entry, u: ViewUpdate) => {
    if (e.guessed || !u.docChanged) return;
    const tab = tabOf(id);
    if (!tab || tab.languagePicked || tab.languageGuessed) return;
    const pasted = u.transactions.some((tr) => tr.isUserEvent("input.paste"));
    if (!pasted && u.state.doc.lines < 3) return;
    e.guessed = true;
    // One char past the prefix tells the guesser the text goes on.
    const guess = guessLanguage(u.state.doc.sliceString(0, GUESS_PREFIX + 1));
    latest.current.onTabPatch(
      id,
      guess
        ? { language: guess, languageGuessed: true }
        : { languageGuessed: true },
    );
  };

  const createView = (tab: TabState, text: string): Entry => {
    const id = tab.id;
    const readOnly = latest.current.isClosing?.(id) ?? false;
    const wrapper = document.createElement("div");
    wrapper.className = "z-editor-view";
    wrapper.style.height = "100%";
    const entry: Omit<Entry, "view"> & { view?: EditorView } = {
      wrapper,
      language: new Compartment(),
      wrap: new Compartment(),
      readOnly: new Compartment(),
      current: { language: "plaintext", wrap: tab.wrap, readOnly },
      guessed: tab.languagePicked || tab.languageGuessed,
      pending: {},
      timer: undefined,
      scrollTop: tab.scrollTop,
    };
    const e = entry as Entry; // the listener only runs once view is set
    const listener = EditorView.updateListener.of((u) => {
      if (u.docChanged) latest.current.onChange(id, u.state.doc.toString());
      maybeGuess(id, e, u);
      if (u.selectionSet || u.docChanged) {
        const { anchor, head } = u.state.selection.main;
        queuePatch(id, e, { selection: { anchor, head } });
        if (latest.current.activeId === id) reportCursor(u.view);
      }
    });
    entry.view = new EditorView({
      state: EditorState.create({
        doc: text,
        selection: clampSelection(tab, text.length),
        extensions: [
          baseSetup,
          entry.language.of([]),
          entry.wrap.of(wrapExt(tab.wrap)),
          entry.readOnly.of(readOnlyExt(readOnly)),
          listener,
        ],
      }),
      parent: wrapper,
    });
    e.view.scrollDOM.addEventListener("scroll", () => {
      if (wrapper.style.display === "none") return;
      e.scrollTop = e.view.scrollDOM.scrollTop;
      queuePatch(id, e, { scrollTop: e.scrollTop });
    });
    if (tab.language !== "plaintext") applyLanguage(e, tab.language);
    return e;
  };

  const destroy = (id: string, e: Entry) => {
    clearTimeout(e.timer);
    e.view.destroy();
    e.wrapper.remove();
    views.current.delete(id);
  };

  /** Show only the active view, restoring its scroll offset. */
  const showActive = () => {
    const { activeId: active } = latest.current;
    for (const [id, e] of views.current) {
      const visible = id === active;
      const was = e.wrapper.style.display !== "none";
      if (!visible && was) {
        e.scrollTop = e.view.scrollDOM.scrollTop;
        flushPatch(id, e);
      }
      e.wrapper.style.display = visible ? "" : "none";
      if (visible && !was) {
        const top = e.scrollTop;
        e.view.scrollDOM.scrollTop = top;
        e.view.requestMeasure();
        // Heights may be estimates until measured, which can clamp the
        // offset; put it back once layout has caught up.
        requestAnimationFrame(() => {
          if (e.view.dom.isConnected) e.view.scrollDOM.scrollTop = top;
        });
        e.view.focus();
        reportCursor(e.view);
      }
    }
  };

  // Create the active view (after its text loads), hide the others, and
  // destroy the views of closed Tabs.
  useEffect(() => {
    const ids = new Set(tabs.map((t) => t.id));
    for (const [id, e] of views.current) if (!ids.has(id)) destroy(id, e);

    showActive();
    if (!activeId || views.current.has(activeId)) return;
    if (creating.current.has(activeId)) return;
    const id = activeId;
    creating.current.add(id);
    latest.current
      .loadContent(id)
      .then((text) => {
        const tab = tabOf(id);
        const host = container.current;
        if (!tab || !host || views.current.has(id)) return;
        const e = createView(tab, text);
        e.wrapper.style.display = "none";
        host.appendChild(e.wrapper);
        views.current.set(id, e);
        showActive();
      })
      .catch((err: unknown) => console.error("load scratchpad failed", err))
      .finally(() => creating.current.delete(id));
    // Helpers read the latest props through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeId]);

  // Keep each view's Language, wrapping and read-only state in step.
  useEffect(() => {
    for (const tab of tabs) {
      const e = views.current.get(tab.id);
      if (!e) continue;
      if (tab.language !== e.current.language) applyLanguage(e, tab.language);
      if (tab.languagePicked || tab.languageGuessed) e.guessed = true;
      const effects = [];
      if (tab.wrap !== e.current.wrap) {
        e.current.wrap = tab.wrap;
        effects.push(e.wrap.reconfigure(wrapExt(tab.wrap)));
      }
      const ro = isClosing?.(tab.id) ?? false;
      if (ro !== e.current.readOnly) {
        e.current.readOnly = ro;
        effects.push(e.readOnly.reconfigure(readOnlyExt(ro)));
      }
      if (effects.length > 0) e.view.dispatch({ effects });
    }
  }, [tabs, isClosing]);

  useEffect(() => {
    if (focusSignal === undefined) return;
    views.current.get(latest.current.activeId)?.view.focus();
  }, [focusSignal]);

  // Unmount: flush what's pending and tear every view down.
  useEffect(() => {
    const map = views.current;
    return () => {
      for (const [id, e] of map) {
        flushPatch(id, e);
        destroy(id, e);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={container} className="size-full" />;
}
