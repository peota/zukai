import { parentOf } from "../ui/libraryEntries";

/** The last segment of a path that uses `/` or `\`. */
function baseOf(p: string): string {
  const t = p.replace(/[\\/]+$/, "");
  return t.slice(Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\")) + 1);
}

/**
 * Tab labels for terminals opened in `cwds`: the folder name, or
 * "name · parent" when two folders share a name.
 */
export function tabLabels(cwds: string[]): string[] {
  const bases = cwds.map(baseOf);
  return cwds.map((cwd, i) => {
    const base = bases[i];
    if (bases.filter((b) => b === base).length < 2) return base;
    const parent = baseOf(parentOf(cwd));
    return parent ? `${base} · ${parent}` : base;
  });
}
