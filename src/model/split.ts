import { clampSplit } from "./settings";
import type {
  Split,
  SplitOrientation,
  TabState,
  WorkspaceState,
} from "./types";

/** The Split that Tab `id` is in (as either member). */
export function splitOf(s: WorkspaceState, id: string): Split | undefined {
  return s.splits?.find((sp) => sp.a === id || sp.b === id);
}

export function otherHalf(sp: Split, id: string): string {
  return sp.a === id ? sp.b : sp.a;
}

/**
 * The tab bar's items in order: a Split is one item [a, b], any other Tab
 * one [id]. `splits` must be normalized (b right after a, both open).
 */
export function itemsOf(tabs: TabState[], splits: Split[] = []): string[][] {
  const second = new Set(splits.map((sp) => sp.b));
  const partner = new Map(splits.map((sp) => [sp.a, sp.b]));
  const items: string[][] = [];
  for (const t of tabs) {
    if (second.has(t.id)) continue;
    const b = partner.get(t.id);
    items.push(b === undefined ? [t.id] : [t.id, b]);
  }
  return items;
}

const sameSplit = (x: Split, y: Split) =>
  x.a === y.a &&
  x.b === y.b &&
  x.orientation === y.orientation &&
  x.ratio === y.ratio &&
  x.focus === y.focus;

/**
 * Drops Splits that name a missing, repeated or identical Tab; moves each b
 * next to its a, shares a's pin with b, and focuses the member that is
 * `activeId`. Returns `s` itself when nothing changes.
 */
export function normalizeSplits(s: WorkspaceState): WorkspaceState {
  if (s.splits === undefined) return s;
  const open = new Set(s.tabs.map((t) => t.id));
  const used = new Set<string>();
  const splits = s.splits
    .filter((sp) => {
      if (
        sp.a === sp.b ||
        !open.has(sp.a) ||
        !open.has(sp.b) ||
        used.has(sp.a) ||
        used.has(sp.b)
      ) {
        return false;
      }
      used.add(sp.a);
      used.add(sp.b);
      return true;
    })
    .map((sp): Split => {
      if (sp.a === s.activeId && sp.focus !== "a") return { ...sp, focus: "a" };
      if (sp.b === s.activeId && sp.focus !== "b") return { ...sp, focus: "b" };
      return sp;
    });
  const byId = new Map(s.tabs.map((t) => [t.id, t]));
  /** Each member's pin: the Split's, never a diff Tab's. */
  const pinOf = new Map<string, boolean>();
  for (const sp of splits) {
    const a = byId.get(sp.a)!;
    const b = byId.get(sp.b)!;
    // A diff Tab is never pinned: the other member holds the Split's pin.
    const pin = a.kind === "diff" ? !!b.pinned : !!a.pinned;
    pinOf.set(sp.a, pin);
    pinOf.set(sp.b, pin);
  }
  const tabs = itemsOf(s.tabs, splits)
    .flat()
    .map((id) => {
      const t = byId.get(id)!;
      const want = pinOf.get(id);
      const pin = t.kind === "diff" ? false : want;
      return pin === undefined || !!t.pinned === pin
        ? t
        : { ...t, pinned: pin };
    });
  const unchanged =
    splits.length === s.splits.length &&
    splits.every((sp, i) => sp === s.splits![i]) &&
    tabs.every((t, i) => t === s.tabs[i]);
  return unchanged ? s : { ...s, tabs, splits };
}

/** Pinned items first (a Split stays whole), each group in its own order. */
export function pinnedFirst(s: WorkspaceState): WorkspaceState {
  const byId = new Map(s.tabs.map((t) => [t.id, t]));
  const items = itemsOf(s.tabs, s.splits);
  // A Split's pin is on its members that aren't diff Tabs.
  const isPinned = (it: string[]) => it.some((id) => byId.get(id)?.pinned);
  const pinned = items.filter(isPinned);
  if (pinned.length === 0 || items.slice(0, pinned.length).every(isPinned)) {
    return s;
  }
  const order = [...pinned, ...items.filter((it) => !pinned.includes(it))];
  return { ...s, tabs: order.flat().map((id) => byId.get(id)!) };
}

/**
 * Joins Tab `b` to Tab `a`, next to it; both are pinned if either was (a
 * diff Tab never is).
 */
export function makeSplit(
  s: WorkspaceState,
  a: string,
  b: string,
  orientation: SplitOrientation = "row",
): WorkspaceState {
  const tabA = s.tabs.find((t) => t.id === a);
  const tabB = s.tabs.find((t) => t.id === b);
  if (!tabA || !tabB || a === b || splitOf(s, a) || splitOf(s, b)) return s;
  const focus = s.activeId === b ? "b" : "a";
  const pinned = !!tabA.pinned || !!tabB.pinned;
  const rest = s.tabs.filter((t) => t.id !== b);
  const at = rest.indexOf(tabA) + 1;
  const pinOf = (t: TabState) => pinned && t.kind !== "diff";
  const tabs = [
    ...rest.slice(0, at),
    { ...tabB, pinned: pinOf(tabB) },
    ...rest.slice(at),
  ].map((t) =>
    t.id === a && !!t.pinned !== pinOf(t) ? { ...t, pinned: pinOf(t) } : t,
  );
  const split: Split = { a, b, orientation, ratio: 0.5, focus };
  return pinnedFirst(
    normalizeSplits({
      ...s,
      tabs,
      activeId: focus === "a" ? a : b,
      splits: [...(s.splits ?? []), split],
    }),
  );
}

/** Ends the Split holding `id`; both Tabs stay open. */
export function unsplit(s: WorkspaceState, id: string): WorkspaceState {
  const sp = splitOf(s, id);
  if (!sp) return s;
  return { ...s, splits: s.splits!.filter((x) => x !== sp) };
}

function updateSplit(
  s: WorkspaceState,
  id: string,
  fn: (sp: Split) => Split,
): WorkspaceState {
  const sp = splitOf(s, id);
  if (!sp) return s;
  const next = fn(sp);
  if (sameSplit(sp, next)) return s;
  return normalizeSplits({
    ...s,
    splits: s.splits!.map((x) => (x === sp ? next : x)),
  });
}

/** Swaps the halves: the focused Tab stays focused. */
export function swapSides(s: WorkspaceState, id: string): WorkspaceState {
  return updateSplit(s, id, (sp) => ({
    ...sp,
    a: sp.b,
    b: sp.a,
    focus: sp.focus === "a" ? "b" : "a",
  }));
}

export function setOrientation(
  s: WorkspaceState,
  id: string,
  orientation: SplitOrientation,
): WorkspaceState {
  return updateSplit(s, id, (sp) => ({ ...sp, orientation }));
}

export function setSplitRatio(
  s: WorkspaceState,
  id: string,
  ratio: number,
): WorkspaceState {
  return updateSplit(s, id, (sp) => ({ ...sp, ratio: clampSplit(ratio) }));
}
