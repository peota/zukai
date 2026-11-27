/** How many lines are read to work out a file's indentation. */
const SAMPLE_LINES = 1000;

/**
 * The indent unit for a Python file: a tab when most indented lines start
 * with one, otherwise the most common step (2 to 8 spaces) between a line and
 * a more indented one below it, and 4 spaces (PEP 8) when the file shows
 * neither.
 */
export function detectIndentUnit(text: string): string {
  let tabs = 0;
  let spaced = 0;
  const steps = new Map<number, number>();
  let prev = 0;
  const lines = text.split("\n", SAMPLE_LINES);
  for (const line of lines) {
    if (line.trim() === "") continue;
    const lead = /^[ \t]*/.exec(line)![0];
    if (lead.startsWith("\t")) {
      tabs++;
      continue;
    }
    if (lead.length > 0) spaced++;
    const step = lead.length - prev;
    if (step >= 2 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1);
    prev = lead.length;
  }
  if (tabs > spaced) return "\t";
  let best = 0;
  let bestCount = 0;
  for (const [step, count] of steps) {
    if (count > bestCount || (count === bestCount && step < best)) {
      best = step;
      bestCount = count;
    }
  }
  return best ? " ".repeat(best) : "    ";
}
