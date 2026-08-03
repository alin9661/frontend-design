// lib/engine/gl/text/sdf-atlas.ts
//
// Runtime tiny-sdf atlas — the fallback text path (design doc §4C,
// docs/msdf-fallback.md): the build-time msdfgen toolchain fails on this
// machine, so this is the mode that actually ships. Two layers:
//
//  1. Pure typed-array math (`squaredDistanceTransform`, `computeSDF`,
//     `computeAtlasLayout`) — no canvas, no three, fully unit-testable
//     against hand-built bitmaps (see test/engine/text/sdf-atlas.test.ts).
//  2. `generateSdfAtlas` — the impure orchestration: rasterize each glyph
//     with OffscreenCanvas 2D, run the pure SDF math per 64px cell, blit
//     into one atlas canvas. Requires OffscreenCanvas (worker-safe: no
//     `document`, matching gl/'s layering law) — feature-detect via
//     `supportsSdfAtlasGeneration()` before calling.

import type { FontMetrics, GlyphMetrics } from "./font";

/** A-Z 0-9 . , ' * ! ? - : / space — identical to scripts/gen-msdf.ts's CHARSET. */
export const DEFAULT_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,'*!?-:/ ";

export const DEFAULT_CELL_SIZE = 64;

// ---------------------------------------------------------------------------
// 1. Pure math
// ---------------------------------------------------------------------------

/** Large-but-finite "not a source" sentinel — keeps the transform's arithmetic
 *  finite (real `Infinity` produces `Infinity - Infinity = NaN`, which would
 *  break the lower-envelope comparisons below). */
const INF = 1e20;

/**
 * Felzenszwalb & Huttenlocher's 1D generalized distance transform: given a
 * per-cell base cost `f` (0 at "source" cells, `INF` elsewhere), returns
 * `d[q] = min_r( (q-r)^2 + f[r] )` for every cell `q` — the squared
 * distance from `q` to the nearest source, in O(n).
 */
function transform1D(f: Float64Array, n: number): Float64Array {
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;

  for (let q = 1; q < n; q++) {
    let s = 0;
    for (;;) {
      const r = v[k];
      s = (f[q]! + q * q - (f[r]! + r * r)) / (2 * q - 2 * r);
      if (s > z[k]!) break;
      if (k === 0) break; // can't pop further back — accept s (matches k=0 base case)
      k--;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const r = v[k]!;
    d[q] = (q - r) * (q - r) + f[r]!;
  }
  return d;
}

/**
 * 2D squared Euclidean distance transform via two 1D passes (columns then
 * rows) — the standard separable Felzenszwalb algorithm. `input[i]` is the
 * per-pixel base cost (0 = source pixel, `INF` = not a source); the result
 * is, for every pixel, the squared distance to the nearest source pixel
 * (plus that source's own cost, always 0 here).
 */
export function squaredDistanceTransform(input: Float64Array, width: number, height: number): Float64Array {
  if (input.length !== width * height) {
    throw new Error(
      `squaredDistanceTransform: input.length (${input.length}) !== width*height (${width * height})`
    );
  }

  // Callers may reasonably pass real `Infinity` for "not a source" (it reads
  // better than a magic sentinel at call sites). `Infinity - Infinity` is
  // NaN, though, which would poison the lower-envelope comparisons below —
  // so normalize to the large-but-finite internal sentinel up front.
  const sanitized = new Float64Array(input.length);
  for (let i = 0; i < input.length; i++) {
    sanitized[i] = Number.isFinite(input[i]) ? input[i]! : INF;
  }

  const afterColumns = new Float64Array(width * height);
  const colBuf = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) colBuf[y] = sanitized[y * width + x]!;
    const d = transform1D(colBuf, height);
    for (let y = 0; y < height; y++) afterColumns[y * width + x] = d[y]!;
  }

  const out = new Float64Array(width * height);
  const rowBuf = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rowBuf[x] = afterColumns[y * width + x]!;
    const d = transform1D(rowBuf, width);
    for (let x = 0; x < width; x++) out[y * width + x] = d[x]!;
  }
  return out;
}

export interface ComputeSdfOptions {
  /** Alpha threshold separating "inside" (ink) from "outside", 0..255. Default 127. */
  threshold?: number;
  /** Distance (px) that maps to the full 0..1 output range. */
  radius: number;
  /** Where the glyph edge (alpha threshold) sits in the output, 0..1. Default 0.5. */
  cutoff?: number;
}

/**
 * Builds a single-channel signed distance field from a rasterized alpha
 * mask: for every pixel, positive-of-cutoff means inside the glyph,
 * negative-of-cutoff means outside, magnitude proportional to distance from
 * the glyph edge (clamped to `radius` px, encoded 0..255). This is the
 * "EDT" the design doc calls out to unit-test directly against a known
 * bitmap.
 */
export function computeSDF(
  alphaMask: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  opts: ComputeSdfOptions
): Uint8ClampedArray {
  const threshold = opts.threshold ?? 127;
  const cutoff = opts.cutoff ?? 0.5;
  const radius = Math.max(opts.radius, 1e-6);
  const n = width * height;

  const insideCost = new Float64Array(n); // 0 at ink pixels -> "distance to nearest ink pixel"
  const outsideCost = new Float64Array(n); // 0 at background pixels -> "distance to nearest background pixel"
  for (let i = 0; i < n; i++) {
    const isInside = alphaMask[i]! > threshold;
    insideCost[i] = isInside ? 0 : INF;
    outsideCost[i] = isInside ? INF : 0;
  }

  const distToInside = squaredDistanceTransform(insideCost, width, height);
  const distToOutside = squaredDistanceTransform(outsideCost, width, height);

  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const isInside = alphaMask[i]! > threshold;
    // Signed distance: positive inside the glyph, negative outside.
    const signedDist = isInside ? Math.sqrt(distToOutside[i]!) : -Math.sqrt(distToInside[i]!);
    const normalized = cutoff + signedDist / radius;
    out[i] = Math.round(Math.min(1, Math.max(0, normalized)) * 255);
  }
  return out;
}

export interface AtlasCell {
  col: number;
  row: number;
  /** Top-left pixel offset of this glyph's cell within the atlas canvas. */
  x: number;
  y: number;
}

/**
 * Pure grid-packing math: lays `charset.length` fixed-size cells into a
 * roughly-square grid. Kept separate from rasterization so packing can be
 * unit-tested without a real canvas.
 */
export function computeAtlasLayout(
  charset: string,
  cellSize: number = DEFAULT_CELL_SIZE
): { cells: Map<string, AtlasCell>; cols: number; rows: number; width: number; height: number } {
  const chars = Array.from(charset);
  const cols = Math.max(1, Math.ceil(Math.sqrt(chars.length)));
  const rows = Math.max(1, Math.ceil(chars.length / cols));
  const cells = new Map<string, AtlasCell>();
  chars.forEach((ch, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    cells.set(ch, { col, row, x: col * cellSize, y: row * cellSize });
  });
  return { cells, cols, rows, width: cols * cellSize, height: rows * cellSize };
}

// ---------------------------------------------------------------------------
// 2. Impure rasterization (real OffscreenCanvas — not exercised by unit
//    tests, which run under jsdom and have neither OffscreenCanvas nor a
//    working 2D canvas context; see test/engine/text/sdf-atlas.test.ts).
// ---------------------------------------------------------------------------

/** Feature-detect before calling `generateSdfAtlas` — gl/ must degrade gracefully, never throw at import time. */
export function supportsSdfAtlasGeneration(): boolean {
  return typeof OffscreenCanvas !== "undefined";
}

export interface GenerateSdfAtlasOptions {
  charset?: string;
  cellSize?: number;
  /** CSS font-family stack. Anton-Regular.ttf (assets/fonts/) isn't served
   *  at runtime (only public/ is web-servable), so this defaults to a bold
   *  system stack approximating Anton's blocky display weight — see the
   *  "font family" note in this repo's text-agent hand-off notes. */
  fontFamily?: string;
  fontWeight?: string;
  /** Padding (px) between glyph ink and cell edge — also the SDF spread radius. */
  padding?: number;
}

const DEFAULT_FONT_FAMILY = "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif";
const DEFAULT_FONT_WEIGHT = "900";
const DEFAULT_PADDING = 8;

/**
 * Rasterizes `opts.charset` into one SDF atlas: each glyph gets its own
 * `cellSize`x`cellSize` OffscreenCanvas 2D cell, alpha-thresholded and run
 * through `computeSDF`, then blitted into the shared atlas canvas.
 */
export async function generateSdfAtlas(
  opts: GenerateSdfAtlasOptions = {}
): Promise<{ metrics: FontMetrics; canvas: OffscreenCanvas }> {
  if (!supportsSdfAtlasGeneration()) {
    throw new Error("generateSdfAtlas: OffscreenCanvas is not available in this environment");
  }

  const charset = opts.charset ?? DEFAULT_CHARSET;
  const cellSize = opts.cellSize ?? DEFAULT_CELL_SIZE;
  const fontFamily = opts.fontFamily ?? DEFAULT_FONT_FAMILY;
  const fontWeight = opts.fontWeight ?? DEFAULT_FONT_WEIGHT;
  const padding = opts.padding ?? DEFAULT_PADDING;
  const fontPx = cellSize - padding * 2;

  const layout = computeAtlasLayout(charset, cellSize);
  const atlasCanvas = new OffscreenCanvas(layout.width, layout.height);
  const atlasCtx = atlasCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
  if (!atlasCtx) throw new Error("generateSdfAtlas: failed to acquire atlas 2D context");

  const glyphs = new Map<string, GlyphMetrics>();
  const baselineY = padding + fontPx * 0.78;

  for (const ch of Array.from(charset)) {
    const cell = layout.cells.get(ch);
    if (!cell) continue;

    const cellCanvas = new OffscreenCanvas(cellSize, cellSize);
    const cellCtx = cellCanvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
    if (!cellCtx) continue;

    cellCtx.clearRect(0, 0, cellSize, cellSize);
    cellCtx.font = `${fontWeight} ${fontPx}px ${fontFamily}`;
    cellCtx.textAlign = "left";
    cellCtx.textBaseline = "alphabetic";
    cellCtx.fillStyle = "#fff";
    cellCtx.fillText(ch, padding * 0.5, baselineY);
    const advance = ch === " " ? fontPx * 0.4 : cellCtx.measureText(ch).width + padding * 0.5;

    const imageData = cellCtx.getImageData(0, 0, cellSize, cellSize);
    const alpha = new Uint8ClampedArray(cellSize * cellSize);
    for (let i = 0; i < alpha.length; i++) alpha[i] = imageData.data[i * 4 + 3]!;

    const sdf = computeSDF(alpha, cellSize, cellSize, { radius: padding });
    const sdfImage = atlasCtx.createImageData(cellSize, cellSize);
    for (let i = 0; i < sdf.length; i++) {
      sdfImage.data[i * 4] = sdf[i]!;
      sdfImage.data[i * 4 + 1] = sdf[i]!;
      sdfImage.data[i * 4 + 2] = sdf[i]!;
      sdfImage.data[i * 4 + 3] = 255;
    }
    atlasCtx.putImageData(sdfImage, cell.x, cell.y);

    glyphs.set(ch, {
      id: ch.charCodeAt(0),
      x: cell.x,
      y: cell.y,
      width: cellSize,
      height: cellSize,
      xoffset: 0,
      yoffset: 0,
      xadvance: advance,
    });
  }

  const metrics: FontMetrics = {
    glyphs,
    kernings: new Map(), // canvas 2D exposes no kerning table — pairs render at their raw advance.
    size: fontPx,
    lineHeight: cellSize * 1.05,
    base: baselineY,
    scaleW: layout.width,
    scaleH: layout.height,
  };

  return { metrics, canvas: atlasCanvas };
}
