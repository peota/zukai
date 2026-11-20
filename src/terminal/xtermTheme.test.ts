import { describe, expect, it } from "vitest";
import { ANSI, xtermTheme, type Palette } from "./xtermTheme";

const PALETTES: Palette[] = [
  "paper",
  "solar-light",
  "graphite",
  "midnight",
  "solar-dark",
];

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

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

  it("everyForegroundColourIsLegibleOnItsEditorBackground", () => {
    const bg: Record<Palette, string> = {
      paper: "#ffffff",
      "solar-light": "#fbf8f2",
      graphite: "#1f1f23",
      midnight: "#131925",
      "solar-dark": "#211f1b",
    };
    for (const p of PALETTES) {
      ANSI[p].forEach((c, i) => {
        // Plain black on a dark palette is a background colour by design.
        if (i === 0 && !["paper", "solar-light"].includes(p)) return;
        expect(contrast(c, bg[p]), `${p}[${i}] ${c}`).toBeGreaterThanOrEqual(3);
      });
    }
  });
});
