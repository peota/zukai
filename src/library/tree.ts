import { detectPlatform } from "../app/shortcuts";
import type { AddedState, Entry } from "./api";

export interface TreeState {
  root: string | null;
  children: Record<string, Entry[] | "loading">;
  expanded: Set<string>;
  selected: string | null;
  /** The added folders, in the order added. */
  added: AddedState[];
}

export interface Row {
  entry: Entry;
  depth: number;
  /** Set only on an added folder's own row. */
  heading?: { available: boolean };
}

/** Paths compare case-insensitively on Windows only. */
const CASE_INSENSITIVE = detectPlatform() === "windows";

function trimSeps(p: string): string {
  return p.replace(/[\\/]+$/, "");
}

/**
 * The root of `roots` that `path` is, or is inside (by whole path
 * segments), or null when it's under none.
 */
export function rootOf(
  path: string,
  roots: string[],
  caseInsensitive = CASE_INSENSITIVE,
): string | null {
  const p = caseInsensitive ? path.toLowerCase() : path;
  for (const root of roots) {
    const r = trimSeps(caseInsensitive ? root.toLowerCase() : root);
    if (p === r) return root;
    const c = p[r.length];
    if (p.startsWith(r) && (c === "/" || c === "\\")) return root;
  }
  return null;
}

/** An added folder's own row. */
function headingRow(a: AddedState): Row {
  const path = a.path;
  return {
    entry: { name: lastSegment(trimSeps(path)), path, isDir: true, link: null },
    depth: 0,
    heading: { available: a.available },
  };
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

/**
 * Pre-order rows of the root's listing, descending only into expanded dirs;
 * then each added folder's heading, followed by its rows (one level deeper)
 * when it's expanded and available.
 */
export function visibleRows(s: TreeState): Row[] {
  const kidsOf = (e: Entry) => {
    if (!e.isDir || !s.expanded.has(e.path)) return null;
    const kids = s.children[e.path];
    return Array.isArray(kids) ? kids : null;
  };
  const rootList = s.root === null ? undefined : s.children[s.root];
  const rows = Array.isArray(rootList)
    ? walk<Entry>(rootList, (e) => e, kidsOf)
    : [];
  for (const a of s.added) {
    const head = headingRow(a);
    rows.push(head);
    if (!a.available) continue;
    const kids = kidsOf(head.entry);
    if (!kids) continue;
    for (const r of walk<Entry>(kids, (e) => e, kidsOf)) {
      rows.push({ ...r, depth: r.depth + 1 });
    }
  }
  return rows;
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
    added: s.added.map((a) => {
      const path = rewrite(a.path, from, to);
      return path === a.path ? a : { ...a, path };
    }),
  };
}

interface Node {
  entry: Entry;
  kids: Node[];
}

/**
 * Search results as tree rows, each preceded by its ancestor folders,
 * grouped by the root each is under: `roots[0]` is the Library, the rest
 * added folders, whose results follow their heading row one level deeper.
 * Results under no root are dropped.
 */
export function filterRows(results: Entry[], roots: string[]): Row[] {
  const groups = new Map<string, Entry[]>(roots.map((r) => [r, []]));
  for (const e of results) {
    const root = rootOf(e.path, roots);
    if (root !== null) groups.get(root)!.push(e);
  }
  const rows: Row[] = [];
  roots.forEach((root, i) => {
    const found = groups.get(root)!;
    if (i > 0) {
      if (found.length === 0) return;
      rows.push(headingRow({ path: root, available: true }));
    }
    for (const r of rootRows(found, root)) {
      rows.push(i === 0 ? r : { ...r, depth: r.depth + 1 });
    }
  });
  return rows;
}

/** Rows of results under one root, each preceded by its ancestor folders. */
function rootRows(results: Entry[], root: string): Row[] {
  const base = trimSeps(root);
  const found = new Map<string, Entry>();
  for (const e of results) found.set(e.path, e);
  const nodes = new Map<string, Node>();
  const top: Node[] = [];

  for (const e of results) {
    const c = e.path[base.length];
    if (c !== "/" && c !== "\\") continue;
    const rel = e.path.slice(base.length + 1).split(/[\\/]/);
    let siblings = top;
    // The result's own spelling of the root (it may differ in case).
    let path = e.path.slice(0, base.length);
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
