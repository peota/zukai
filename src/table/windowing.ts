/**
 * offsets is cumulative (length n+1, offsets[0]=0). Returns [first, last) with
 * `overscan` items each side.
 */
export function visibleRange(
  offsets: readonly number[],
  scroll: number,
  viewport: number,
  overscan: number,
): [number, number] {
  const n = offsets.length - 1;
  if (n <= 0) return [0, 0];
  // first: the item containing `scroll` (last i with offsets[i] <= scroll).
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= scroll) lo = mid;
    else hi = mid - 1;
  }
  const first = lo;
  // last: the first i with offsets[i] >= scroll + viewport (exclusive end).
  const end = scroll + viewport;
  lo = first;
  hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] >= end) hi = mid;
    else lo = mid + 1;
  }
  const last = Math.max(lo, first + 1);
  return [Math.max(0, first - overscan), Math.min(n, last + overscan)];
}
