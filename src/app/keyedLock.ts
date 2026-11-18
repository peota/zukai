/**
 * Runs async work one at a time per key. Autosave writes and File actions
 * (reload, Keep mine, Save As, rename, disk-change checks) share one lock per
 * Tab, so no write lands between an action's check and its effect.
 * Work under a lock must never wait for other work under the same key.
 */
export type KeyedLock = <T>(key: string, work: () => Promise<T>) => Promise<T>;

export function createKeyedLock(): KeyedLock {
  const tails = new Map<string, Promise<unknown>>();
  return (key, work) => {
    const prev = tails.get(key) ?? Promise.resolve();
    const run = prev.then(work, work);
    const tail = run.catch(() => {});
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}
