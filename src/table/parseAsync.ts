import { readTable, type Delimiter, type ParseResult } from "./parse";
import type { ParseRequest } from "./parse.worker";

/** Longer texts (UTF-16 units) are parsed in a worker. */
export const WORKER_THRESHOLD = 2_000_000;

/** Whether a text reads as a table, without the table. */
export type CheckResult =
  | { ok: true }
  | { ok: false; line: number; reason: "unclosedQuote" | "inconsistent" };

/** Runs one request in a fresh worker. */
function inWorker<T>(req: ParseRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL("./parse.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<T>) => {
      worker.terminate();
      resolve(e.data);
    };
    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error("table parse reply could not be read"));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "table parse failed"));
    };
    worker.postMessage(req);
  });
}

const inline = (text: string) =>
  text.length <= WORKER_THRESHOLD || typeof Worker === "undefined";

/** Parses off the main thread when text.length > 2_000_000 (UTF-16 units). */
export function parseAsync(
  text: string,
  path: string,
  override?: Delimiter,
): Promise<ParseResult> {
  if (inline(text)) return Promise.resolve(readTable(text, path, override));
  return inWorker<ParseResult>({ text, path, override });
}

/**
 * Whether the text reads as a table, and where it fails. Like parseAsync,
 * but a worker sends back only the answer, never the table.
 */
export function checkAsync(
  text: string,
  path: string,
  override?: Delimiter,
): Promise<CheckResult> {
  if (inline(text)) {
    const r = readTable(text, path, override);
    return Promise.resolve(
      r.ok ? { ok: true } : { ok: false, line: r.line, reason: r.reason },
    );
  }
  return inWorker<CheckResult>({ text, path, override, check: true });
}
