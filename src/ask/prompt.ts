export const NOTE_LIMIT = 200_000;

/**
 * `text` must already be redacted (hidden ranges replaced); the limit is
 * measured on the redacted text. A closing note tag inside the text is
 * neutralised so the note can't break out of its block.
 */
export function buildSystem(note: {
  title: string;
  language: string;
  text: string;
}): string | { tooLong: true } {
  if (note.text.length > NOTE_LIMIT) return { tooLong: true };
  const line = (s: string) => s.replace(/[\r\n]+/g, " ");
  const text = note.text.replace(/<\/note/gi, "<\\/note");
  return [
    "You answer questions about the note below. Answer from the note only.",
    "If the note does not contain the answer, say so plainly instead of guessing.",
    "The text [hidden] marks text the user chose to hide from you. Do not guess what it said.",
    "",
    `Title: ${line(note.title)}`,
    `Language: ${line(note.language)}`,
    "",
    "<note>",
    text,
    "</note>",
  ].join("\n");
}
