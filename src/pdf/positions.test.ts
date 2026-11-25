import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "../app/shortcuts";
import {
  MAX_ENTRIES,
  createPdfPositionStore,
  parsePositions,
  serializePositions,
  type PdfPosition,
} from "./positions";

const pos = (over: Partial<PdfPosition> = {}): PdfPosition => ({
  page: 1,
  offsetInPage: 0.5,
  zoom: 1,
  updatedAt: 1,
  ...over,
});

describe("parsePositions / serializePositions", () => {
  it("returns an empty map for garbage or null", () => {
    expect(parsePositions("{broken").size).toBe(0);
    expect(parsePositions(null).size).toBe(0);
    expect(parsePositions("[1,2]").size).toBe(0);
  });

  it("drops malformed entries and keeps siblings", () => {
    const json = JSON.stringify({
      bad1: pos({ page: 0 }),
      bad2: { ...pos(), zoom: "huge" },
      bad3: pos({ offsetInPage: 1.5 }),
      bad4: pos({ zoom: 9 }),
      ok: pos({ page: 3, zoom: "fit-width" }),
    });
    const m = parsePositions(json);
    expect([...m.keys()]).toEqual(["ok"]);
    expect(m.get("ok")?.page).toBe(3);
  });

  it("keeps the 500 newest entries when serializing 501", () => {
    const m = new Map<string, PdfPosition>();
    for (let i = 0; i <= MAX_ENTRIES; i++)
      m.set(`k${i}`, pos({ updatedAt: i }));
    const out = parsePositions(serializePositions(m));
    expect(out.size).toBe(MAX_ENTRIES);
    expect(out.has("k0")).toBe(false);
    expect(out.has("k500")).toBe(true);
  });
});

describe("createPdfPositionStore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (
    initial: string | null = null,
    platform: Platform = "windows",
  ) => {
    const io = {
      read: vi.fn(async () => initial),
      write: vi.fn<(json: string) => Promise<void>>(async () => {}),
    };
    let t = 100;
    const store = createPdfPositionStore(
      io,
      () => t++,
      () => platform,
    );
    return { io, store };
  };

  it("debounces: two sets within 1000 ms write once with the latest", async () => {
    const { io, store } = make();
    store.set("/a.pdf", { page: 1, offsetInPage: 0, zoom: 1 });
    store.set("/a.pdf", { page: 7, offsetInPage: 0.2, zoom: 2 });
    await vi.advanceTimersByTimeAsync(999);
    expect(io.write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(io.write).toHaveBeenCalledTimes(1);
    const written = parsePositions(io.write.mock.calls[0][0]);
    expect(written.get("/a.pdf")?.page).toBe(7);
  });

  it("is case-insensitive on windows", async () => {
    const { store } = make();
    store.set("C:\\A.pdf", { page: 4, offsetInPage: 0, zoom: 1 });
    expect((await store.get("c:\\a.pdf"))?.page).toBe(4);
  });

  it("is case-sensitive on other platforms", async () => {
    const { store } = make(null, "other");
    store.set("/A.pdf", { page: 4, offsetInPage: 0, zoom: 1 });
    expect(await store.get("/a.pdf")).toBeUndefined();
  });

  it("flush writes a pending set immediately", async () => {
    const { io, store } = make();
    store.set("/a.pdf", { page: 2, offsetInPage: 0, zoom: 1 });
    await store.flush();
    expect(io.write).toHaveBeenCalledTimes(1);
  });

  it("set before load merges into existing entries and loads once", async () => {
    const existing = JSON.stringify({ "/old.pdf": pos({ page: 9 }) });
    const { io, store } = make(existing);
    store.set("/new.pdf", { page: 2, offsetInPage: 0, zoom: 1 });
    await store.flush();
    const written = parsePositions(io.write.mock.calls[0][0]);
    expect(written.get("/old.pdf")?.page).toBe(9);
    expect(written.get("/new.pdf")?.page).toBe(2);
    await store.get("/old.pdf");
    expect(io.read).toHaveBeenCalledTimes(1);
  });

  it("never writes while the read is failing, then merges once it succeeds", async () => {
    const existing = JSON.stringify({ "/old.pdf": pos({ page: 9 }) });
    const { io, store } = make(existing);
    io.read.mockRejectedValue(new Error("locked"));
    store.set("/new.pdf", { page: 2, offsetInPage: 0, zoom: 1 });
    await store.flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(io.write).not.toHaveBeenCalled();
    expect((await store.get("/new.pdf"))?.page).toBe(2);
    io.read.mockResolvedValue(existing);
    await store.flush();
    expect(io.write).toHaveBeenCalledTimes(1);
    const written = parsePositions(io.write.mock.calls[0][0]);
    expect(written.get("/old.pdf")?.page).toBe(9);
    expect(written.get("/new.pdf")?.page).toBe(2);
  });
});
