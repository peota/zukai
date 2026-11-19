/**
 * The "/" menu: `/` typed at the start of an empty paragraph offers the
 * toolbar's blocks, filtered by what follows it. ↑/↓ move, Enter inserts the
 * block in place of the `/query` text, Esc or a click elsewhere closes it
 * (leaving the text).
 */
import { useEffect, useRef, useState } from "react";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { MENU_PANEL, menuRow } from "../ui/Menu";
import { BLOCK_ITEMS, type BlockItem } from "./commands";
import { isProgrammatic, useRich } from "./richContext";

const ITEMS = Object.values(BLOCK_ITEMS);

/** The `/query` paragraph the cursor ends, if it is one. */
function slashAt(state: EditorState): { start: number; query: string } | null {
  const { $from, empty } = state.selection;
  const p = $from.parent;
  if (!empty || p.type.name !== "paragraph") return null;
  // A table cell holds just a paragraph: no blocks go there.
  if ($from.node(-1).type.spec.tableRole) return null;
  if ($from.parentOffset !== p.content.size) return null;
  const text = p.textContent;
  // Text only (no image or break), the "/" not inline code.
  if (text.length !== p.content.size || !text.startsWith("/")) return null;
  if (p.firstChild!.marks.some((m) => m.type.spec.code)) return null;
  return { start: $from.start(), query: text.slice(1) };
}

const matches = (query: string) => {
  const q = query.trim().toLowerCase();
  return ITEMS.filter((item) =>
    `${item.label} ${item.keywords}`.toLowerCase().includes(q),
  );
};

/** Where the menu hangs: under the paragraph's start. */
function anchor(view: EditorView, pos: number) {
  try {
    const c = view.coordsAtPos(pos);
    return { x: c.left, y: c.bottom + 4 };
  } catch {
    return { x: 0, y: 0 }; // No layout (e.g. jsdom).
  }
}

export function SlashMenu() {
  const rich = useRich()!;
  const { view, readOnly } = rich;
  const [open, setOpen] = useState<{ start: number; query: string } | null>(
    null,
  );
  /** The highlighted item, for the query it was chosen in. */
  const [pick, setPick] = useState({ query: "", index: 0 });
  const panel = useRef<HTMLDivElement>(null);
  const items = open ? matches(open.query) : [];
  const active = pick.query === open?.query ? pick.index : 0;
  const setActive = (index: number) =>
    setPick({ query: open?.query ?? "", index });

  // Opens on "/" in an empty paragraph; follows the query; closes when the
  // cursor leaves it.
  useEffect(
    () =>
      rich.subscribe((tr) => {
        const now = slashAt(view.state);
        setOpen((was) => {
          if (isProgrammatic(tr)) return null;
          if (!was) {
            return tr.docChanged && now?.query === "" && !readOnly ? now : null;
          }
          return now && now.start === was.start ? now : null;
        });
      }),
    [rich, view, readOnly],
  );

  const choose = (item: BlockItem) => {
    if (!open) return;
    setOpen(null);
    const { state } = view;
    const end = state.selection.$from.end();
    view.dispatch(state.tr.delete(open.start, end));
    item.run(view);
    view.focus();
  };

  // Keys, before ProseMirror sees them; a click elsewhere closes.
  useEffect(() => {
    if (!open) return;
    const host = view.dom.parentElement ?? view.dom;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)
        return;
      if (e.key === "Escape") setOpen(null);
      else if (!items.length) return;
      else if (e.key === "ArrowDown") setActive((active + 1) % items.length);
      else if (e.key === "ArrowUp")
        setActive((active - 1 + items.length) % items.length);
      else if (e.key === "Enter") choose(items[active] ?? items[0]);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node)) setOpen(null);
    };
    host.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      host.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  });

  if (!open || !items.length) return null;
  const { x, y } = anchor(view, open.start);
  return (
    <div
      ref={panel}
      role="listbox"
      aria-label="Insert block"
      style={{ position: "fixed", left: x, top: y }}
      className={MENU_PANEL + " z-40 max-h-[50vh] overflow-y-auto"}
    >
      {items.map((item, i) => (
        <div
          key={item.label}
          role="option"
          aria-selected={i === active}
          onMouseEnter={() => setActive(i)}
          // The editor keeps the focus.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => choose(item)}
          className={menuRow(i === active)}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
