import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without globals, so Testing Library can't register this itself.
afterEach(cleanup);

// jsdom has no layout for Ranges; CodeMirror measures them when it scrolls a
// change into view.
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  const empty = () => [] as unknown as DOMRectList;
  Range.prototype.getClientRects = empty;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
