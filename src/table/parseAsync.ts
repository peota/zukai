import { readTable, type Delimiter, type ParseResult } from "./parse";

/** Longer texts (UTF-16 units) are parsed in a worker. */
export const WORKER_THRESHOLD = 2_000_000;

/** Parses off the main thread when text.length > 2_000_000 (UTF-16 units). */
export function parseAsync(
  text: string,
  path: string,
  override?: Delimiter,
): Promise<ParseResult> {
  if (text.length <= WORKER_THRESHOLD || typeof Worker === "undefined") {
    return Promise.resolve(readTable(text, path, override));
  }
  return new Promise<ParseResult>((resolve, reject) => {
    const worker = new Worker(new URL("./parse.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<ParseResult>) => {
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
    worker.postMessage({ text, path, override });
  });
}
