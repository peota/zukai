/**
 * Spec 5.1: open Files with the same name show their parent folder. When the
 * parents collide too, walk up until each File's hint is unique among its
 * namesakes. Names compare with the platform's case rules (`keyOf`).
 * Returns a hint per id, only for Files that share a name.
 */
export function folderHints(
  files: readonly { id: string; path: string }[],
  keyOf: (path: string) => string,
): Map<string, string> {
  const hints = new Map<string, string>();
  const groups = new Map<
    string,
    { id: string; dirs: string[]; sep: string }[]
  >();
  for (const f of files) {
    const sep = f.path.includes("\\") ? "\\" : "/";
    const parts = f.path.split(/[\\/]/).filter((p) => p !== "");
    const name = parts.pop() ?? "";
    const key = keyOf(name);
    const group = groups.get(key) ?? [];
    group.push({ id: f.id, dirs: parts, sep });
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const tail = (dirs: string[], d: number) => dirs.slice(-d);
    for (const me of group) {
      let d = 1;
      for (; d < me.dirs.length; d++) {
        const mine = keyOf(tail(me.dirs, d).join("/"));
        const clash = group.some(
          (o) => o !== me && keyOf(tail(o.dirs, d).join("/")) === mine,
        );
        if (!clash) break;
      }
      hints.set(me.id, tail(me.dirs, d).join(me.sep));
    }
  }
  return hints;
}
