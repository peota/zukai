import { writeSession } from "./api";

export const SAVE_DEBOUNCE_MS = 300;
export const SESSION_SAVE_DEBOUNCE_MS = 500;
export const SESSION_ID = "__session__";

export type SaveStatus = "saved" | "pending" | "error";

export interface Saver {
  /** Debounced per id; the latest getContent wins. Ignored while the id is stopped. */
  schedule(id: string, getContent: () => string): void;
  /** Write pending (and retry failed) content now, and wait for in-flight writes. */
  flush(id?: string): Promise<void>;
  /** Flush id, then ignore further schedules for it until resume. */
  stop(id: string): Promise<void>;
  resume(id: string): void;
  /** "error" if any id's last write failed. */
  status(): SaveStatus;
  onStatus(cb: (s: SaveStatus) => void): () => void;
}

interface Entry {
  /** Latest content source; kept after a write so a failed write can be retried. */
  getContent: (() => string) | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** Writes queued or running (serializes writes for this id). */
  queued: number;
  chain: Promise<void>;
  failed: boolean;
  lastError: unknown;
  stopped: boolean;
}

export function createSaver(
  write: (id: string, content: string) => Promise<void>,
  delayMs: number = SAVE_DEBOUNCE_MS,
): Saver {
  const entries = new Map<string, Entry>();
  const listeners = new Set<(s: SaveStatus) => void>();
  let last: SaveStatus = "saved";

  const entry = (id: string): Entry => {
    let e = entries.get(id);
    if (!e) {
      e = {
        getContent: null,
        timer: null,
        queued: 0,
        chain: Promise.resolve(),
        failed: false,
        lastError: undefined,
        stopped: false,
      };
      entries.set(id, e);
    }
    return e;
  };

  const compute = (): SaveStatus => {
    let pending = false;
    for (const e of entries.values()) {
      if (e.failed) return "error";
      if (e.timer !== null || e.queued > 0) pending = true;
    }
    return pending ? "pending" : "saved";
  };

  const emit = (): void => {
    const s = compute();
    if (s === last) return;
    last = s;
    for (const cb of [...listeners]) cb(s);
  };

  /** Queue a write behind any earlier write for this id; reads content when it starts. */
  const enqueue = (id: string, e: Entry): Promise<void> => {
    if (e.timer !== null) {
      clearTimeout(e.timer);
      e.timer = null;
    }
    const getContent = e.getContent;
    if (!getContent) return e.chain;
    e.queued++;
    e.chain = e.chain.then(async () => {
      try {
        await write(id, getContent());
        e.failed = false;
      } catch (err) {
        e.failed = true;
        e.lastError = err;
      } finally {
        e.queued--;
        emit();
      }
    });
    return e.chain;
  };

  const flushEntry = async (id: string, e: Entry): Promise<void> => {
    if (e.timer !== null || (e.failed && e.queued === 0)) {
      void enqueue(id, e);
    }
    await e.chain;
    emit();
    if (e.failed) throw e.lastError;
  };

  return {
    schedule(id, getContent) {
      const e = entry(id);
      if (e.stopped) return;
      e.getContent = getContent;
      if (e.timer !== null) clearTimeout(e.timer);
      e.timer = setTimeout(() => {
        e.timer = null;
        void enqueue(id, e);
      }, delayMs);
      emit();
    },
    async flush(id) {
      if (id !== undefined) {
        const e = entries.get(id);
        if (e) await flushEntry(id, e);
        return;
      }
      const results = await Promise.allSettled(
        [...entries].map(([eid, e]) => flushEntry(eid, e)),
      );
      const bad = results.find((r) => r.status === "rejected");
      if (bad) throw (bad as PromiseRejectedResult).reason;
    },
    async stop(id) {
      const e = entry(id);
      // Stop first so a schedule arriving mid-flush cannot arm a new timer.
      e.stopped = true;
      try {
        await flushEntry(id, e);
      } catch (err) {
        e.stopped = false; // keep autosave retrying; caller must abort the close
        throw err;
      }
    },
    resume(id) {
      entry(id).stopped = false;
    },
    status: compute,
    onStatus(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

/** Session saver: fixed id, 500 ms debounce, routed to writeSession. */
export const sessionSaver: Saver = createSaver(
  (_id, content) => writeSession(content),
  SESSION_SAVE_DEBOUNCE_MS,
);
