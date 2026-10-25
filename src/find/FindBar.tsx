import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type { EditorView } from "@codemirror/view";
import {
  SearchQuery,
  closeSearchPanel,
  openSearchPanel,
  replaceAll,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import { countMatches, type MatchCount } from "./count";
import {
  findNextMatch,
  findPreviousMatch,
  replaceCurrent,
  firstMatchAtOrAfter,
  onViewUpdate,
  selectMatch,
  type FindMode,
} from "./findExtension";

/** A Tab's search term and toggles, kept in memory (not in the Session). */
export interface FindState {
  search: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

export const EMPTY_FIND: FindState = {
  search: "",
  replace: "",
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
};

export interface FindBarProps {
  view: EditorView;
  mode: FindMode;
  initial: FindState;
  onClose(state: FindState): void;
  /** Called on every change, so the owner can remember it per Tab. */
  onChange?(state: FindState): void;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The state to open the bar with: the selection if it's one non-empty line,
 * otherwise the Tab's last state.
 */
export function initialFindState(view: EditorView, last: FindState): FindState {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  if (!text || text.includes("\n") || text.length > 200) return last;
  return { ...last, search: last.regexp ? escapeRegExp(text) : text };
}

/**
 * The CodeMirror query for a FindState. Plain text runs as an escaped regex:
 * CodeMirror's regex cursor uses the native engine and is far faster than
 * its string cursor (about 10 ms against 400 ms over 10 MB). `$` in the
 * replacement is escaped to match, and backslashes stay text (think
 * Windows paths) unless Regex is on.
 */
export const toQuery = (s: FindState) =>
  new SearchQuery({
    search: s.regexp ? s.search : escapeRegExp(s.search),
    replace: s.regexp ? s.replace : s.replace.replace(/\$/g, "$$$$"),
    caseSensitive: s.caseSensitive,
    wholeWord: s.wholeWord,
    regexp: true,
    literal: true,
  });

const NO_COUNT: MatchCount = { total: 0, current: 0, capped: false };

function countText(c: MatchCount, search: string): string {
  if (!search) return "";
  if (c.total === 0) return "No results";
  const total = c.capped ? `${c.total}+` : String(c.total);
  return c.capped && c.current === 0 ? total : `${c.current} of ${total}`;
}

type Toggle = "caseSensitive" | "wholeWord" | "regexp";
const TOGGLES: { key: Toggle; code: string; label: string; text: string }[] = [
  { key: "caseSensitive", code: "KeyC", label: "Match case", text: "Aa" },
  { key: "wholeWord", code: "KeyW", label: "Whole word", text: "ab" },
  { key: "regexp", code: "KeyR", label: "Regular expression", text: ".*" },
];

const iconButton =
  "flex h-6 min-w-6 items-center justify-center rounded px-1 text-muted hover:bg-chrome hover:text-text";

export function FindBar({
  view,
  mode,
  initial,
  onClose,
  onChange,
}: FindBarProps) {
  const [state, setState] = useState(initial);
  const [showReplace, setShowReplace] = useState(mode === "replace");
  const [count, setCount] = useState(NO_COUNT);
  const stateRef = useRef(state);
  const findInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  /**
   * Where the bar was opened; typing searches from here. Mapped through
   * every document change, so it stays inside the document.
   */
  const origin = useRef({
    anchor: view.state.selection.main.anchor,
    head: view.state.selection.main.head,
  });

  const recount = () =>
    setCount(countMatches(view.state, toQuery(stateRef.current)));

  /** Apply the query; while typing, select the first match from the origin. */
  const apply = (next: FindState, jump: boolean) => {
    stateRef.current = next;
    setState(next);
    onChange?.(next);
    const query = toQuery(next);
    view.dispatch({ effects: setSearchQuery.of(query) });
    if (jump) {
      const len = view.state.doc.length;
      const anchor = Math.min(origin.current.anchor, len);
      const head = Math.min(origin.current.head, len);
      const m = firstMatchAtOrAfter(view.state, query, Math.min(anchor, head));
      if (m) selectMatch(view, m);
      else view.dispatch({ selection: { anchor, head } });
    }
    recount();
  };

  // Open CodeMirror's (empty) panel so matches highlight, follow the view's
  // updates for the count, and close the panel when the bar goes away.
  useEffect(() => {
    if (!searchPanelOpen(view.state)) openSearchPanel(view);
    apply(stateRef.current, true);
    const off = onViewUpdate(view, (u) => {
      if (u.docChanged) {
        const o = origin.current;
        origin.current = {
          anchor: u.changes.mapPos(o.anchor),
          head: u.changes.mapPos(o.head),
        };
      }
      if (u.docChanged || u.selectionSet) recount();
    });
    const input =
      replaceInput.current && stateRef.current.search
        ? replaceInput.current
        : findInput.current;
    input?.focus();
    input?.select();
    return () => {
      off();
      if (view.dom.isConnected && searchPanelOpen(view.state)) {
        closeSearchPanel(view);
      }
    };
    // Runs once per opening; apply/recount read the latest state via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const close = () => {
    closeSearchPanel(view);
    view.focus();
    onClose(stateRef.current);
  };

  const toggle = (key: Toggle) => {
    apply({ ...stateRef.current, [key]: !stateRef.current[key] }, true);
  };

  const step = (dir: 1 | -1) => {
    if (dir === 1) findNextMatch(view);
    else findPreviousMatch(view);
  };

  const onKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    field: "find" | "replace",
  ) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const t = TOGGLES.find((x) => x.code === e.code);
      if (t) {
        e.preventDefault();
        toggle(t.key);
        return;
      }
    }
    if (e.key === "F3") {
      // Also keeps WebView2's own find bar from opening.
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === "Enter" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (field === "replace") replaceCurrent(view);
      else step(e.shiftKey ? -1 : 1);
    }
  };

  const invalid = state.regexp && state.search !== "" && !toQuery(state).valid;
  const field =
    "h-6 min-w-0 flex-1 rounded border bg-editor px-1.5 font-mono text-[12px] text-text outline-none focus:border-accent";
  // Keep focus in the input when clicking the bar's buttons.
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  return (
    <div
      role="search"
      aria-label="Find in text"
      className="z-fade-in absolute top-3 right-3 z-10 flex w-[380px] max-w-[calc(100%-24px)] flex-col gap-1 rounded-float bg-surface p-1.5 text-[12px] text-text shadow-float"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={iconButton}
          aria-label="Toggle replace"
          aria-expanded={showReplace}
          title="Toggle replace"
          onMouseDown={keepFocus}
          onClick={() => setShowReplace((v) => !v)}
        >
          ⇄
        </button>
        <input
          ref={findInput}
          type="text"
          aria-label="Find"
          placeholder="Find"
          spellCheck={false}
          aria-invalid={invalid}
          className={`${field} ${invalid ? "border-danger text-danger focus:border-danger" : "border-hairline"}`}
          value={state.search}
          onChange={(e) =>
            apply({ ...stateRef.current, search: e.target.value }, true)
          }
          onKeyDown={(e) => onKeyDown(e, "find")}
        />
        <span
          className="min-w-14 text-right whitespace-nowrap text-muted tabular-nums"
          aria-live="polite"
        >
          {invalid ? "" : countText(count, state.search)}
        </span>
        {TOGGLES.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-label={`${t.label} (Alt+${t.code.slice(3)})`}
            title={`${t.label} (Alt+${t.code.slice(3)})`}
            aria-pressed={state[t.key]}
            className={`${iconButton} font-mono ${state[t.key] ? "bg-accent-soft text-text" : ""}`}
            onMouseDown={keepFocus}
            onClick={() => toggle(t.key)}
          >
            {t.text}
          </button>
        ))}
        <button
          type="button"
          className={iconButton}
          aria-label="Previous match (Shift+Enter)"
          title="Previous match (Shift+Enter)"
          onMouseDown={keepFocus}
          onClick={() => step(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label="Next match (Enter)"
          title="Next match (Enter)"
          onMouseDown={keepFocus}
          onClick={() => step(1)}
        >
          ↓
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label="Close (Escape)"
          title="Close (Escape)"
          onMouseDown={keepFocus}
          onClick={close}
        >
          ×
        </button>
      </div>
      {showReplace && (
        <div className="flex items-center gap-1 pl-7">
          <input
            ref={replaceInput}
            type="text"
            aria-label="Replace"
            placeholder="Replace"
            spellCheck={false}
            className={`${field} border-hairline`}
            value={state.replace}
            onChange={(e) =>
              apply({ ...stateRef.current, replace: e.target.value }, false)
            }
            onKeyDown={(e) => onKeyDown(e, "replace")}
          />
          <button
            type="button"
            className={`${iconButton} px-2`}
            title="Replace (Enter)"
            onMouseDown={keepFocus}
            onClick={() => replaceCurrent(view)}
          >
            Replace
          </button>
          <button
            type="button"
            className={`${iconButton} px-2`}
            title="Replace all"
            onMouseDown={keepFocus}
            onClick={() => replaceAll(view)}
          >
            Replace all
          </button>
        </div>
      )}
    </div>
  );
}
