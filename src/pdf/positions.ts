import { detectPlatform, type Platform } from "../app/shortcuts";
import { pathKey } from "../files/api";
import { createSaver } from "../storage/autosave";
import { readPdfPositions, writePdfPositions } from "../storage/api";

export type PdfZoom = number | "fit-width";
export interface PdfPosition {
  page: number;
  offsetInPage: number;
  zoom: PdfZoom;
  updatedAt: number;
}

export const MAX_ENTRIES = 500;
const SAVE_ID = "pdf-positions";
const SAVE_DELAY_MS = 1000;

function isValid(v: unknown): v is PdfPosition {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  const zoomOk =
    p.zoom === "fit-width" ||
    (typeof p.zoom === "number" &&
      Number.isFinite(p.zoom) &&
      p.zoom >= 0.25 &&
      p.zoom <= 5);
  return (
    typeof p.page === "number" &&
    Number.isInteger(p.page) &&
    p.page >= 1 &&
    typeof p.offsetInPage === "number" &&
    p.offsetInPage >= 0 &&
    p.offsetInPage <= 1 &&
    zoomOk &&
    typeof p.updatedAt === "number" &&
    Number.isFinite(p.updatedAt)
  );
}

/** Malformed entries are dropped; unparseable input yields an empty map. */
export function parsePositions(json: string | null): Map<string, PdfPosition> {
  const out = new Map<string, PdfPosition>();
  if (json === null) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return out;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [key, v] of Object.entries(raw)) {
    if (isValid(v)) {
      out.set(key, {
        page: v.page,
        offsetInPage: v.offsetInPage,
        zoom: v.zoom,
        updatedAt: v.updatedAt,
      });
    }
  }
  return out;
}

/** Newest first, capped at MAX_ENTRIES. */
export function serializePositions(m: Map<string, PdfPosition>): string {
  const newest = [...m].sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return JSON.stringify(Object.fromEntries(newest.slice(0, MAX_ENTRIES)));
}

export interface PdfPositionStore {
  /** Loads the file once, lazily. */
  get(path: string): Promise<PdfPosition | undefined>;
  /** Debounced (1000 ms) write; merged into the loaded entries. */
  set(path: string, pos: Omit<PdfPosition, "updatedAt">): void;
  flush(): Promise<void>;
}

export function createPdfPositionStore(
  io: {
    read(): Promise<string | null>;
    write(json: string): Promise<void>;
  } = { read: readPdfPositions, write: writePdfPositions },
  now: () => number = Date.now,
  platform: () => Platform = detectPlatform,
): PdfPositionStore {
  const saver = createSaver((_id, json) => io.write(json), SAVE_DELAY_MS);
  let map = new Map<string, PdfPosition>();
  let loaded = false;
  // Sets made while the on-disk contents are unknown (not loaded yet, or the
  // read failed). They are merged into the loaded map once a read succeeds.
  const pending = new Map<string, PdfPosition>();
  // Serializes loading and merging, so a set made before the load finishes is
  // merged into the loaded map instead of clobbering it.
  let chain: Promise<void> = Promise.resolve();

  // A failed read leaves the store unloaded (retried on the next call) and
  // nothing is written, so a transient read error cannot wipe saved positions.
  const sync = async (): Promise<void> => {
    if (!loaded) {
      try {
        map = parsePositions(await io.read());
        loaded = true;
      } catch {
        return;
      }
    }
    if (pending.size === 0) return;
    for (const [k, v] of pending) map.set(k, v);
    pending.clear();
    saver.schedule(SAVE_ID, () => serializePositions(map));
  };

  const enqueue = (): void => {
    chain = chain.then(sync);
  };

  return {
    async get(path) {
      const key = pathKey(path, platform());
      enqueue();
      await chain;
      return pending.get(key) ?? map.get(key);
    },
    set(path, pos) {
      pending.set(pathKey(path, platform()), { ...pos, updatedAt: now() });
      enqueue();
    },
    async flush() {
      enqueue();
      await chain;
      if (loaded) await saver.flush(SAVE_ID);
    },
  };
}

/** The app's store; touches no Tauri API until first used. */
export const pdfPositions: PdfPositionStore = createPdfPositionStore();
