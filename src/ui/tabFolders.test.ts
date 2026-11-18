import { describe, expect, it } from "vitest";
import { folderHints } from "./tabFolders";

const lower = (p: string) => p.toLowerCase();
const exact = (p: string) => p;

describe("folderHints", () => {
  it("leaves unique names alone", () => {
    const hints = folderHints(
      [
        { id: "a", path: "C:\\x\\a.json" },
        { id: "b", path: "C:\\x\\b.json" },
      ],
      lower,
    );
    expect(hints.size).toBe(0);
  });

  it("names the parent folder of each same-named File", () => {
    const hints = folderHints(
      [
        { id: "a", path: "C:\\work\\api\\config.json" },
        { id: "b", path: "C:\\work\\web\\Config.json" },
        { id: "c", path: "C:\\work\\web\\other.json" },
      ],
      lower,
    );
    expect(hints.get("a")).toBe("api");
    expect(hints.get("b")).toBe("web");
    expect(hints.has("c")).toBe(false);
  });

  it("compares names with the platform's case rules", () => {
    const hints = folderHints(
      [
        { id: "a", path: "/home/u/api/config.json" },
        { id: "b", path: "/home/u/web/Config.json" },
      ],
      exact,
    );
    expect(hints.size).toBe(0);
  });

  it("walks up when the parent folders collide too", () => {
    const hints = folderHints(
      [
        { id: "a", path: "/one/src/index.ts" },
        { id: "b", path: "/two/src/index.ts" },
        { id: "c", path: "/two/lib/index.ts" },
      ],
      exact,
    );
    expect(hints.get("a")).toBe("one/src");
    expect(hints.get("b")).toBe("two/src");
    expect(hints.get("c")).toBe("lib");
  });

  it("folder collisions follow the case rules", () => {
    const hints = folderHints(
      [
        { id: "a", path: "C:\\One\\SRC\\x.txt" },
        { id: "b", path: "C:\\two\\src\\x.txt" },
      ],
      lower,
    );
    expect(hints.get("a")).toBe("One\\SRC");
    expect(hints.get("b")).toBe("two\\src");
  });
});
