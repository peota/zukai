export const HIDDEN_MARK = "[hidden]";

/**
 * Replaces each run of hidden `[from, to)` ranges (UTF-16 offsets) with one
 * `[hidden]`. Ranges may be unsorted, overlapping, touching or past the end.
 */
export function redact(
  text: string,
  hidden: readonly [number, number][],
): string {
  const ranges = hidden
    .map(([a, b]): [number, number] => [
      Math.max(0, Math.min(a, text.length)),
      Math.max(0, Math.min(b, text.length)),
    ])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);

  const merged: [number, number][] = [];
  for (const [a, b] of ranges) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }

  let out = "";
  let pos = 0;
  for (const [a, b] of merged) {
    out += text.slice(pos, a) + HIDDEN_MARK;
    pos = b;
  }
  return out + text.slice(pos);
}
