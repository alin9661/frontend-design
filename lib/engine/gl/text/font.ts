// lib/engine/gl/text/font.ts
//
// Shared font-metrics contract for gl/text/ (design doc §4C) + the bmfont
// JSON parser for the (currently unavailable — see public/msdf/FALLBACK.md)
// build-time MSDF atlas. `FontMetrics`/`GlyphMetrics` are the plain-data
// shape BOTH text sources (a parsed bmfont atlas and the runtime tiny-sdf
// atlas built by sdf-atlas.ts) normalize into, so layout.ts and MsdfText.ts
// never need to know which mode produced them. `three` is imported
// type-only — this file stays worker-safe / dependency-light like the rest
// of gl/.

import type * as THREE from "three";

/**
 * One glyph's placement inside the atlas texture (pixel units, at
 * `FontMetrics.size` px) plus its pen metrics. Mirrors the standard bmfont
 * "chars" record shape (id/x/y/width/height/xoffset/yoffset/xadvance) so
 * the same type serves both a parsed MSDF atlas and the runtime SDF atlas.
 */
export interface GlyphMetrics {
  /** Unicode code point (`char.charCodeAt(0)`). */
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
}

/**
 * Font-wide metrics needed by layout.ts, keyed by character (not code
 * point) for convenient lookup. `size` is the pixel size the metrics were
 * captured/rasterized at — layout.ts scales everything by
 * `opts.fontSize / size`. `scaleW`/`scaleH` are the atlas texture's pixel
 * dimensions, used to normalize glyph rects into 0..1 UVs.
 */
export interface FontMetrics {
  glyphs: Map<string, GlyphMetrics>;
  /** Keyed by the two-character pair, e.g. `"AV"` -> kerning amount in px. */
  kernings: Map<string, number>;
  size: number;
  lineHeight: number;
  base: number;
  scaleW: number;
  scaleH: number;
}

/** What loadFont() resolves to — the public surface consumers (scenes) hold onto. */
export interface FontHandle {
  mode: "msdf" | "sdf";
  texture: THREE.Texture;
  /** Internal to gl/text/ (layout.ts, MsdfText.ts) — not part of the documented surface. */
  metrics: FontMetrics;
}

// ---------------------------------------------------------------------------
// bmfont JSON parsing (msdf-bmfont-xml's `outputType: "json"` shape, the
// same shape produced by the wider "load-bmfont"/"three-bmfont-text"
// ecosystem — see docs/deep-wave-engine-design.md §4C, scripts/gen-msdf.ts).
// ---------------------------------------------------------------------------

interface BmfontCharRaw {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
  page?: number;
  chnl?: number;
}

interface BmfontKerningRaw {
  first: number;
  second: number;
  amount: number;
}

interface BmfontCommonRaw {
  lineHeight: number;
  base: number;
  scaleW: number;
  scaleH: number;
}

interface BmfontInfoRaw {
  size?: number;
}

export interface BmfontJson {
  pages: string[];
  chars: BmfontCharRaw[];
  kernings?: BmfontKerningRaw[];
  common: BmfontCommonRaw;
  info?: BmfontInfoRaw;
}

function isBmfontJson(value: unknown): value is BmfontJson {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.chars) && typeof v.common === "object" && v.common !== null;
}

/**
 * Parses a bmfont JSON document (as produced by msdf-bmfont-xml) into the
 * shared `FontMetrics` shape. Throws a descriptive `Error` on malformed
 * input rather than producing a partially-populated font (a silently
 * broken atlas is worse than a load failure the caller can fall back on).
 */
export function parseBmfontJson(json: unknown): FontMetrics {
  if (!isBmfontJson(json)) {
    throw new Error("parseBmfontJson: input is not a valid bmfont JSON document (missing chars[]/common)");
  }

  const { chars, common, kernings, info } = json;

  if (chars.length === 0) {
    throw new Error("parseBmfontJson: font has no glyphs (chars[] is empty)");
  }

  const glyphs = new Map<string, GlyphMetrics>();
  for (const c of chars) {
    if (
      typeof c.id !== "number" ||
      typeof c.x !== "number" ||
      typeof c.y !== "number" ||
      typeof c.width !== "number" ||
      typeof c.height !== "number" ||
      typeof c.xoffset !== "number" ||
      typeof c.yoffset !== "number" ||
      typeof c.xadvance !== "number"
    ) {
      throw new Error(`parseBmfontJson: malformed char record: ${JSON.stringify(c)}`);
    }
    glyphs.set(String.fromCharCode(c.id), {
      id: c.id,
      x: c.x,
      y: c.y,
      width: c.width,
      height: c.height,
      xoffset: c.xoffset,
      yoffset: c.yoffset,
      xadvance: c.xadvance,
    });
  }

  const kerningMap = new Map<string, number>();
  for (const k of kernings ?? []) {
    if (typeof k.first !== "number" || typeof k.second !== "number" || typeof k.amount !== "number") continue;
    kerningMap.set(String.fromCharCode(k.first) + String.fromCharCode(k.second), k.amount);
  }

  if (
    typeof common.lineHeight !== "number" ||
    typeof common.base !== "number" ||
    typeof common.scaleW !== "number" ||
    typeof common.scaleH !== "number"
  ) {
    throw new Error("parseBmfontJson: malformed common block (need lineHeight/base/scaleW/scaleH)");
  }

  return {
    glyphs,
    kernings: kerningMap,
    size: info?.size ?? common.lineHeight,
    lineHeight: common.lineHeight,
    base: common.base,
    scaleW: common.scaleW,
    scaleH: common.scaleH,
  };
}
