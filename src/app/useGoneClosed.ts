import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fileFingerprint, fileFingerprintQuick } from "../files/api";
import type { ClosedEntry } from "../model/types";
import { logError } from "./workspaceEffects";

interface Target {
  id: string;
  path: string;
  entry: ClosedEntry;
}

/** True when `entry`'s File no longer exists. A failed check keeps it. */
async function isGone(entry: ClosedEntry): Promise<boolean> {
  const file = entry.tab.file;
  if (!file) return false;
  try {
    const disk = file.fingerprint
      ? await fileFingerprintQuick(file.path, file.fingerprint)
      : await fileFingerprint(file.path);
    return disk === null;
  } catch (err) {
    logError("check closed file")(err);
    return false;
  }
}

/**
 * The ids of Recently Closed File entries listed in `recent` whose File was
 * deleted, so the Recent list can leave them out. Checked when those entries
 * change, when the window gets focus, and on `recheck` (after a Library
 * delete, which no watcher reports for closed Files).
 */
export function useGoneClosed(
  recent: readonly string[],
  closed: readonly ClosedEntry[],
): { gone: ReadonlySet<string>; recheck: () => void } {
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const wanted = new Set(recent);
  const targets: Target[] = closed.flatMap((entry) =>
    entry.tab.file && wanted.has(entry.tab.id)
      ? [{ id: entry.tab.id, path: entry.tab.file.path, entry }]
      : [],
  );
  // Re-check only when the set of (id, path) pairs changes.
  const sig = targets.map((t) => `${t.id}\u0000${t.path}`).join("\u0001");
  const targetsRef = useRef(targets);
  // Declared before the check below, so that check sees the latest targets.
  useEffect(() => {
    targetsRef.current = targets;
  });
  const gen = useRef(0);

  const recheck = useCallback(() => {
    const mine = ++gen.current;
    const now = targetsRef.current;
    void Promise.all(now.map((t) => isGone(t.entry))).then((flags) => {
      if (mine !== gen.current) return;
      const next = new Set(now.filter((_, i) => flags[i]).map((t) => t.id));
      setGone((prev) =>
        prev.size === next.size && [...next].every((id) => prev.has(id))
          ? prev
          : next,
      );
    });
  }, []);

  useEffect(recheck, [sig, recheck]);

  useEffect(() => {
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, [recheck]);

  return useMemo(() => ({ gone, recheck }), [gone, recheck]);
}
