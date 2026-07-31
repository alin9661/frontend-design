// lib/engine/gl/splats/sort-core.ts
//
// Pure depth-sort math, split out of sort.worker.ts (see BUG B2 fix notes
// there and in SplatMesh.ts). `computeViewDepths`/`sortIndices` have zero
// side effects and are safe to import from ANY context — the dedicated sort
// worker's `self.onmessage` installation must never live in a file that's
// also imported as a plain module, which is exactly what sort.worker.ts used
// to be.

import * as THREE from "three";

/** 16-bit quantization buckets — enough resolution that ties are visually irrelevant. */
const QUANT_BITS = 16;
const QUANT_LEVELS = 1 << QUANT_BITS; // 65536

// Module-level scratch, reused across calls instead of allocated fresh every
// sort (the splat-lounge camera orbits continuously with scroll, so this
// runs on nearly every re-sort threshold crossing during a scroll gesture —
// see the workstream report's allocation-churn finding). `counts`/`offsets`
// are always exactly QUANT_LEVELS long, so they're allocated once, ever.
// `buckets` is proportional to splat count, so it only grows (never shrinks)
// to the largest count seen so far and is sliced to the exact length needed.
const scratchCounts = new Uint32Array(QUANT_LEVELS);
const scratchOffsets = new Uint32Array(QUANT_LEVELS);
let scratchBuckets = new Uint16Array(0);

function bucketsScratch(count: number): Uint16Array {
  if (scratchBuckets.length < count) scratchBuckets = new Uint16Array(count);
  return scratchBuckets.subarray(0, count);
}

/**
 * View-space depth (more negative = farther from camera, matching three.js's
 * -Z-forward camera convention) for every splat position, via `viewMatrix`
 * (typically `camera.matrixWorldInverse`, already up to date when the
 * caller calls `camera.updateMatrixWorld()` first).
 */
export function computeViewDepths(
  positions: Float32Array,
  viewMatrix: THREE.Matrix4,
  count: number = positions.length / 3
): Float32Array {
  const e = viewMatrix.elements; // column-major: row 2 (z row) is e[2], e[6], e[10], e[14]
  const depths = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3 + 0]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    depths[i] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
  }
  return depths;
}

/**
 * Back-to-front (far-first) index order for `positions` as seen from
 * `viewMatrix`, via a 16-bit quantized counting sort over view-space depth.
 * O(n): one pass to find the depth range, one to bucket, one prefix sum, one
 * scatter — no comparison sort, no allocation proportional to n*log(n).
 *
 * Ties within the same quantization bucket keep their original relative
 * order (the scatter pass processes indices 0..count-1 in order and appends
 * within each bucket's slot range), so results are deterministic and stable.
 *
 * `out`, when provided with the right length, is written into and returned
 * instead of allocating a new Uint32Array — this is the "ping-pong" buffer
 * reuse the design doc calls for: the dedicated worker and SplatMesh trade
 * ownership of two index buffers back and forth via transfer instead of
 * allocating a fresh result every sort.
 */
export function sortIndices(positions: Float32Array, viewMatrix: THREE.Matrix4, out?: Uint32Array): Uint32Array {
  const count = positions.length / 3;
  const result = out && out.length === count ? out : new Uint32Array(count);
  if (count === 0) return result;

  const depths = computeViewDepths(positions, viewMatrix, count);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < count; i++) {
    const d = depths[i]!;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  const range = max - min || 1e-6;

  const buckets = bucketsScratch(count);
  for (let i = 0; i < count; i++) {
    const t = (depths[i]! - min) / range; // 0 = farthest, 1 = nearest
    buckets[i] = Math.min(QUANT_LEVELS - 1, Math.max(0, Math.round(t * (QUANT_LEVELS - 1))));
  }

  const counts = scratchCounts;
  counts.fill(0);
  for (let i = 0; i < count; i++) counts[buckets[i]!]!++;

  // `offsets` doubles as the scatter cursor: each slot is incremented as
  // it's consumed below, and (unlike the old `cursor = offsets.slice()`
  // copy) nothing downstream needs the original prefix-sum values afterward.
  const offsets = scratchOffsets;
  let sum = 0;
  for (let b = 0; b < QUANT_LEVELS; b++) {
    offsets[b] = sum;
    sum += counts[b]!;
  }

  for (let i = 0; i < count; i++) {
    const b = buckets[i]!;
    result[offsets[b]!++] = i;
  }

  return result;
}
