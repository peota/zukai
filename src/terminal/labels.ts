import { parentOf } from "../ui/libraryEntries";

/** The last segment of a path that uses `/` or `\`. */
function baseOf(p: string): string {
  const t = p.replace(/[\\/]+$/, "");
  return t.slice(Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\")) + 1);
}

/**
 * Tab labels for `terms`: the folder name, or "name · parent" when two
 * folders share a name (judged across all tabs). An agent's name goes first.
 */
export function tabLabels(terms: { cwd: string; agent?: string }[]): string[] {
  const bases = terms.map((t) => baseOf(t.cwd));
  return terms.map(({ cwd, agent }, i) => {
    const base = bases[i];
    let label = base;
    if (bases.filter((b) => b === base).length >= 2) {
      const parent = baseOf(parentOf(cwd));
      if (parent) label = `${base} · ${parent}`;
    }
    return agent ? `${agent} · ${label}` : label;
  });
}
