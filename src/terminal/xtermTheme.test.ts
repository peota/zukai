import { describe, expect, it } from "vitest";
import { ANSI, xtermTheme, type Palette } from "./xtermTheme";

const PALETTES: Palette[] = [
  "paper",
  "solar-light",
  "graphite",
  "midnight",
  "solar-dark",
];

describe("xtermTheme", () => {
  it("everyPaletteHasSixteenHexColours", () => {
    for (const p of PALETTES) {
      expect(ANSI[p]).toHaveLength(16);
      for (const c of ANSI[p]) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("themeReadsEditorTokens", () => {
    const tokens: Record<string, string> = {
      "--z-editor": "#111111",
      "--z-text": "#eeeeee",
      "--z-accent": "#2563eb",
      "--z-row-sel": "rgb(1 2 3 / 0.1)",
    };
    const t = xtermTheme("graphite", (n) => tokens[n] ?? "");
    expect(t.background).toBe("#111111");
    expect(t.foreground).toBe("#eeeeee");
    expect(t.cursor).toBe("#2563eb");
    expect(t.selectionBackground).toBe("rgb(1 2 3 / 0.1)");
    expect(t.red).toBe(ANSI.graphite[1]);
    expect(t.brightWhite).toBe(ANSI.graphite[15]);
  });
});
