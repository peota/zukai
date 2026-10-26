import { describe, expect, it } from "vitest";
import { EditorState, type Transaction } from "@codemirror/state";
import { history, redo, undo } from "@codemirror/commands";
import type { FileFormat } from "../model/types";
import { formatExtension, formatField, setFormat } from "./fileFormat";

const CRLF: FileFormat = {
  encoding: "utf-8",
  bom: false,
  lineEnding: "crlf",
  mixed: false,
};
const LF: FileFormat = { ...CRLF, lineEnding: "lf" };

function harness(initial: FileFormat | null) {
  let state = EditorState.create({
    extensions: [history(), formatExtension(initial)],
  });
  const seen: Transaction[] = [];
  const dispatch = (tr: Transaction) => {
    seen.push(tr);
    state = tr.state;
  };
  return {
    get state() {
      return state;
    },
    dispatch,
    seen,
    run(cmd: typeof undo) {
      return cmd({ state, dispatch });
    },
  };
}

describe("fileFormat", () => {
  it("setFormatIsUndoable", () => {
    const h = harness(CRLF);
    expect(h.state.field(formatField)).toEqual(CRLF);
    h.dispatch(h.state.update({ effects: setFormat.of(LF) }));
    expect(h.state.field(formatField)).toEqual(LF);

    expect(h.run(undo)).toBe(true);
    expect(h.state.field(formatField)).toEqual(CRLF);
    // The undo itself carries the inverse effect, so it can be reported.
    const last = h.seen[h.seen.length - 1];
    expect(last.effects.find((e) => e.is(setFormat))?.value).toEqual(CRLF);

    expect(h.run(redo)).toBe(true);
    expect(h.state.field(formatField)).toEqual(LF);
  });

  it("holds null for a Scratchpad", () => {
    expect(harness(null).state.field(formatField)).toBeNull();
  });
});
