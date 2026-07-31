// test/engine/text/layout.test.ts
//
// layout.ts's pure layout engine, exhaustively, against a small hand-built
// FontMetrics fixture with known advances/kerning (design doc §4C: "unit-
// tested against known strings — advances, kerning pairs, line counts").

import { describe, expect, it } from "vitest";
import { layout } from "@/lib/engine/gl/text/layout";
import type { FontMetrics } from "@/lib/engine/gl/text/font";

// size=10 -> fontSize:10 gives scale=1, so expected numbers are exact
// integers instead of scaled fractions.
function fixtureMetrics(): FontMetrics {
  const glyphs = new Map<string, { id: number; x: number; y: number; width: number; height: number; xoffset: number; yoffset: number; xadvance: number }>();
  glyphs.set("A", { id: 65, x: 0, y: 0, width: 8, height: 8, xoffset: 0, yoffset: 0, xadvance: 10 });
  glyphs.set("B", { id: 66, x: 8, y: 0, width: 8, height: 8, xoffset: 0, yoffset: 0, xadvance: 10 });
  glyphs.set("V", { id: 86, x: 16, y: 0, width: 8, height: 8, xoffset: 0, yoffset: 0, xadvance: 9 });
  glyphs.set(" ", { id: 32, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 5 });

  const kernings = new Map<string, number>();
  kernings.set("AV", -2);

  return { glyphs, kernings, size: 10, lineHeight: 12, base: 10, scaleW: 32, scaleH: 8 };
}

describe("layout", () => {
  it("packs one 8-float quad per renderable glyph, in reading order", () => {
    const font = fixtureMetrics();
    const result = layout("AB", font, { fontSize: 10 });

    expect(result.glyphCount).toBe(2);
    expect(result.quads.length).toBe(2 * 8);
    expect(result.lines).toBe(1);

    // Glyph 'A': x,y,w,h,u0,v0,u1,v1
    expect(Array.from(result.quads.slice(0, 8))).toEqual([0, 0, 8, 8, 0, 0, 0.25, 1]);
    // Glyph 'B' starts at pen x = A's xadvance (10), atlas offset x=8/32.
    expect(Array.from(result.quads.slice(8, 16))).toEqual([10, 0, 8, 8, 0.25, 0, 0.5, 1]);
  });

  it("sums plain advances with no kerning between an unlisted pair", () => {
    const font = fixtureMetrics();
    const result = layout("AB", font, { fontSize: 10 });
    expect(result.width).toBe(20); // 10 + 10, no "AB" kerning entry
  });

  it("applies a kerning pair to reduce pen advance", () => {
    const font = fixtureMetrics();
    const result = layout("AV", font, { fontSize: 10 });
    expect(result.width).toBe(17); // 10 + (-2 kerning) + 9
  });

  it("adds letterSpacing between glyphs but not after the last one", () => {
    const font = fixtureMetrics();
    const result = layout("AB", font, { fontSize: 10, letterSpacing: 3 });
    expect(result.width).toBe(23); // 10 + 3 + 10 (no trailing +3)
    // B's quad x reflects the letterSpacing already applied after 'A'.
    expect(result.quads[8]).toBe(13);
  });

  it("uppercase:true maps lowercase input onto the (uppercase-only) glyph table", () => {
    const font = fixtureMetrics();
    const result = layout("ab", font, { fontSize: 10, uppercase: true });
    expect(result.glyphCount).toBe(2);
    expect(result.width).toBe(20);
  });

  it("uppercase:false (default) leaves lowercase chars unmatched against an uppercase-only font", () => {
    const font = fixtureMetrics();
    const result = layout("ab", font, { fontSize: 10 });
    expect(result.glyphCount).toBe(0);
    expect(result.width).toBe(0);
  });

  it("skips a character with no glyph metrics entirely (zero-width, no quad)", () => {
    const font = fixtureMetrics();
    const result = layout("A@B", font, { fontSize: 10 }); // '@' has no glyph in the fixture
    expect(result.glyphCount).toBe(2);
    expect(result.width).toBe(20); // '@' contributes no advance
  });

  it("scales metrics by fontSize/font.size", () => {
    const font = fixtureMetrics();
    const result = layout("A", font, { fontSize: 20 }); // 2x the fixture's size:10
    expect(result.width).toBe(20); // xadvance 10 * scale 2
    expect(Array.from(result.quads.slice(0, 4))).toEqual([0, 0, 16, 16]); // w,h scaled too
  });

  it("greedily word-wraps at maxWidth, keeping words intact", () => {
    const font = fixtureMetrics();
    // "AB AB" measures to exactly 45 (10+10+5+10+10); a 3rd "AB" tips it over.
    const result = layout("AB AB AB", font, { fontSize: 10, maxWidth: 45 });
    expect(result.lines).toBe(2);
    expect(result.width).toBe(45);
    expect(result.height).toBe(2 * 12);
    expect(result.glyphCount).toBe(6); // 4 letters + 4 letters - 2 spaces (skipped) = 6 'A'/'B' glyphs
  });

  it("never breaks a single word mid-token, even past maxWidth (still starts a new line for what follows)", () => {
    const font = fixtureMetrics();
    const result = layout("AAAAAAAAAA B", font, { fontSize: 10, maxWidth: 15 });
    expect(result.lines).toBe(2);
    // Line 1 is the unbroken 10-char word (width 100, well past maxWidth 15).
    // Recover per-line width via the glyph quads themselves.
    const line0Xs = Array.from({ length: 10 }, (_, i) => result.quads[i * 8]);
    expect(line0Xs).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
  });

  it("honors an explicit newline as a forced line break, independent of maxWidth", () => {
    const font = fixtureMetrics();
    const result = layout("AB\nAB", font, { fontSize: 10 });
    expect(result.lines).toBe(2);
    expect(result.glyphCount).toBe(4);
    expect(result.height).toBe(2 * 12);
  });

  it("align:'left' (default) starts every line's pen at x=0", () => {
    const font = fixtureMetrics();
    const result = layout("A\nAB", font, { fontSize: 10 }); // no align option -> left
    expect(result.quads[0]).toBe(0); // line 0 ('A')
    expect(result.quads[8]).toBe(0); // line 1 ('A' of "AB")
  });

  it("align:'center' offsets each line by half its slack against the block width", () => {
    const font = fixtureMetrics();
    // Paragraph 1 "A" (width 10), paragraph 2 "AB" (width 20) -> blockWidth 20.
    const result = layout("A\nAB", font, { fontSize: 10, align: "center" });
    expect(result.width).toBe(20);
    expect(result.quads[0]).toBe(5); // line 0: (20-10)/2 = 5
    expect(result.quads[8]).toBe(0); // line 1: (20-20)/2 = 0
    expect(result.quads[16]).toBe(10); // line 1's 'B', after 'A's 10px advance
  });

  it("returns an empty result for an empty string", () => {
    const font = fixtureMetrics();
    const result = layout("", font, { fontSize: 10 });
    expect(result.glyphCount).toBe(0);
    expect(result.quads.length).toBe(0);
    expect(result.width).toBe(0);
    expect(result.lines).toBe(1);
  });
});
