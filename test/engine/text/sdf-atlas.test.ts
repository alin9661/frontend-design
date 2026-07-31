// test/engine/text/sdf-atlas.test.ts
//
// The pure typed-array math half of sdf-atlas.ts (design doc §4C: "the EDT
// is pure typed-array math, unit-test it"). Rasterization itself
// (generateSdfAtlas) needs a real OffscreenCanvas 2D context, which jsdom
// doesn't provide (see test/engine/worker/host.test.ts's fallback-detection
// tests) — so it's exercised only via `supportsSdfAtlasGeneration()`
// returning false here, matching the production fallback path when
// OffscreenCanvas truly is unavailable.

import { describe, expect, it } from "vitest";
import {
  computeAtlasLayout,
  computeSDF,
  DEFAULT_CHARSET,
  squaredDistanceTransform,
  supportsSdfAtlasGeneration,
} from "@/lib/engine/gl/text/sdf-atlas";

describe("squaredDistanceTransform", () => {
  it("computes exact squared distances from a single source pixel", () => {
    // 5x5 grid, single source at (2,2) (row-major index 12).
    const n = 5;
    const input = new Float64Array(n * n).fill(Infinity);
    input[2 * n + 2] = 0;

    const d = squaredDistanceTransform(input, n, n);

    expect(d[2 * n + 2]).toBe(0); // the source itself
    expect(d[2 * n + 3]).toBe(1); // one step right: 1^2
    expect(d[0 * n + 2]).toBe(4); // two steps up: 2^2
    expect(d[0 * n + 0]).toBe(8); // corner: 2^2 + 2^2
  });

  it("computes distance to the nearest of two sources", () => {
    const n = 9;
    const input = new Float64Array(n * n).fill(Infinity);
    input[0] = 0; // (0,0)
    input[n * n - 1] = 0; // (8,8)

    const d = squaredDistanceTransform(input, n, n);

    // (4,4) center is equidistant from both corners: 4^2+4^2 = 32.
    expect(d[4 * n + 4]).toBe(32);
    // (1,1) is much closer to (0,0): 1^2+1^2 = 2.
    expect(d[1 * n + 1]).toBe(2);
  });

  it("treats every cell as a source when the whole input is 0", () => {
    const d = squaredDistanceTransform(new Float64Array(9).fill(0), 3, 3);
    expect(Array.from(d)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("throws when input length doesn't match width*height", () => {
    expect(() => squaredDistanceTransform(new Float64Array(4), 3, 3)).toThrow();
  });
});

describe("computeSDF", () => {
  // A 9x9 mask with a 3x3 filled square centered at (4,4): rows/cols 3..5.
  function squareMask(): Uint8Array {
    const n = 9;
    const mask = new Uint8Array(n * n);
    for (let y = 3; y <= 5; y++) {
      for (let x = 3; x <= 5; x++) mask[y * n + x] = 255;
    }
    return mask;
  }

  it("encodes the exact center of a filled region above the cutoff (deep inside)", () => {
    const sdf = computeSDF(squareMask(), 9, 9, { radius: 4, cutoff: 0.5 });
    const center = 4 * 9 + 4; // distance-to-outside = 1 (nearest edge is 1px away)
    expect(sdf[center]).toBeGreaterThan(127); // inside the glyph
  });

  it("encodes a far background pixel below the cutoff (deep outside)", () => {
    const sdf = computeSDF(squareMask(), 9, 9, { radius: 4, cutoff: 0.5 });
    const corner = 0 * 9 + 0;
    expect(sdf[corner]).toBeLessThan(127);
  });

  it("is monotonic: pixels further outside the glyph never encode closer-to-inside than nearer ones", () => {
    const sdf = computeSDF(squareMask(), 9, 9, { radius: 8, cutoff: 0.5 });
    const n = 9;
    const nearEdge = sdf[3 * n + 2]!; // 1px outside the left edge, mid-height
    const farEdge = sdf[3 * n + 0]!; // 3px outside the left edge, mid-height
    expect(nearEdge).toBeGreaterThan(farEdge);
  });

  it("places the exact glyph boundary at the cutoff value", () => {
    const n = 9;
    // Boundary pixel (3,3, top-left corner of the filled square) is inside.
    const sdf = computeSDF(squareMask(), n, n, { radius: 4, cutoff: 0.5 });
    const insideBoundary = sdf[3 * n + 3]!;
    const outsideBoundary = sdf[3 * n + 2]!;
    expect(insideBoundary).toBeGreaterThanOrEqual(Math.round(0.5 * 255));
    expect(outsideBoundary).toBeLessThan(Math.round(0.5 * 255));
  });
});

describe("computeAtlasLayout", () => {
  it("packs every character in the charset into a distinct cell", () => {
    const { cells } = computeAtlasLayout(DEFAULT_CHARSET, 64);
    expect(cells.size).toBe(Array.from(DEFAULT_CHARSET).length);
  });

  it("lays cells out in row-major order at exact cellSize multiples", () => {
    const { cells, cols } = computeAtlasLayout("ABCDE", 64);
    const a = cells.get("A")!;
    const b = cells.get("B")!;
    expect(a).toEqual({ col: 0, row: 0, x: 0, y: 0 });
    expect(b).toEqual({ col: 1, row: 0, x: 64, y: 0 });
    if (cols === 3) {
      // 5 chars -> ceil(sqrt(5))=3 cols -> row wraps after the 3rd char.
      expect(cells.get("D")).toEqual({ col: 0, row: 1, x: 0, y: 64 });
    }
  });

  it("sizes the atlas to exactly cols*cellSize by rows*cellSize", () => {
    const { cols, rows, width, height } = computeAtlasLayout("ABCDE", 64);
    expect(width).toBe(cols * 64);
    expect(height).toBe(rows * 64);
  });
});

describe("supportsSdfAtlasGeneration", () => {
  it("returns false under jsdom (no OffscreenCanvas)", () => {
    expect(supportsSdfAtlasGeneration()).toBe(false);
  });
});
