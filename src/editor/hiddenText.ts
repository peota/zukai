import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { invertedEffects } from "@codemirror/commands";

/**
 * Hidden text: ranges the user marked (a password, a token) are drawn as
 * dots, like a password field. Only the display changes: the text itself,
 * copy, find and saving are untouched. The ranges follow edits and are kept
 * in the Session as offsets, never as text.
 */

/** A hidden range, [from, to) in document offsets. */
export type HiddenRange = readonly [number, number];

/** Replace every hidden range (loading a Tab). */
const setHidden = StateEffect.define<readonly HiddenRange[]>();
/** Hide these ranges, merged with any they touch. */
const addHidden = StateEffect.define<readonly HiddenRange[]>({
  map: (rs, ch) =>
    rs.map(([a, b]) => [ch.mapPos(a, 1), ch.mapPos(b, -1)] as HiddenRange),
});
/** Show again every hidden range that meets one of these. */
const removeHidden = StateEffect.define<readonly HiddenRange[]>({
  map: (rs, ch) =>
    rs.map(([a, b]) => [ch.mapPos(a, -1), ch.mapPos(b, 1)] as HiddenRange),
});

const mark = Decoration.mark({ class: "z-hidden-text" });

function toList(set: DecorationSet): HiddenRange[] {
  const out: HiddenRange[] = [];
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to) => {
    if (to > from) out.push([from, to]);
  });
  return out;
}

/** Sorted, clamped to the document, with touching ranges merged. */
function normalize(rs: readonly HiddenRange[], length: number): HiddenRange[] {
  const sorted = rs
    .map(([a, b]) => [
      Math.max(0, Math.min(length, Math.min(a, b) | 0)),
      Math.max(0, Math.min(length, Math.max(a, b) | 0)),
    ])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const build = (rs: readonly HiddenRange[]): DecorationSet =>
  Decoration.set(rs.map(([a, b]) => mark.range(a, b)));

/** Does [a, b) meet [from, to]? An empty one meets a range it's inside of. */
const meets = (a: number, b: number, from: number, to: number) =>
  from === to ? from >= a && from <= b : from < b && to > a;

export const hiddenField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let set = value.map(tr.changes);
    for (const fx of tr.effects) {
      const length = tr.state.doc.length;
      if (fx.is(setHidden)) {
        set = build(normalize(fx.value, length));
      } else if (fx.is(addHidden)) {
        set = build(normalize([...toList(set), ...fx.value], length));
      } else if (fx.is(removeHidden)) {
        const gone = fx.value;
        set = build(
          toList(set).filter(
            ([a, b]) => !gone.some(([from, to]) => meets(a, b, from, to)),
          ),
        );
      }
    }
    return set;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** The hidden ranges, sorted and not touching. */
export const hiddenRanges = (state: EditorState): HiddenRange[] =>
  toList(state.field(hiddenField, false) ?? Decoration.none);

/** Effect to load a Tab's saved ranges (clamped to its text). */
export const loadHidden = (rs: readonly HiddenRange[]) => setHidden.of(rs);

/** Whether the selection is in hidden text: then the action is Unhide. */
export function selectionHidden(state: EditorState): boolean {
  const hidden = hiddenRanges(state);
  return state.selection.ranges.some((r) =>
    hidden.some(([a, b]) => meets(a, b, r.from, r.to)),
  );
}

/** Whether Hide/Unhide would do anything here. */
export function canToggleHidden(state: EditorState): boolean {
  return selectionHidden(state) || state.selection.ranges.some((r) => !r.empty);
}

/**
 * Hide the selected text, or, if the selection is in hidden text, show
 * every hidden range it meets. Returns whether anything changed.
 */
export function toggleHidden(view: EditorView): boolean {
  const { state } = view;
  const ranges = state.selection.ranges.map(
    (r) => [r.from, r.to] as HiddenRange,
  );
  if (selectionHidden(state)) {
    view.dispatch({ effects: removeHidden.of(ranges) });
    return true;
  }
  const picked = ranges.filter(([a, b]) => b > a);
  if (picked.length === 0) return false;
  view.dispatch({ effects: addHidden.of(picked) });
  return true;
}

/**
 * Undoing the deletion of hidden text hides it again, so Mod+Z never
 * shows a password that was deleted.
 */
const restoreOnUndo = invertedEffects.of((tr) => {
  if (!tr.docChanged) return [];
  const lost = toList(tr.startState.field(hiddenField)).filter(([a, b]) =>
    tr.changes.touchesRange(a, b),
  );
  return lost.length > 0 ? [addHidden.of(lost)] : [];
});

const hiddenTheme = EditorView.baseTheme({
  ".z-hidden-text": {
    WebkitTextSecurity: "disc",
    textSecurity: "disc",
    color: "var(--z-faint)",
  },
});

export const hiddenTextExtension: Extension = [
  hiddenField,
  restoreOnUndo,
  hiddenTheme,
];
