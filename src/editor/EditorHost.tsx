import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
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
  isolateHistory,
} from "@codemirror/commands";
import {
  bracketMatching,
  codeFolding,
  foldCode,
  foldGutter,
  indentOnInput,
  unfoldCode,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  highlightSelectionMatches,
  selectNextOccurrence,
} from "@codemirror/search";
import type { FileFormat, LanguageId, TabState } from "../model/types";
import { zukaiTheme } from "./theme";
import { loadLanguage } from "./languages";
import { GUESS_PREFIX, guessLanguage } from "./guess";
import { beautify, minify, type FormatResult } from "./jsonFormat";
import {
  formatExtension,
  formatField,
  setFormat,
  syncFormat,
} from "./fileFormat";
import {
  findExtension,
  type FindMode,
  type FindRequest,
} from "../find/findExtension";
import {
  EMPTY_FIND,
  FindBar,
  initialFindState,
  type FindState,
} from "../find/FindBar";

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
  /** Mod+F / Mod+H: open the find bar on the active Tab when `seq` changes. */
  findRequest?: FindRequest | null;
  /** Beautify/Minify the active JSON Tab when `seq` changes. */
  formatRequest?: { seq: number; kind: "beautify" | "minify" } | null;
  /** Convert a File's format as an undoable step when `seq` changes. */
  convertRequest?: {
    seq: number;
    id: string;
    patch: Partial<FileFormat>;
  } | null;
  /**
   * Replace a Tab's text (reload, Load disk version) as one undoable step.
   * At most one per Tab; each `seq` is applied once, hidden views included.
   */
  replaceRequests?: readonly { seq: number; id: string; text: string }[];
  /** Tabs whose unsaved text can't be read: read-only until it can. */
  shadowUnreadable?: ReadonlySet<string>;
  /** The outcome of a format request (the app shows a failure). */
  onFormatResult?(r: FormatResult): void;
}

interface OpenBar {
  tabId: string;
  view: EditorView;
  mode: FindMode;
  initial: FindState;
  seq: number;
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

/** A quiet fold marker: open ones show only while the gutter is hovered. */
function foldMarker(open: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = open ? "z-fold z-fold-open" : "z-fold z-fold-closed";
  el.textContent = open ? "⌄" : "›";
  el.title = open ? "Fold" : "Unfold";
  return el;
}

const baseSetup: Extension = [
  lineNumbers(),
  foldGutter({ markerDOM: foldMarker }),
  codeFolding(),
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
    { key: "Mod-Shift-[", run: foldCode },
    { key: "Mod-Shift-]", run: unfoldCode },
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...historyKeymap,
    indentWithTab,
  ]),
  zukaiTheme,
];

const sameFormat = (a: FileFormat | null, b: FileFormat | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.encoding === b.encoding &&
    a.bom === b.bom &&
    a.lineEnding === b.lineEnding &&
    a.mixed === b.mixed);

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** UTF-16 offset in `s` of a 1-based line and column. */
function offsetOf(s: string, line: number, col: number): number {
  let at = 0;
  for (let l = 1; l < line; l++) {
    const nl = s.indexOf("\n", at);
    if (nl === -1) break;
    at = nl + 1;
  }
  return Math.min(s.length, at + col - 1);
}

/**
 * Beautify or minify the main selection, or the whole document when it is
 * empty, as one edit. Invalid JSON changes nothing and moves the cursor to
 * the error; the result reports document lines and columns.
 */
function formatJson(
  view: EditorView,
  kind: "beautify" | "minify",
): FormatResult {
  const { state } = view;
  const sel = state.selection.main;
  const whole = sel.empty;
  const from = whole ? 0 : sel.from;
  const to = whole ? state.doc.length : sel.to;
  const src = state.sliceDoc(from, to);
  const r = kind === "beautify" ? beautify(src) : minify(src);
  if (!r.ok) {
    const pos = from + offsetOf(src, r.line, r.col);
    const line = state.doc.lineAt(pos);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    return { ...r, line: line.number, col: pos - line.from + 1 };
  }
  let text = r.text;
  if (!whole && kind === "beautify") {
    // A selection keeps the indentation of the line it starts on.
    const indent = /^[ \t]*/.exec(state.doc.lineAt(from).text)![0];
    if (indent) text = text.replace(/\n/g, `\n${indent}`);
  }
  if (text !== src) {
    view.dispatch({
      changes: { from, to, insert: text },
      selection: whole
        ? { anchor: Math.min(sel.head, text.length) }
        : { anchor: from, head: from + text.length },
      userEvent: "input.format",
      scrollIntoView: true,
    });
  }
  return { ok: true, text };
}

function clampSelection(state: TabState, length: number) {
  const clamp = (n: number) => Math.max(0, Math.min(length, n | 0));
  return {
    anchor: clamp(state.selection.anchor),
    head: clamp(state.selection.head),
  };
}

export function EditorHost(props: EditorHostProps) {
  const { tabs, activeId, isClosing, focusSignal, findRequest } = props;
  const { formatRequest, convertRequest, replaceRequests } = props;
  const { shadowUnreadable } = props;
  const container = useRef<HTMLDivElement>(null);
  const barBox = useRef<HTMLDivElement>(null);
  /** Each Tab's last search term and toggles, for this run of the app. */
  const findStates = useRef(new Map<string, FindState>());
  const barSeq = useRef(0);
  const [bar, setBar] = useState<OpenBar | null>(null);
  const views = useRef(new Map<string, Entry>());
  const creating = useRef(new Set<string>());
  /** Per Tab, the newest replace `seq` applied (or known to be stale). */
  const replaced = useRef(new Map<string, number>());
  /** Latest props, for listeners and async callbacks. */
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  const tabOf = (id: string) => latest.current.tabs.find((t) => t.id === id);

  /** Closing Tabs, read-only Files and unreadable shadows take no input. */
  const isReadOnly = (tab: TabState) =>
    (latest.current.isClosing?.(tab.id) ?? false) ||
    tab.file?.held === "readonly" ||
    (latest.current.shadowUnreadable?.has(tab.id) ?? false);

  const newestReplace = (id: string) =>
    (latest.current.replaceRequests ?? []).reduce(
      (n, r) => (r.id === id && r.seq > n ? r.seq : n),
      0,
    );

  /**
   * Make `text` the view's text as one undoable step, keeping the cursor
   * and scroll offset (clamped to the new length).
   */
  const replaceDoc = (e: Entry, text: string) => {
    const v = e.view;
    const old = v.state.doc.toString();
    if (old === text) return;
    // Change only what differs, so folds and heights elsewhere stay put.
    const max = Math.min(old.length, text.length);
    let a = 0;
    while (a < max && old.charCodeAt(a) === text.charCodeAt(a)) a++;
    if (a > 0 && isHighSurrogate(old.charCodeAt(a - 1))) a--;
    let b = 0;
    while (
      b < max - a &&
      old.charCodeAt(old.length - 1 - b) ===
        text.charCodeAt(text.length - 1 - b)
    ) {
      b++;
    }
    if (b > 0 && isLowSurrogate(old.charCodeAt(old.length - b))) b--;
    const clamp = (n: number) => Math.min(n, text.length);
    const sel = v.state.selection;
    const selection = EditorSelection.create(
      sel.ranges.map((r) =>
        EditorSelection.range(clamp(r.anchor), clamp(r.head)),
      ),
      sel.mainIndex,
    );
    const visible = e.wrapper.style.display !== "none";
    const top = v.scrollDOM.scrollTop;
    v.dispatch({
      changes: {
        from: a,
        to: old.length - b,
        insert: text.slice(a, text.length - b),
      },
      selection,
      annotations: [
        isolateHistory.of("full"),
        Transaction.userEvent.of("reload"),
      ],
    });
    if (visible) {
      v.scrollDOM.scrollTop = top;
      requestAnimationFrame(() => {
        if (v.dom.isConnected) v.scrollDOM.scrollTop = top;
      });
    }
  };

  /**
   * Apply each replace request not applied yet. One for a Tab with no view
   * waits for the view; one for a closed Tab is dropped.
   */
  const applyReplaces = () => {
    const { replaceRequests: list = [], tabs: all } = latest.current;
    for (const r of list) {
      if (r.seq <= (replaced.current.get(r.id) ?? 0)) continue;
      const e = views.current.get(r.id);
      if (!all.some((t) => t.id === r.id)) {
        replaced.current.set(r.id, r.seq);
      } else if (e) {
        replaced.current.set(r.id, r.seq);
        replaceDoc(e, r.text);
      }
    }
  };

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

  /** A Convert, or its undo/redo: the File is then written in that format. */
  const reportFormat = (id: string, u: ViewUpdate) => {
    for (const tr of u.transactions) {
      for (const fx of tr.effects) {
        const file = tabOf(id)?.file;
        if (fx.is(setFormat) && file) {
          latest.current.onTabPatch(id, {
            file: { ...file, format: fx.value },
          });
        }
      }
    }
  };

  /** Open (or refocus) the find bar on a Tab's view. */
  const openBar = (id: string, mode: FindMode) => {
    const e = views.current.get(id);
    if (!e) return;
    const last = findStates.current.get(id) ?? EMPTY_FIND;
    // Pressed again while typing in the bar: keep its text, just refocus.
    const inBar = barBox.current?.contains(document.activeElement) ?? false;
    const initial = inBar ? last : initialFindState(e.view, last);
    setBar({ tabId: id, view: e.view, mode, initial, seq: ++barSeq.current });
  };

  const rememberFind = (id: string, state: FindState) => {
    findStates.current.set(id, state);
    setBar((b) => (b && b.tabId === id ? { ...b, initial: state } : b));
  };

  const createView = (tab: TabState, text: string): Entry => {
    const id = tab.id;
    const readOnly = isReadOnly(tab);
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
      reportFormat(id, u);
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
          formatExtension(tab.file?.format ?? null),
          findExtension((mode) => openBar(id, mode)),
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
    // The loaded text already has every replace issued before this point;
    // only newer ones are applied on top of it.
    const known = newestReplace(id);
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
        const done = replaced.current.get(id) ?? 0;
        replaced.current.set(id, Math.max(done, known));
        applyReplaces();
        showActive();
      })
      .catch((err: unknown) => console.error("load scratchpad failed", err))
      .finally(() => creating.current.delete(id));
    // Helpers read the latest props through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeId]);

  // Keep each view's Language, wrapping, read-only state and format in step.
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
      const ro = isReadOnly(tab);
      if (ro !== e.current.readOnly) {
        e.current.readOnly = ro;
        effects.push(e.readOnly.reconfigure(readOnlyExt(ro)));
      }
      // A format set elsewhere (a reload, a refused Convert): follow it,
      // outside the history.
      const format = tab.file?.format ?? null;
      if (!sameFormat(format, e.view.state.field(formatField))) {
        effects.push(syncFormat.of(format));
      }
      if (effects.length > 0) {
        e.view.dispatch({
          effects,
          annotations: Transaction.addToHistory.of(false),
        });
      }
    }
    // Helpers read the latest props through a ref.
  }, [tabs, isClosing, shadowUnreadable]);

  // Reload / Load disk version, for every Tab, hidden views included.
  useEffect(() => {
    applyReplaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaceRequests, tabs]);

  // Convert: an undoable effect, reported by the listener.
  useEffect(() => {
    if (!convertRequest) return;
    const { id, patch } = convertRequest;
    const file = tabOf(id)?.file;
    if (!file) return;
    const format = { ...file.format, ...patch };
    const e = views.current.get(id);
    if (!e) {
      latest.current.onTabPatch(id, { file: { ...file, format } });
      return;
    }
    e.view.dispatch({
      effects: setFormat.of(format),
      annotations: isolateHistory.of("full"),
    });
  }, [convertRequest]);

  // Beautify / Minify the active JSON Tab.
  useEffect(() => {
    if (!formatRequest) return;
    const id = latest.current.activeId;
    const tab = tabOf(id);
    const e = views.current.get(id);
    if (!tab || !e || tab.language !== "json" || e.view.state.readOnly) return;
    // Not inline in `?.()`: that would skip formatting with no listener.
    const result = formatJson(e.view, formatRequest.kind);
    latest.current.onFormatResult?.(result);
  }, [formatRequest]);

  useEffect(() => {
    if (focusSignal === undefined) return;
    views.current.get(latest.current.activeId)?.view.focus();
  }, [focusSignal]);

  // Each new request (a new seq) opens the bar on the active Tab.
  useEffect(() => {
    if (findRequest) openBar(latest.current.activeId, findRequest.mode);
  }, [findRequest]);

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

  const showBar =
    bar && bar.tabId === activeId && tabs.some((t) => t.id === bar.tabId);
  return (
    <div className="relative size-full">
      <div ref={container} className="size-full" />
      <div ref={barBox} className="contents">
        {showBar && (
          <FindBar
            key={bar.seq}
            view={bar.view}
            mode={bar.mode}
            initial={bar.initial}
            onChange={(s) => rememberFind(bar.tabId, s)}
            onClose={(s) => {
              findStates.current.set(bar.tabId, s);
              setBar(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
