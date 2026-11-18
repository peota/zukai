import type { Entry } from "./api";

export interface TreeState {
  root: string | null;
  children: Record<string, Entry[] | "loading">;
  expanded: Set<string>;
  selected: string | null;
}

export interface Row {
  entry: Entry;
  depth: number;
}

export function setChildren(
  s: TreeState,
  dir: string,
  entries: Entry[],
): TreeState {
  return { ...s, children: { ...s.children, [dir]: entries } };
}

export function toggle(s: TreeState, dir: string): TreeState {
  const expanded = new Set(s.expanded);
  if (!expanded.delete(dir)) expanded.add(dir);
  return { ...s, expanded };
}

interface Frame<T> {
  list: T[];
  i: number;
  depth: number;
}

/** Pre-order walk with an explicit stack: linear in the rows produced. */
function walk<T>(
  top: T[],
  entryOf: (t: T) => Entry,
  kidsOf: (t: T) => T[] | null,
): Row[] {
  const rows: Row[] = [];
  const stack: Frame<T>[] = [{ list: top, i: 0, depth: 0 }];
  while (stack.length > 0) {
    const f = stack[stack.length - 1];
    if (f.i >= f.list.length) {
      stack.pop();
      continue;
    }
    const item = f.list[f.i++];
    rows.push({ entry: entryOf(item), depth: f.depth });
    const kids = kidsOf(item);
    if (kids && kids.length > 0) {
      stack.push({ list: kids, i: 0, depth: f.depth + 1 });
    }
  }
  return rows;
}

/** Pre-order rows of the root's listing, descending only into expanded dirs. */
export function visibleRows(s: TreeState): Row[] {
  if (s.root === null) return [];
  const rootList = s.children[s.root];
  if (!Array.isArray(rootList)) return [];
  return walk<Entry>(
    rootList,
    (e) => e,
    (e) => {
      if (!e.isDir || !s.expanded.has(e.path)) return null;
      const kids = s.children[e.path];
      return Array.isArray(kids) ? kids : null;
    },
  );
}

/**
 * Applies a watcher event. Dirs that are shown (the root, or loaded and
 * expanded) are returned to reload, keeping their old rows meanwhile; loaded
 * but collapsed dirs drop their cache so expanding them lists afresh.
 */
export function invalidate(
  s: TreeState,
  dirs: string[],
): { state: TreeState; reload: string[] } {
  const reload: string[] = [];
  let children = s.children;
  for (const dir of new Set(dirs)) {
    if (!Object.prototype.hasOwnProperty.call(s.children, dir)) continue;
    if (dir === s.root || s.expanded.has(dir)) {
      reload.push(dir);
    } else {
      if (children === s.children) children = { ...children };
      delete children[dir];
    }
  }
  return { state: children === s.children ? s : { ...s, children }, reload };
}

function rewrite(p: string, from: string, to: string): string {
  if (p === from) return to;
  if (p.startsWith(from)) {
    const c = p[from.length];
    if (c === "/" || c === "\\") return to + p.slice(from.length);
  }
  return p;
}

function lastSegment(p: string): string {
  return p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);
}

/** After a folder move/rename: every cached path under `from` now lives under `to`. */
export function rewritePrefix(
  s: TreeState,
  from: string,
  to: string,
): TreeState {
  const children: TreeState["children"] = {};
  for (const [dir, list] of Object.entries(s.children)) {
    children[rewrite(dir, from, to)] =
      list === "loading"
        ? list
        : list.map((e) => {
            const path = rewrite(e.path, from, to);
            if (path === e.path) return e;
            return { ...e, path, name: path === to ? lastSegment(to) : e.name };
          });
  }
  return {
    ...s,
    root: s.root === null ? null : rewrite(s.root, from, to),
    children,
    expanded: new Set([...s.expanded].map((p) => rewrite(p, from, to))),
    selected: s.selected === null ? null : rewrite(s.selected, from, to),
  };
}

interface Node {
  entry: Entry;
  kids: Node[];
}

/** Search results as tree rows, each preceded by its ancestor folders (under `root`). */
export function filterRows(results: Entry[], root: string): Row[] {
  const base = root.replace(/[\\/]+$/, "");
  const found = new Map<string, Entry>();
  for (const e of results) found.set(e.path, e);
  const nodes = new Map<string, Node>();
  const top: Node[] = [];

  for (const e of results) {
    const c = e.path[base.length];
    if (!e.path.startsWith(base) || (c !== "/" && c !== "\\")) continue;
    const rel = e.path.slice(base.length + 1).split(/[\\/]/);
    let siblings = top;
    let path = base;
    for (let i = 0; i < rel.length; i++) {
      path += c + rel[i];
      let n = nodes.get(path);
      if (!n) {
        const entry =
          found.get(path) ??
          ({ name: rel[i], path, isDir: true, link: null } as Entry);
        n = { entry, kids: [] };
        nodes.set(path, n);
        siblings.push(n);
      }
      siblings = n.kids;
    }
  }
  return walk<Node>(
    top,
    (n) => n.entry,
    (n) => n.kids,
  );
}
