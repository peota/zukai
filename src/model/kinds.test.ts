import { describe, expect, it } from "vitest";
import { kindOf } from "./kinds";

describe("kindOf", () => {
  it("kindOfByExtension", () => {
    expect(kindOf("a.EXCALIDRAW")).toBe("canvas");
    expect(kindOf("x.PNG")).toBe("image");
    expect(kindOf("x.svg")).toBe("image");
    expect(kindOf("x.md")).toBe("text");
    expect(kindOf("Makefile")).toBe("text");
    expect(kindOf("C:\\d.png\\Makefile")).toBe("text");
  });
});
