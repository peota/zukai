import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

/** Where a commit moves the active cell. */
export type CommitMove = "down" | "up" | "right" | "left" | null;

export interface CellEditorProps {
  value: string;
  /** px inside the grid's scrolled content. */
  top: number;
  left: number;
  width: number;
  /** One row's height; the editor grows a line at a time from here. */
  rowHeight: number;
  fontSize: number;
  onChange(value: string): void;
  onCommit(move: CommitMove): void;
  onCancel(): void;
  /** Called when the editor goes away while focused (e.g. a re-parse closed it). */
  onLostFocus(): void;
}

const PAD_Y = 4;

/**
 * A positioned textarea over the cell being edited. Enter commits and moves
 * down, Tab right (Shift reverses), Esc cancels, Alt+Enter adds a line break,
 * and losing focus commits in place.
 */
export function CellEditor(p: CellEditorProps) {
  const el = useRef<HTMLTextAreaElement>(null);
  /** Set once the editor commits, cancels or unmounts: later blurs do nothing. */
  const done = useRef(false);
  const onLostFocus = useRef(p.onLostFocus);
  useLayoutEffect(() => {
    onLostFocus.current = p.onLostFocus;
  });

  useLayoutEffect(() => {
    const ta = el.current;
    if (!ta) return;
    ta.focus({ preventScroll: true });
    const end = ta.value.length;
    ta.setSelectionRange(end, end);
    return () => {
      done.current = true;
      if (document.activeElement === ta) onLostFocus.current();
    };
  }, []);

  const finish = (f: () => void) => {
    if (done.current) return;
    done.current = true;
    f();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && e.altKey) {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart: a, selectionEnd: b, value } = ta;
      const next = value.slice(0, a) + "\n" + value.slice(b);
      p.onChange(next);
      // Restore the caret after React writes the new value.
      requestAnimationFrame(() => ta.setSelectionRange(a + 1, a + 1));
      return;
    }
    if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      finish(() => p.onCommit(e.shiftKey ? "up" : "down"));
    } else if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      finish(() => p.onCommit(e.shiftKey ? "left" : "right"));
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(p.onCancel);
    }
  };

  const lineH = Math.round(p.fontSize * 1.45);
  const lines = p.value.split("\n").length;
  const height = Math.max(p.rowHeight, lines * lineH + 2 * PAD_Y);

  return (
    <textarea
      ref={el}
      aria-label="Edit cell"
      className="z-grid-editor"
      spellCheck={false}
      value={p.value}
      style={{
        top: p.top,
        left: p.left,
        width: Math.max(p.width, 120),
        height,
        lineHeight: `${lineH}px`,
        paddingTop: Math.max(PAD_Y, (p.rowHeight - lineH) / 2),
      }}
      onChange={(e) => p.onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(() => p.onCommit(null))}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}
