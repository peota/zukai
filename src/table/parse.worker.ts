/** Parses a table off the main thread. Imports only the parser. */
import { readTable, type Delimiter } from "./parse";

interface Request {
  text: string;
  path: string;
  override?: Delimiter;
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { text, path, override } = e.data;
  self.postMessage(readTable(text, path, override));
};
