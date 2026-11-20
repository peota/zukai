import type { AddedState } from "../library/api";
import { isUnder, parentOf } from "../ui/libraryEntries";
import type { TermInfo } from "./model";

/** Whether `p` is `base` itself or inside it. */
function within(p: string, base: string): boolean {
  return (
    p.replace(/[\\/]+$/, "") === base.replace(/[\\/]+$/, "") || isUnder(p, base)
  );
}

/**
 * The folder a new terminal opens in: the active File's folder when it lies
 * in an available root, else the Library root, else the first available added
 * folder. Never the home folder; `null` when nothing is available.
 */
export function defaultFolder(i: {
  activeFile?: string;
  root: string | null;
  rootAvailable: boolean;
  added: AddedState[];
}): string | null {
  const roots: string[] = [];
  if (i.root !== null && i.rootAvailable) roots.push(i.root);
  for (const a of i.added) if (a.available) roots.push(a.path);
  if (i.activeFile && roots.some((r) => isUnder(i.activeFile!, r))) {
    return parentOf(i.activeFile);
  }
  return roots[0] ?? null;
}

/**
 * The folder the "+" button opens in: the active terminal's folder while it is
 * still under a granted root, otherwise `fallback`.
 */
export function plusFolder(
  active: TermInfo | undefined,
  grantedRoots: string[],
  fallback: string | null,
): string | null {
  if (active && grantedRoots.some((r) => within(active.cwd, r))) {
    return active.cwd;
  }
  return fallback;
}
