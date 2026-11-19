/**
 * The rich editor's editing commands, over its ProseMirror view: what the
 * toolbar, the "/" menu, the table control and the keys run. Each one
 * dispatches an ordinary (user) transaction, so its result is written to the
 * Tab's text like typing. Each returns whether it applied.
 */
import {
  lift,
  setBlockType,
  toggleMark as pmToggleMark,
  wrapIn,
} from "@milkdown/kit/prose/commands";
import type {
  Mark,
  Node,
  NodeType,
  ResolvedPos,
} from "@milkdown/kit/prose/model";
import { liftListItem } from "@milkdown/kit/prose/schema-list";
import {
  Selection,
  type Command,
  type EditorState,
  type Transaction,
} from "@milkdown/kit/prose/state";
import {
  addColumnAfter,
  addColumnBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  selectedRect,
  TableMap,
} from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";

export type BlockKind = "paragraph" | "h1" | "h2" | "h3";
export type MarkKind = "bold" | "italic" | "strike" | "code";
export type ListKind = "bullet" | "ordered" | "task";
export type InsertKind = "quote" | "code" | "rule" | "table";
export type TableAction =
  | "rowAbove"
  | "rowBelow"
  | "colLeft"
  | "colRight"
  | "delRow"
  | "delCol"
  | "delTable";

/** The Milkdown mark names. */
const MARKS: Record<MarkKind | "link", string> = {
  bold: "strong",
  italic: "emphasis",
  strike: "strike_through",
  code: "inlineCode",
  link: "link",
};

const run = (view: EditorView, cmd: Command) =>
  cmd(view.state, view.dispatch, view);

const nodes = (state: EditorState) => state.schema.nodes;

/** The innermost list around the cursor, with its position and kind. */
function listAt($pos: ResolvedPos) {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    const name = node.type.name;
    if (name !== "bullet_list" && name !== "ordered_list") continue;
    const task =
      name === "bullet_list" && node.firstChild?.attrs.checked != null;
    const kind: ListKind =
      name === "ordered_list" ? "ordered" : task ? "task" : "bullet";
    return { node, pos: $pos.before(d), kind };
  }
  return null;
}

/** Whether the cursor is in a table cell. */
const inCell = ($pos: ResolvedPos) => {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.spec.tableRole) return true;
  }
  return false;
};

/** A list's items made tight, and task items (or not) as `kind` says. */
function setItems(tr: Transaction, list: Node, pos: number, kind: ListKind) {
  list.forEach((item, offset) => {
    if (item.type.name !== "list_item") return;
    const checked =
      kind === "task"
        ? ((item.attrs.checked as boolean | null) ?? false)
        : null;
    tr.setNodeMarkup(pos + 1 + offset, undefined, {
      ...item.attrs,
      spread: false,
      checked,
    });
  });
}

export function setBlock(view: EditorView, kind: BlockKind): boolean {
  const { paragraph, heading } = nodes(view.state);
  return kind === "paragraph"
    ? run(view, setBlockType(paragraph))
    : run(view, setBlockType(heading, { level: Number(kind[1]) }));
}

export function toggleMark(view: EditorView, kind: MarkKind): boolean {
  const type = view.state.schema.marks[MARKS[kind]];
  if (view.state.selection.$from.parent.type.spec.code) return false;
  return run(view, pmToggleMark(type));
}

/** The extent of the link `mark` around `$pos`, if any. */
function linkAround($pos: ResolvedPos, mark: Mark) {
  const start = $pos.start();
  const runs: { from: number; to: number }[] = [];
  let cur: { from: number; to: number } | null = null;
  $pos.parent.forEach((child, offset) => {
    const a = start + offset;
    const b = a + child.nodeSize;
    if (!mark.isInSet(child.marks)) cur = null;
    else if (cur && cur.to === a) cur.to = b;
    else runs.push((cur = { from: a, to: b }));
  });
  return runs.find((r) => r.from <= $pos.pos && $pos.pos <= r.to) ?? null;
}

/**
 * Links the selection to `href` (an empty `href` unlinks it). With no
 * selection, it changes the link at the cursor, or inserts `href` as linked
 * text.
 */
export function setLink(view: EditorView, href: string): boolean {
  const { state } = view;
  const type = state.schema.marks[MARKS.link];
  const { from, to, empty, $from } = state.selection;
  if ($from.parent.type.spec.code) return false;
  href = href.trim();
  const tr = state.tr;
  let range: { from: number; to: number } | null = { from, to };
  if (empty) {
    const current = type.isInSet($from.marks());
    range = current ? linkAround($from, current) : null;
  }
  if (range) {
    tr.removeMark(range.from, range.to, type);
    if (href) tr.addMark(range.from, range.to, type.create({ href }));
  } else if (href) {
    tr.insertText(href, from);
    tr.addMark(from, from + href.length, type.create({ href }));
  } else {
    return false;
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Makes the selected blocks a list of `kind`; the same kind again turns the
 * list item back into its paragraphs, another kind changes the list.
 */
export function wrapList(view: EditorView, kind: ListKind): boolean {
  const { state } = view;
  const n = nodes(state);
  const type = kind === "ordered" ? n.ordered_list : n.bullet_list;
  const list = listAt(state.selection.$from);
  if (list?.kind === kind) return run(view, liftListItem(n.list_item));
  if (list) {
    const tr = state.tr.setNodeMarkup(list.pos, type);
    setItems(tr, list.node, list.pos, kind);
    view.dispatch(tr);
    return true;
  }
  if (inCell(state.selection.$from)) return false;
  return run(view, (s, dispatch) =>
    wrapIn(type)(
      s,
      dispatch &&
        ((tr) => {
          const made = listAt(tr.selection.$from);
          if (made) setItems(tr, made.node, made.pos, kind);
          dispatch(tr);
        }),
    ),
  );
}

/** An empty paragraph's position (before it), if the cursor is in one. */
function emptyParagraph(state: EditorState): number | null {
  const { $from, empty } = state.selection;
  const p = $from.parent;
  return empty && p.type.name === "paragraph" && p.content.size === 0
    ? $from.before()
    : null;
}

/** 3 columns × 2 rows, the first a header row; no column is aligned. */
function newTable(state: EditorState): Node {
  const n = nodes(state);
  const cells = (type: NodeType) =>
    [0, 1, 2].map(() => type.createAndFill({ alignment: null })!);
  return n.table.create(null, [
    n.table_header_row.create(null, cells(n.table_header)),
    n.table_row.create(null, cells(n.table_cell)),
  ]);
}

/**
 * Puts `block` in place of the empty paragraph at the cursor, or after the
 * cursor's block. A paragraph follows a rule, for the cursor; the cursor goes
 * into a table's first cell.
 */
function placeBlock(view: EditorView, block: Node): boolean {
  const { state } = view;
  const { $from } = state.selection;
  if (inCell($from) || $from.depth < 1) return false;
  const rule = block.type.name === "hr";
  const add = rule ? [block, nodes(state).paragraph.create()] : [block];
  const at = emptyParagraph(state);
  const tr = state.tr;
  let pos: number;
  if (at !== null) {
    pos = at;
    tr.replaceWith(at, at + $from.parent.nodeSize, add);
  } else {
    pos = $from.after();
    tr.insert(pos, add);
  }
  const inside = rule ? pos + block.nodeSize : pos;
  const sel = Selection.findFrom(tr.doc.resolve(inside), 1, true);
  if (sel) tr.setSelection(sel);
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * A quote (wrapping the selected blocks, or unwrapping them), a code block
 * (from the cursor's block, or back to a paragraph), a rule or a table.
 */
export function insertBlock(view: EditorView, kind: InsertKind): boolean {
  const { state } = view;
  const n = nodes(state);
  const { $from } = state.selection;
  switch (kind) {
    case "quote": {
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === n.blockquote) return run(view, lift);
      }
      if (inCell($from)) return false;
      return run(view, wrapIn(n.blockquote));
    }
    case "code":
      if (inCell($from)) return false;
      return $from.parent.type === n.code_block
        ? run(view, setBlockType(n.paragraph))
        : run(view, setBlockType(n.code_block, { language: "" }));
    case "rule":
      return placeBlock(view, n.hr.create());
    case "table":
      return placeBlock(view, newTable(state));
  }
}

/** Adds a body row at `index` (never above the header row). */
const addRow =
  (below: boolean): Command =>
  (state, dispatch) => {
    if (!isInTable(state)) return false;
    const rect = selectedRect(state);
    const index = below ? rect.bottom : rect.top;
    if (index === 0) return false;
    if (dispatch) {
      const { table, tableStart, map } = rect;
      let pos = tableStart;
      for (let i = 0; i < index; i++) pos += table.child(i).nodeSize;
      const n = nodes(state);
      const header = table.firstChild!;
      const cells = Array.from({ length: map.width }, (_, i) =>
        n.table_cell.createAndFill({
          alignment: header.maybeChild(i)?.attrs.alignment ?? null,
        })!,
      );
      dispatch(state.tr.insert(pos, n.table_row.create(null, cells)));
    }
    return true;
  };

/** Adds a column, aligned as none, beside the cursor's. */
const addCol =
  (right: boolean): Command =>
  (state, dispatch) => {
    if (!isInTable(state)) return false;
    const add = right ? addColumnAfter : addColumnBefore;
    if (!dispatch) return add(state);
    const { left, right: end, tableStart } = selectedRect(state);
    const col = right ? end : left;
    return add(state, (tr) => {
      // The new cells (one per row) take no alignment.
      const table = tr.doc.nodeAt(tableStart - 1)!;
      const map = TableMap.get(table);
      for (let row = 0; row < map.height; row++) {
        const at = tableStart + map.positionAt(row, col, table);
        const cell = tr.doc.nodeAt(at);
        if (cell) {
          tr.setNodeMarkup(at, undefined, { ...cell.attrs, alignment: null });
        }
      }
      dispatch(tr);
    });
  };

/** Deletes the cursor's body row(s); never the header, never the last row. */
const delRow: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const rect = selectedRect(state);
  if (rect.top === 0) return false;
  if (rect.bottom - rect.top >= rect.map.height - 1) return false;
  return deleteRow(state, dispatch);
};

const TABLE: Record<TableAction, Command> = {
  rowAbove: addRow(false),
  rowBelow: addRow(true),
  colLeft: addCol(false),
  colRight: addCol(true),
  delRow,
  delCol: deleteColumn,
  delTable: deleteTable,
};

export function table(view: EditorView, action: TableAction): boolean {
  return run(view, TABLE[action]);
}

/** Whether `action` can apply now. */
export function canTable(state: EditorState, action: TableAction): boolean {
  return TABLE[action](state);
}

export interface Active {
  /** The cursor's text block: a paragraph, heading, code block or other. */
  block: BlockKind | "h4" | "h5" | "h6" | "code" | "other";
  /** Marks at the cursor, or anywhere in the selection. */
  marks: Set<MarkKind | "link">;
  inTable: boolean;
  /** The innermost list around the cursor. */
  list: ListKind | null;
  inQuote: boolean;
}

export function active(view: EditorView): Active {
  return activeIn(view.state);
}

export function activeIn(state: EditorState): Active {
  const { $from, from, to, empty } = state.selection;
  const parent = $from.parent;
  const name = parent.type.name;
  const block: Active["block"] =
    name === "paragraph"
      ? "paragraph"
      : name === "heading"
        ? (`h${parent.attrs.level as number}` as Active["block"])
        : name === "code_block"
          ? "code"
          : "other";
  const marks = new Set<MarkKind | "link">();
  const here = empty ? (state.storedMarks ?? $from.marks()) : null;
  for (const [kind, markName] of Object.entries(MARKS)) {
    const type = state.schema.marks[markName];
    if (!type) continue;
    const on = here
      ? !!type.isInSet(here)
      : state.doc.rangeHasMark(from, to, type);
    if (on) marks.add(kind as MarkKind | "link");
  }
  let inQuote = false;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "blockquote") inQuote = true;
  }
  return {
    block,
    marks,
    inTable: isInTable(state),
    list: listAt($from)?.kind ?? null,
    inQuote,
  };
}

/** A block the toolbar and the "/" menu offer. */
export interface BlockItem {
  label: string;
  /** More words the "/" menu matches. */
  keywords: string;
  run(view: EditorView): boolean;
  /** Whether the cursor is in one already. */
  on(a: Active): boolean;
}

/** Sets a heading, or turns the same heading back into a paragraph. */
const heading = (kind: "h1" | "h2" | "h3") => (view: EditorView) =>
  setBlock(view, activeIn(view.state).block === kind ? "paragraph" : kind);

export const BLOCK_ITEMS: Record<BlockKind | ListKind | InsertKind, BlockItem> =
  {
    paragraph: {
      label: "Paragraph",
      keywords: "text plain",
      run: (v) => setBlock(v, "paragraph"),
      on: (a) => a.block === "paragraph",
    },
    h1: {
      label: "Heading 1",
      keywords: "h1 title",
      run: heading("h1"),
      on: (a) => a.block === "h1",
    },
    h2: {
      label: "Heading 2",
      keywords: "h2 subtitle",
      run: heading("h2"),
      on: (a) => a.block === "h2",
    },
    h3: {
      label: "Heading 3",
      keywords: "h3",
      run: heading("h3"),
      on: (a) => a.block === "h3",
    },
    bullet: {
      label: "Bulleted list",
      keywords: "bullet unordered ul",
      run: (v) => wrapList(v, "bullet"),
      on: (a) => a.list === "bullet",
    },
    ordered: {
      label: "Numbered list",
      keywords: "ordered ol",
      run: (v) => wrapList(v, "ordered"),
      on: (a) => a.list === "ordered",
    },
    task: {
      label: "Checklist",
      keywords: "task todo checkbox",
      run: (v) => wrapList(v, "task"),
      on: (a) => a.list === "task",
    },
    quote: {
      label: "Quote",
      keywords: "blockquote",
      run: (v) => insertBlock(v, "quote"),
      on: (a) => a.inQuote,
    },
    code: {
      label: "Code block",
      keywords: "fence pre",
      run: (v) => insertBlock(v, "code"),
      on: (a) => a.block === "code",
    },
    table: {
      label: "Table",
      keywords: "grid",
      run: (v) => insertBlock(v, "table"),
      on: () => false,
    },
    rule: {
      label: "Horizontal rule",
      keywords: "divider hr line separator",
      run: (v) => insertBlock(v, "rule"),
      on: () => false,
    },
  };
