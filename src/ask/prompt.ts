export const NOTE_LIMIT = 200_000;

export function buildSystem(note: {
  title: string;
  language: string;
  text: string;
}): string | { tooLong: true } {
  if (note.text.length > NOTE_LIMIT) return { tooLong: true };
  return [
    "You answer questions about the note below. Answer from the note only.",
    "If the note does not contain the answer, say so plainly instead of guessing.",
    "The text [hidden] marks text the user chose to hide from you. Do not guess what it said.",
    "",
    `Title: ${note.title}`,
    `Language: ${note.language}`,
    "",
    "<note>",
    note.text,
    "</note>",
  ].join("\n");
}
