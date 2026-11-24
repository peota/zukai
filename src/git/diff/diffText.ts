/** The most a diff shows on either side, in UTF-8 bytes (1 MB). */
export const DIFF_MAX_BYTES = 1_048_576;

/**
 * `text` with every line ending as LF, so a CRLF ↔ LF change alone is no
 * change in a diff.
 */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
