import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  TOGGLES,
  countText,
  findBarClass,
  findCountClass,
  findField,
  iconButton,
} from "./FindBar";

/** A PDF Tab's search term and toggles, kept in memory like `FindState`. */
export interface PdfFindState {
  search: string;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export const EMPTY_PDF_FIND: PdfFindState = {
  search: "",
  caseSensitive: false,
  wholeWord: false,
};

export interface PdfFindBarProps {
  initial: PdfFindState;
  /** pdf.js's match count; null before its first report. */
  count: { current: number; total: number } | null;
  /** Search (`again`: step to the next or `previous` match). */
  onQuery(
    state: PdfFindState,
    opts: { again: boolean; previous: boolean },
  ): void;
  onClose(state: PdfFindState): void;
}

type PdfToggle = "caseSensitive" | "wholeWord";
/** No regular expressions: pdf.js finds plain text. */
const PDF_TOGGLES = TOGGLES.filter(
  (t): t is (typeof TOGGLES)[number] & { key: PdfToggle } => t.key !== "regexp",
);

/**
 * Find in a PDF: the text editor's find bar (same markup, same classes)
 * without replace or regular expressions. pdf.js does the searching; this
 * only reports what to look for.
 */
export function PdfFindBar({
  initial,
  count,
  onQuery,
  onClose,
}: PdfFindBarProps) {
  const [state, setState] = useState(initial);
  const stateRef = useRef(state);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const apply = (next: PdfFindState) => {
    stateRef.current = next;
    setState(next);
    onQuery(next, { again: false, previous: false });
  };

  const step = (previous: boolean) =>
    onQuery(stateRef.current, { again: true, previous });

  const toggle = (key: PdfToggle) =>
    apply({ ...stateRef.current, [key]: !stateRef.current[key] });

  const close = () => onClose(stateRef.current);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const t = PDF_TOGGLES.find((x) => x.code === e.code);
      if (t) {
        e.preventDefault();
        toggle(t.key);
        return;
      }
    }
    if (e.key === "F3") {
      // Also keeps WebView2's own find bar from opening.
      e.preventDefault();
      step(e.shiftKey);
      return;
    }
    if (e.key === "Enter" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      step(e.shiftKey);
    }
  };

  // Keep focus in the input when clicking the bar's buttons.
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  return (
    <div
      role="search"
      aria-label="Find in PDF"
      data-find-bar
      className={findBarClass}
    >
      <div className="flex items-center gap-1">
        <input
          ref={input}
          type="text"
          aria-label="Find"
          placeholder="Find"
          spellCheck={false}
          className={`${findField} border-hairline`}
          value={state.search}
          onChange={(e) =>
            apply({ ...stateRef.current, search: e.target.value })
          }
          onKeyDown={onKeyDown}
        />
        <span className={findCountClass} aria-live="polite">
          {count ? countText({ ...count, capped: false }, state.search) : ""}
        </span>
        {PDF_TOGGLES.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-label={`${t.label} (Alt+${t.code.slice(3)})`}
            title={`${t.label} (Alt+${t.code.slice(3)})`}
            aria-pressed={state[t.key]}
            className={`${iconButton} font-mono ${state[t.key] ? "bg-accent-tint text-accent" : ""}`}
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
          onClick={() => step(true)}
        >
          ↑
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label="Next match (Enter)"
          title="Next match (Enter)"
          onMouseDown={keepFocus}
          onClick={() => step(false)}
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
    </div>
  );
}
