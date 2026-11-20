import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import {
  canToggleHidden,
  hiddenRanges,
  hiddenTextExtension,
  loadHidden,
  selectionHidden,
  toggleHidden,
} from "./hiddenText";

function viewOf(doc: string, anchor: number, head = anchor) {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [history(), hiddenTextExtension],
    }),
  });
}

describe("hidden text", () => {
  it("hides the selection and draws it masked", () => {
    const v = viewOf("token: abc123 end", 7, 13);
    expect(canToggleHidden(v.state)).toBe(true);
    expect(toggleHidden(v)).toBe(true);
    expect(hiddenRanges(v.state)).toEqual([[7, 13]]);
    const masked = v.contentDOM.querySelector(".z-hidden-text");
    expect(masked?.textContent).toBe("abc123");
    // The text itself is untouched.
    expect(v.state.doc.toString()).toBe("token: abc123 end");
  });

  it("unhides when the cursor is inside hidden text", () => {
    const v = viewOf("token: abc123 end", 7, 13);
    toggleHidden(v);
    v.dispatch({ selection: { anchor: 9 } });
    expect(selectionHidden(v.state)).toBe(true);
    toggleHidden(v);
    expect(hiddenRanges(v.state)).toEqual([]);
  });

  it("does nothing with an empty cursor outside hidden text", () => {
    const v = viewOf("plain", 2);
    expect(canToggleHidden(v.state)).toBe(false);
    expect(toggleHidden(v)).toBe(false);
  });

  it("follows edits before the range", () => {
    const v = viewOf("a secret", 2, 8);
    toggleHidden(v);
    v.dispatch({ changes: { from: 0, insert: ">> " } });
    expect(hiddenRanges(v.state)).toEqual([[5, 11]]);
  });

  it("merges overlapping hides", () => {
    const v = viewOf("0123456789", 1, 5);
    toggleHidden(v);
    v.dispatch({ selection: { anchor: 6, head: 9 } });
    toggleHidden(v);
    expect(hiddenRanges(v.state)).toEqual([
      [1, 5],
      [6, 9],
    ]);
    v.dispatch({ selection: { anchor: 3, head: 7 } });
    // Meets both: the action is Unhide, and it shows both.
    expect(selectionHidden(v.state)).toBe(true);
    toggleHidden(v);
    expect(hiddenRanges(v.state)).toEqual([]);
  });

  it("hides deleted text again on undo", () => {
    const v = viewOf("pw: hunter2", 4, 11);
    toggleHidden(v);
    v.dispatch({ changes: { from: 4, to: 11 }, userEvent: "delete" });
    expect(hiddenRanges(v.state)).toEqual([]);
    undo(v);
    expect(v.state.doc.toString()).toBe("pw: hunter2");
    expect(hiddenRanges(v.state)).toEqual([[4, 11]]);
  });

  it("loads saved ranges clamped to the text", () => {
    const v = viewOf("short", 0);
    v.dispatch({
      effects: loadHidden([
        [1, 3],
        [4, 99],
        [7, 9],
      ]),
    });
    expect(hiddenRanges(v.state)).toEqual([
      [1, 3],
      [4, 5],
    ]);
  });
});
