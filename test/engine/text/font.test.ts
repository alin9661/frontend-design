// test/engine/text/font.test.ts
//
// font.ts's bmfont JSON parser, against a small hand-built fixture matching
// msdf-bmfont-xml's real output shape (design doc §4C).

import { describe, expect, it } from "vitest";
import { parseBmfontJson } from "@/lib/engine/gl/text/font";

function fixture() {
  return {
    pages: ["anton.png"],
    info: { size: 42 },
    common: { lineHeight: 50, base: 38, scaleW: 512, scaleH: 512 },
    chars: [
      { id: 65, x: 0, y: 0, width: 30, height: 34, xoffset: 1, yoffset: 4, xadvance: 32, page: 0, chnl: 15 }, // 'A'
      { id: 86, x: 32, y: 0, width: 30, height: 34, xoffset: 0, yoffset: 4, xadvance: 30, page: 0, chnl: 15 }, // 'V'
      { id: 32, x: 0, y: 40, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 14, page: 0, chnl: 15 }, // ' '
    ],
    kernings: [{ first: 65, second: 86, amount: -4 }],
  };
}

describe("parseBmfontJson", () => {
  it("parses chars into a FontMetrics glyph map keyed by character", () => {
    const metrics = parseBmfontJson(fixture());
    expect(metrics.glyphs.size).toBe(3);
    const a = metrics.glyphs.get("A");
    expect(a).toEqual({ id: 65, x: 0, y: 0, width: 30, height: 34, xoffset: 1, yoffset: 4, xadvance: 32 });
    expect(metrics.glyphs.get("V")?.xadvance).toBe(30);
    expect(metrics.glyphs.get(" ")?.xadvance).toBe(14);
  });

  it("parses kernings into a map keyed by the character pair", () => {
    const metrics = parseBmfontJson(fixture());
    expect(metrics.kernings.get("AV")).toBe(-4);
    expect(metrics.kernings.has("VA")).toBe(false);
  });

  it("reads common block + info.size for line metrics", () => {
    const metrics = parseBmfontJson(fixture());
    expect(metrics.lineHeight).toBe(50);
    expect(metrics.base).toBe(38);
    expect(metrics.scaleW).toBe(512);
    expect(metrics.scaleH).toBe(512);
    expect(metrics.size).toBe(42);
  });

  it("falls back to common.lineHeight for size when info.size is missing", () => {
    const f = fixture();
    delete (f as { info?: unknown }).info;
    const metrics = parseBmfontJson(f);
    expect(metrics.size).toBe(50);
  });

  it("tolerates a missing kernings array", () => {
    const f = fixture();
    delete (f as { kernings?: unknown }).kernings;
    const metrics = parseBmfontJson(f);
    expect(metrics.kernings.size).toBe(0);
  });

  it("throws on a document missing chars[]/common", () => {
    expect(() => parseBmfontJson({})).toThrow(/not a valid bmfont/);
    expect(() => parseBmfontJson(null)).toThrow(/not a valid bmfont/);
    expect(() => parseBmfontJson("nope")).toThrow(/not a valid bmfont/);
  });

  it("throws on an empty charset", () => {
    const f = fixture();
    f.chars = [];
    expect(() => parseBmfontJson(f)).toThrow(/no glyphs/);
  });

  it("throws on a malformed char record", () => {
    const f = fixture();
    // @ts-expect-error deliberately malformed for the test
    f.chars[0].width = "thirty";
    expect(() => parseBmfontJson(f)).toThrow(/malformed char record/);
  });

  it("throws on a malformed common block", () => {
    const f = fixture();
    // @ts-expect-error deliberately malformed for the test
    f.common.scaleW = "512";
    expect(() => parseBmfontJson(f)).toThrow(/malformed common block/);
  });

  it("silently skips a malformed individual kerning entry rather than failing the whole parse", () => {
    const f = fixture();
    // @ts-expect-error deliberately malformed for the test
    f.kernings.push({ first: "A", second: 86, amount: -2 });
    const metrics = parseBmfontJson(f);
    expect(metrics.kernings.size).toBe(1);
  });
});
