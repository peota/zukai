// A File's format (Encoding, BOM, Line ending) as editor state, so a Convert
// is an undoable step: undo puts the old format back, and the listener in
// EditorHost reports each change so the File is written in that form.
import {
  StateEffect,
  StateField,
  type Extension,
  type StateEffectType,
} from "@codemirror/state";
import { invertedEffects } from "@codemirror/commands";
import type { FileFormat } from "../model/types";

/** A Convert (recorded in history; undo emits the inverse). */
export const setFormat: StateEffectType<FileFormat> =
  StateEffect.define<FileFormat>();

/** Follows a format change made elsewhere (a reload); never in history. */
export const syncFormat: StateEffectType<FileFormat | null> =
  StateEffect.define<FileFormat | null>();

export const formatField: StateField<FileFormat | null> =
  StateField.define<FileFormat | null>({
    create: () => null,
    update(value, tr) {
      for (const e of tr.effects) {
        if (e.is(setFormat) || e.is(syncFormat)) value = e.value;
      }
      return value;
    },
  });

const invert = invertedEffects.of((tr) => {
  if (!tr.effects.some((e) => e.is(setFormat))) return [];
  const before = tr.startState.field(formatField);
  return before ? [setFormat.of(before)] : [];
});

/** `initial` is the Tab's File format, or null for a Scratchpad. */
export function formatExtension(initial: FileFormat | null): Extension {
  return [formatField.init(() => initial), invert];
}
