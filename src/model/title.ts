import type { TabState } from "./types";

const MAX_TITLE = 30;
const SCAN_LIMIT = 64 * 1024;
const LINE_LIMIT = 4096;

/** First non-empty line (trimmed), cut to 30 code points with an ellipsis. Scans a bounded prefix only. */
export function deriveTitle(content: string): string {
  const s =
    content.length > SCAN_LIMIT ? content.slice(0, SCAN_LIMIT) : content;
  let pos = 0;
  while (pos < s.length) {
    const nl = s.indexOf("\n", pos);
    const lineEnd = nl === -1 ? s.length : nl;
    const line = s.slice(pos, Math.min(lineEnd, pos + LINE_LIMIT)).trim();
    if (line) return cut(line);
    pos = lineEnd + 1;
  }
  return "Untitled";
}

function cut(line: string): string {
  let count = 0;
  let i = 0;
  while (i < line.length && count < MAX_TITLE) {
    const cp = line.codePointAt(i)!;
    i += cp > 0xffff ? 2 : 1;
    count++;
  }
  if (i >= line.length) return line;
  return line.slice(0, i) + "…";
}

export function displayTitle(
  tab: TabState,
  content: string | undefined,
): string {
  if (tab.renamed || content === undefined) return tab.title;
  return deriveTitle(content);
}
