import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  Transaction,
  type ChangeSpec,
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
  forceParsing,
  indentOnInput,
  indentRange,
  language as languageFacet,
  syntaxTree,
  unfoldCode,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  highlightSelectionMatches,
  selectNextOccurrence,
} from "@codemirror/search";
import type {
  FileFormat,
  FileInfo,
  LanguageId,
  TabState,
} from "../model/types";
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
import {
  canToggleHidden,
  hiddenField,
  hiddenRanges,
  hiddenTextExtension,
  loadHidden,
  selectionHidden,
  toggleHidden,
} from "./hiddenText";
import { Menu, type MenuItem } from "../ui/Menu";
import { detectPlatform } from "../app/shortcuts";

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
  /** The text size in px (13 when unset). */
  fontSize?: number;
  /** Mod+wheel over the text: 1 bigger, -1 smaller. */
  onZoom?(dir: 1 | -1): void;
  /** The line-number gutter (shown when unset). */
  lineNumbers?: boolean;
  /**
   * Tab ids whose views are visible (just `activeId` when unset). Only
   * `activeId` takes focus and reports its cursor.
   */
  shown?: readonly string[];
  /**
   * Where each shown view goes. A shown id with no slot, and every hidden
   * view, stays in the host's own container. A view moves, never recreated.
   */
  slots?: ReadonlyMap<string, HTMLElement>;
  /**
   * Handed the host's text bridge (one object for the host's life) on mount,
   * and null on unmount.
   */
  bridgeRef?(b: TextBridge | null): void;
}

/**
 * A narrow way for another editor (the rich one) to work on a Tab's text
 * while the Tab's CodeMirror view stays its owner.
 */
export interface TextBridge {
  /** The Tab's current text; null until its view has loaded. */
  text(id: string): string | null;
  /**
   * Make `text` the Tab's text as one change kept out of the view's history
   * and tagged `fromRich`. It goes through the same `onChange` path as
   * typing. Does nothing on a read-only (or not yet loaded) view.
   */
  replace(id: string, text: string): void;
  /**
   * Calls `cb` with the new text after every change to the Tab's text that
   * didn't come from `replace` (its load, reloads, replace requests, Convert,
   * typing in the plain editor). Returns the unsubscribe.
   */
  onOutsideChange(id: string, cb: (text: string) => void): () => void;
  /** Forget the view's undo history. */
  clearHistory(id: string): void;
  readOnly(id: string): boolean;
  /**
   * Resolves once the Tab's view exists with its text loaded (views are only
   * created for shown Tabs). Rejects if the Tab closes, its text fails to
   * load or the host unmounts first.
   */
  ready(id: string): Promise<void>;
}

/** Tags a change written through `TextBridge.replace`. */
export const fromRich = Annotation.define<boolean>();

/** Wheel distance per zoom step: one mouse notch, or a short pinch. */
const ZOOM_WHEEL_STEP = 100;

interface OpenBar {
  tabId: string;
  view: EditorView;
  mode: FindMode;
  initial: FindState;
  seq: number;
}

/** The editor's right-click menu, open on a Tab's view. */
interface TextMenu {
  view: EditorView;
  items: MenuItem[];
  x: number;
  y: number;
}

const MOD = detectPlatform() === "mac" ? "⌘" : "Ctrl+";

/** Selection and scroll are reported back this long after they settle. */
const PATCH_DELAY = 300;

interface Entry {
  view: EditorView;
  wrapper: HTMLDivElement;
  language: Compartment;
  wrap: Compartment;
  readOnly: Compartment;
  fontSize: Compartment;
  gutter: Compartment;
  history: Compartment;
  /** What each compartment currently holds (or is loading, for language). */
  current: {
    language: LanguageId;
    wrap: boolean;
    readOnly: boolean;
    fontSize: number;
    lineNumbers: boolean;
  };
  /** Guessing is tried at most once per Tab. */
  guessed: boolean;
  pending: Partial<TabState>;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Last scroll offset while visible; display:none can reset it. */
  scrollTop: number;
}

/** True while a text field in the Library sidebar has the keyboard. */
function sidebarFieldFocused(): boolean {
  const a = document.activeElement;
  return (
    a instanceof HTMLInputElement && a.closest("[data-z-sidebar]") !== null
  );
}

const wrapExt = (on: boolean): Extension => (on ? EditorView.lineWrapping : []);
const readOnlyExt = (on: boolean): Extension => [EditorState.readOnly.of(on)];

const DEFAULT_FONT_SIZE = 14;
/**
 * The text size as a theme: a theme change makes CodeMirror re-measure its
 * line heights, so the gutter follows (a plain CSS change can leave the
 * line numbers at the old height).
 */
const fontSizeExt = (px: number): Extension =>
  Prec.highest(EditorView.theme({ "&": { fontSize: `${px}px` } }));

/** A quiet fold marker: open ones show only while the gutter is hovered. */
function foldMarker(open: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = open ? "z-fold z-fold-open" : "z-fold z-fold-closed";
  el.textContent = open ? "⌄" : "›";
  el.title = open ? "Fold" : "Unfold";
  return el;
}

const lineNumbersExt = (on: boolean): Extension => (on ? lineNumbers() : []);

const baseSetup: Extension = [
  foldGutter({ markerDOM: foldMarker }),
  codeFolding(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
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
 * The Languages Shift+Alt+F re-indents. Python and YAML are left out on
 * purpose: their indentation is their meaning, so re-indenting could change
 * what the file says; Markdown likewise (lists, code blocks). SQL's only rule
 * indents every continuation line one step, which undoes the usual aligned
 * style. Shell and plain text have no indentation rules. C#'s (a legacy
 * stream mode) leave block comments and verbatim strings as they are.
 */
const REINDENT_LANGUAGES: ReadonlySet<LanguageId> = new Set([
  "javascript",
  "typescript",
  "html",
  "xml",
  "css",
  "csharp",
]);

type Tree = ReturnType<typeof syntaxTree>;
type SyntaxNode = ReturnType<Tree["resolveInner"]>;

/** How long a re-indent may spend parsing the rest of a long file. */
const REINDENT_PARSE_MS = 500;

/**
 * True if the leading whitespace of the line starting at `pos` is part of
 * the content, so re-indenting would change what it says: inside an HTML
 * `<pre>` or `<textarea>`, or an HTML/XML comment or CDATA section.
 */
function keepsIndent(tree: Tree, state: EditorState, pos: number): boolean {
  for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "Comment" || n.name === "Cdata") return pos > n.from;
    if (n.name === "TextareaText") return true;
    if (n.name === "Element") {
      const open = n.getChild("OpenTag");
      const tag = open?.getChild("TagName");
      if (
        open &&
        tag &&
        pos > open.to &&
        /^(pre|textarea)$/i.test(state.sliceDoc(tag.from, tag.to))
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Re-indents the lines of every selection range, or the whole document when
 * the selection is empty, by the Language's indentation rules, as one edit.
 * Only leading whitespace changes, and never where it is content (see
 * `keepsIndent`). Does nothing until `language` (the Tab's) is the one
 * loaded, or if the file can't be parsed in time. Returns whether anything
 * changed.
 */
export function reindent(view: EditorView, language: LanguageId): boolean {
  if (view.state.facet(languageFacet)?.name !== language) return false;
  const { doc, selection } = view.state;
  const whole = selection.ranges.every((r) => r.empty);
  // Whole lines, sorted; ranges sharing a line are merged, so no line is
  // indented twice.
  const spans: { from: number; to: number }[] = [];
  const lineSpans = whole
    ? [{ from: 0, to: doc.length }]
    : selection.ranges
        .map((r) => ({
          from: doc.lineAt(r.from).from,
          to: doc.lineAt(r.to).to,
        }))
        .sort((a, b) => a.from - b.from);
  for (const s of lineSpans) {
    const last = spans[spans.length - 1];
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else spans.push({ ...s });
  }
  // The indentation rules read the view's own tree, so parse into the view
  // (a long file is otherwise parsed only around what's on screen).
  const end = spans[spans.length - 1].to;
  if (!forceParsing(view, end, REINDENT_PARSE_MS)) return false;
  const { state } = view;
  const tree = syntaxTree(state);
  const specs: ChangeSpec[] = [];
  for (const { from, to } of spans) {
    indentRange(state, from, to).iterChanges((fromA, toA, _b, _e, text) => {
      if (!keepsIndent(tree, state, doc.lineAt(fromA).from)) {
        specs.push({ from: fromA, to: toA, insert: text });
      }
    });
  }
  if (specs.length === 0) return false;
  view.dispatch({ changes: specs, userEvent: "input.indent" });
  return true;
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
  // Only the JSON itself is formatted: whitespace around it (a final
  // newline, a line-wise selection's indent and line break) stays as is.
  const lead = /^[ \t\r\n]*/.exec(src)![0];
  const trail = /[ \t\r\n]*$/.exec(src.slice(lead.length))![0];
  const core = src.slice(lead.length, src.length - trail.length);
  const r = kind === "beautify" ? beautify(core) : minify(core);
  if (!r.ok) {
    const pos = from + lead.length + offsetOf(core, r.line, r.col);
    const line = state.doc.lineAt(pos);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    return { ...r, line: line.number, col: pos - line.from + 1 };
  }
  // Continuation lines take the indentation of the line the JSON starts on.
  const coreLine = state.doc.lineAt(from + lead.length).text;
  const indent = /^[ \t]*/.exec(coreLine)![0];
  const body = indent ? r.text.replace(/\n/g, `\n${indent}`) : r.text;
  const text = lead + body + trail;
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

/**
 * The one change turning `old` into `text`, covering only what differs (so
 * folds and heights elsewhere stay put), never splitting a surrogate pair.
 */
function changeTo(old: string, text: string): ChangeSpec {
  const max = Math.min(old.length, text.length);
  let a = 0;
  while (a < max && old.charCodeAt(a) === text.charCodeAt(a)) a++;
  if (a > 0 && isHighSurrogate(old.charCodeAt(a - 1))) a--;
  let b = 0;
  while (
    b < max - a &&
    old.charCodeAt(old.length - 1 - b) === text.charCodeAt(text.length - 1 - b)
  ) {
    b++;
  }
  if (b > 0 && isLowSurrogate(old.charCodeAt(old.length - b))) b--;
  return {
    from: a,
    to: old.length - b,
    insert: text.slice(a, text.length - b),
  };
}

/** A pending `TextBridge.ready`. */
interface Waiter {
  promise: Promise<void>;
  resolve(): void;
  reject(err: Error): void;
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
  const [textMenu, setTextMenu] = useState<TextMenu | null>(null);
  const views = useRef(new Map<string, Entry>());
  const creating = useRef(new Set<string>());
  /** The active Tab at the last showShown, to notice a switch. */
  const shownActive = useRef<string | undefined>(undefined);
  /**
   * Converts issued before the Tab's view existed, applied (undoably) once it
   * does. Never patched directly: that couldn't be undone, and the Tab's
   * text might not be loaded yet.
   */
  const heldConverts = useRef(new Map<string, Partial<FileFormat>>());
  /** Per Tab, the newest replace `seq` applied (or known to be stale). */
  const replaced = useRef(new Map<string, number>());
  /** Per Tab, the bridge's outside-change listeners. */
  const outside = useRef(new Map<string, Set<(text: string) => void>>());
  /** Per Tab, the `ready` promise of a view not created yet. */
  const waiters = useRef(new Map<string, Waiter>());
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
      changes: changeTo(old, text),
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

  /** A Convert as an undoable step (reported by the listener). */
  const applyConvert = (e: Entry, file: FileInfo, patch: Partial<FileFormat>) =>
    e.view.dispatch({
      effects: setFormat.of({ ...file.format, ...patch }),
      annotations: isolateHistory.of("full"),
    });

  /** Open (or refocus) the find bar on a Tab's view. */
  const openBar = (id: string, mode: FindMode) => {
    const e = views.current.get(id);
    if (!e) return;
    const last = findStates.current.get(id) ?? EMPTY_FIND;
    // Pressed again while typing in the bar: keep its text, just refocus.
    const at = document.activeElement;
    const slot = latest.current.slots?.get(id);
    const inBar =
      (barBox.current?.contains(at) ?? false) ||
      ((slot?.contains(at) ?? false) && !!at?.closest('[role="search"]'));
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
      fontSize: new Compartment(),
      gutter: new Compartment(),
      history: new Compartment(),
      current: {
        language: "plaintext",
        wrap: tab.wrap,
        readOnly,
        fontSize: latest.current.fontSize ?? DEFAULT_FONT_SIZE,
        lineNumbers: latest.current.lineNumbers ?? true,
      },
      guessed: tab.languagePicked || tab.languageGuessed,
      pending: {},
      timer: undefined,
      scrollTop: tab.scrollTop,
    };
    const e = entry as Entry; // the listener only runs once view is set
    const listener = EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        const text = u.state.doc.toString();
        latest.current.onChange(id, text);
        const outsideChange = u.transactions.some(
          (tr) => tr.docChanged && !tr.annotation(fromRich),
        );
        if (outsideChange) tellOutside(id, text);
      }
      reportFormat(id, u);
      maybeGuess(id, e, u);
      if (u.startState.field(hiddenField) !== u.state.field(hiddenField)) {
        const hidden = hiddenRanges(u.state).map(([a, b]) => [a, b]);
        queuePatch(id, e, {
          hidden: hidden as [number, number][],
        });
      }
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
          entry.history.of(history()),
          entry.language.of([]),
          entry.wrap.of(wrapExt(tab.wrap)),
          entry.readOnly.of(readOnlyExt(readOnly)),
          entry.gutter.of(lineNumbersExt(entry.current.lineNumbers)),
          entry.fontSize.of(fontSizeExt(entry.current.fontSize)),
          formatExtension(tab.file?.format ?? null),
          findExtension((mode) => openBar(id, mode)),
          hiddenTextExtension,
          listener,
        ],
      }),
      parent: wrapper,
    });
    if (tab.hidden?.length) {
      e.view.dispatch({
        effects: loadHidden(tab.hidden),
        annotations: Transaction.addToHistory.of(false),
      });
    }
    e.view.dom.addEventListener("contextmenu", (ev) => {
      // Right-click outside the selection moves the cursor there first, as
      // in a native text field.
      const pos = e.view.posAtCoords({ x: ev.clientX, y: ev.clientY });
      const inSel =
        pos !== null &&
        e.view.state.selection.ranges.some((r) => pos >= r.from && pos <= r.to);
      if (pos !== null && !inSel)
        e.view.dispatch({ selection: { anchor: pos } });
      ev.preventDefault();
      setTextMenu({
        view: e.view,
        items: textMenuItems(e.view),
        x: ev.clientX,
        y: ev.clientY,
      });
    });
    e.view.scrollDOM.addEventListener("scroll", () => {
      if (wrapper.style.display === "none") return;
      e.scrollTop = e.view.scrollDOM.scrollTop;
      queuePatch(id, e, { scrollTop: e.scrollTop });
    });
    if (tab.language !== "plaintext") applyLanguage(e, tab.language);
    return e;
  };

  /** A failing listener is logged; it never stops the view's own work. */
  const tellOutside = (id: string, text: string) => {
    for (const cb of [...(outside.current.get(id) ?? [])]) {
      try {
        cb(text);
      } catch (err) {
        console.error("outside-change listener failed", err);
      }
    }
  };

  /** Settle the `ready` promise of `id`, if one is waiting. */
  const settle = (id: string, err?: Error) => {
    const w = waiters.current.get(id);
    if (!w) return;
    waiters.current.delete(id);
    if (err) w.reject(err);
    else w.resolve();
  };

  const destroy = (id: string, e: Entry) => {
    clearTimeout(e.timer);
    e.view.destroy();
    e.wrapper.remove();
    views.current.delete(id);
  };

  /** The ids to show: `shown`, always with the active Tab. */
  const wantedIds = () => {
    const { shown, activeId: active } = latest.current;
    const ids = new Set(shown ?? []);
    if (active) ids.add(active);
    return ids;
  };

  /** Show the shown views (each in its slot), restoring scroll offsets. */
  const showShown = () => {
    const { activeId: active, slots } = latest.current;
    const wanted = wantedIds();
    const switched = shownActive.current !== active;
    shownActive.current = active;
    for (const [id, e] of views.current) {
      const visible = wanted.has(id);
      const was = e.wrapper.style.display !== "none";
      // A detached subtree (its slot removed) reads 0: keep the saved offset.
      const live = e.wrapper.isConnected;
      if (!visible && was) {
        if (live) e.scrollTop = e.view.scrollDOM.scrollTop;
        flushPatch(id, e);
      }
      const target = (visible && slots?.get(id)) || container.current;
      const moved = !!target && e.wrapper.parentElement !== target;
      if (moved && was && live) e.scrollTop = e.view.scrollDOM.scrollTop;
      if (moved) target.appendChild(e.wrapper);
      e.wrapper.style.display = visible ? "" : "none";
      if (visible && (!was || moved)) {
        const top = e.scrollTop;
        e.view.scrollDOM.scrollTop = top;
        e.view.requestMeasure();
        // Heights may be estimates until measured, which can clamp the
        // offset; put it back once layout has caught up.
        requestAnimationFrame(() => {
          if (e.view.dom.isConnected) e.view.scrollDOM.scrollTop = top;
        });
      }
      if (visible && id === active && (!was || moved || switched)) {
        // Not while typing in the sidebar (a new item's name, the search).
        if (!sidebarFieldFocused()) e.view.focus();
        reportCursor(e.view);
      }
    }
  };

  /** Create a shown view once its text has loaded. */
  const createLoaded = (id: string) => {
    if (views.current.has(id) || creating.current.has(id)) return;
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
        tellOutside(id, text);
        settle(id);
        const done = replaced.current.get(id) ?? 0;
        replaced.current.set(id, Math.max(done, known));
        applyReplaces();
        const patch = heldConverts.current.get(id);
        heldConverts.current.delete(id);
        if (patch && tab.file)
          applyConvert(e, tabOf(id)?.file ?? tab.file, patch);
        showShown();
      })
      .catch((err: unknown) => {
        console.error("load scratchpad failed", err);
        settle(id, new Error(`Tab ${id}'s text failed to load`));
      })
      .finally(() => creating.current.delete(id));
  };

  // Create the shown views (after their text loads), hide the others, and
  // destroy the views of closed Tabs.
  const shownKey = [...(props.shown ?? [])].join("|");
  useEffect(() => {
    const ids = new Set(tabs.map((t) => t.id));
    for (const [id, e] of views.current) if (!ids.has(id)) destroy(id, e);
    for (const id of heldConverts.current.keys()) {
      if (!ids.has(id)) heldConverts.current.delete(id);
    }
    for (const id of [...waiters.current.keys()]) {
      if (!ids.has(id)) {
        settle(id, new Error(`Tab ${id} closed before its text loaded`));
      }
    }

    showShown();
    for (const id of wantedIds()) if (ids.has(id)) createLoaded(id);
    // Helpers read the latest props through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeId, shownKey, props.slots]);

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

  // Reload / Load disk version, for every Tab, hidden views included. A
  // layout effect, so a keystroke can't land in a view about to be replaced.
  useLayoutEffect(() => {
    applyReplaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaceRequests, tabs]);

  // Convert: an undoable effect, reported by the listener.
  useEffect(() => {
    if (!convertRequest) return;
    const { id, patch } = convertRequest;
    const file = tabOf(id)?.file;
    if (!file) return;
    const e = views.current.get(id);
    if (!e) {
      // Held until the view exists (its text has loaded by then).
      const held = heldConverts.current.get(id);
      heldConverts.current.set(id, { ...held, ...patch });
      return;
    }
    applyConvert(e, file, patch);
  }, [convertRequest]);

  // Beautify / Minify the active JSON Tab; Beautify (Shift+Alt+F) on a code
  // Tab re-indents it.
  useEffect(() => {
    if (!formatRequest) return;
    const id = latest.current.activeId;
    const tab = tabOf(id);
    const e = views.current.get(id);
    if (!tab || !e || e.view.state.readOnly) return;
    if (tab.language !== "json") {
      if (
        formatRequest.kind === "beautify" &&
        REINDENT_LANGUAGES.has(tab.language)
      ) {
        reindent(e.view, tab.language);
      }
      return;
    }
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
    const waiting = waiters.current;
    return () => {
      for (const [id, e] of map) {
        flushPatch(id, e);
        destroy(id, e);
      }
      for (const id of [...waiting.keys()]) {
        settle(id, new Error("The editor host unmounted"));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The text bridge: one object for the host's life, reading the views map
  // and the latest props through refs.
  const [bridge] = useState<TextBridge>(() => {
    const readOnly = (id: string) => {
      const e = views.current.get(id);
      const tab = tabOf(id);
      return (e?.view.state.readOnly ?? false) || (!!tab && isReadOnly(tab));
    };
    return {
      text: (id) => views.current.get(id)?.view.state.doc.toString() ?? null,
      replace: (id, text) => {
        const e = views.current.get(id);
        if (!e || readOnly(id)) return;
        const old = e.view.state.doc.toString();
        if (old === text) return;
        e.view.dispatch({
          changes: changeTo(old, text),
          annotations: [fromRich.of(true), Transaction.addToHistory.of(false)],
        });
      },
      onOutsideChange: (id, cb) => {
        let set = outside.current.get(id);
        if (!set) outside.current.set(id, (set = new Set()));
        const mine = set;
        mine.add(cb);
        return () => {
          mine.delete(cb);
          if (mine.size === 0 && outside.current.get(id) === mine) {
            outside.current.delete(id);
          }
        };
      },
      clearHistory: (id) => {
        const e = views.current.get(id);
        if (!e) return;
        // Dropping the history field and adding it back starts it empty.
        e.view.dispatch({ effects: e.history.reconfigure([]) });
        e.view.dispatch({ effects: e.history.reconfigure(history()) });
      },
      readOnly,
      ready: (id) => {
        if (views.current.has(id)) return Promise.resolve();
        let w = waiters.current.get(id);
        if (!w) {
          let resolve!: () => void;
          let reject!: (err: Error) => void;
          const promise = new Promise<void>((res, rej) => {
            resolve = res;
            reject = rej;
          });
          w = { promise, resolve, reject };
          waiters.current.set(id, w);
        }
        return w.promise;
      },
    };
  });

  // Hand the bridge over (a layout effect, so it's there before plain
  // effects run); a replaced callback gets null, the new one the bridge.
  const { bridgeRef } = props;
  useLayoutEffect(() => {
    bridgeRef?.(bridge);
    return () => bridgeRef?.(null);
  }, [bridgeRef, bridge]);

  // Line numbers on or off for every view, hidden ones included.
  const showNumbers = props.lineNumbers ?? true;
  useEffect(() => {
    for (const e of views.current.values()) {
      if (e.current.lineNumbers === showNumbers) continue;
      e.current.lineNumbers = showNumbers;
      e.view.dispatch({
        effects: e.gutter.reconfigure(lineNumbersExt(showNumbers)),
      });
    }
  }, [showNumbers]);

  // A new size for every view, hidden ones included.
  const fontSize = props.fontSize ?? DEFAULT_FONT_SIZE;
  useEffect(() => {
    for (const e of views.current.values()) {
      if (e.current.fontSize === fontSize) continue;
      e.current.fontSize = fontSize;
      e.view.dispatch({
        effects: e.fontSize.reconfigure(fontSizeExt(fontSize)),
      });
    }
  }, [fontSize]);

  // Mod+wheel zooms the text, here or in a slot; the page itself never
  // zooms. Small deltas (a trackpad pinch) add up to one step per notch's
  // worth.
  const outer = useRef<HTMLDivElement>(null);
  const wheelSum = useRef(0);
  const { slots } = props;
  useEffect(() => {
    const els = [outer.current, ...(slots?.values() ?? [])].filter(
      (el): el is HTMLElement => !!el,
    );
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      // A wheel in lines or pages counts as whole notches.
      wheelSum.current +=
        e.deltaMode === 0 ? e.deltaY : Math.sign(e.deltaY) * ZOOM_WHEEL_STEP;
      if (Math.abs(wheelSum.current) < ZOOM_WHEEL_STEP) return;
      const dir = wheelSum.current < 0 ? 1 : -1;
      wheelSum.current = 0;
      latest.current.onZoom?.(dir);
    };
    for (const el of els) {
      el.addEventListener("wheel", onWheel, { passive: false });
    }
    return () => {
      for (const el of els) el.removeEventListener("wheel", onWheel);
    };
  }, [slots]);

  const showBar =
    bar && bar.tabId === activeId && tabs.some((t) => t.id === bar.tabId);
  const barSlot = bar ? props.slots?.get(bar.tabId) : undefined;
  const findBar = showBar && (
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
  );
  const menu = textMenu && (
    <Menu
      label="Text"
      x={textMenu.x}
      y={textMenu.y}
      items={textMenu.items}
      onDismiss={(chose) => {
        setTextMenu(null);
        if (!chose) textMenu.view.focus();
      }}
    />
  );
  return (
    <div ref={outer} className="relative size-full">
      <div ref={container} className="size-full" />
      <div ref={barBox} className="contents">
        {barSlot ? null : findBar}
      </div>
      {barSlot && findBar && createPortal(findBar, barSlot)}
      {menu && createPortal(menu, document.body)}
    </div>
  );
}

/** Cut, Copy, Paste, Select all, and Hide/Unhide for the selection. */
function textMenuItems(view: EditorView): MenuItem[] {
  const { state } = view;
  const empty = state.selection.ranges.every((r) => r.empty);
  const readOnly = state.readOnly;
  // The menu took focus; the clipboard commands act on the focused editor.
  const run = (f: () => void) => () => {
    view.focus();
    f();
  };
  return [
    {
      label: "Cut",
      hint: `${MOD}X`,
      disabled: empty || readOnly,
      onSelect: run(() => document.execCommand("cut")),
    },
    {
      label: "Copy",
      hint: `${MOD}C`,
      disabled: empty,
      onSelect: run(() => document.execCommand("copy")),
    },
    {
      label: "Paste",
      hint: `${MOD}V`,
      disabled: readOnly,
      onSelect: run(() => {
        navigator.clipboard.readText().then(
          (text) => {
            if (!text || view.state.readOnly) return;
            view.dispatch(view.state.replaceSelection(text), {
              userEvent: "input.paste",
              scrollIntoView: true,
            });
          },
          (err: unknown) => console.error("paste failed", err),
        );
      }),
    },
    {
      label: "Select all",
      hint: `${MOD}A`,
      onSelect: run(() =>
        view.dispatch({
          selection: { anchor: 0, head: view.state.doc.length },
        }),
      ),
    },
    {
      label: selectionHidden(state) ? "Unhide" : "Hide",
      separated: true,
      disabled: !canToggleHidden(state),
      reason: "Select text to hide",
      onSelect: run(() => toggleHidden(view)),
    },
  ];
}
