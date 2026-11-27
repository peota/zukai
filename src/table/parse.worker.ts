/** Parses a table off the main thread. Imports only the parser. */
import { readTable, type Delimiter } from "./parse";
import type { CheckResult } from "./parseAsync";

export interface ParseRequest {
  text: string;
  path: string;
  override?: Delimiter;
  /** Only whether the text reads (and where it fails): no table back. */
  check?: boolean;
}

/** The reply to one request. */
export function answer(req: ParseRequest) {
  const r = readTable(req.text, req.path, req.override);
  if (!req.check) return r;
  const out: CheckResult = r.ok
    ? { ok: true }
    : { ok: false, line: r.line, reason: r.reason };
  return out;
}

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  self.postMessage(answer(e.data));
};
