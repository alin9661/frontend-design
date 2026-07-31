// test/engine/splats/sort.test.ts
//
// gl/splats/sort.worker.ts's pure `sortIndices`/`computeViewDepths` exports
// — the design doc's "sort vs Array.sort reference on random clouds" and
// "covariance math vs known matrices" coverage lives here for the sort half
// (SplatMesh.test.ts covers the covariance half). Importing this module
// installs no worker side effect in vitest/jsdom (`WorkerGlobalScope` is
// undefined outside a real dedicated-worker context — see the module's own
// guard), so this is a plain pure-function test file.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { computeViewDepths, sortIndices } from "@/lib/engine/gl/splats/sort.worker";

describe("computeViewDepths", () => {
  it("under an identity view matrix, depth is just world-space z", () => {
    const positions = new Float32Array([0, 0, -1, 0, 0, -5, 0, 0, 3]);
    const depths = computeViewDepths(positions, new THREE.Matrix4());
    expect(Array.from(depths)).toEqual([-1, -5, 3]);
  });

  it("includes the view matrix's translation component", () => {
    const positions = new Float32Array([0, 0, 5]);
    const viewMatrix = new THREE.Matrix4().makeTranslation(0, 0, 100);
    const depths = computeViewDepths(positions, viewMatrix);
    expect(depths[0]).toBeCloseTo(105, 5);
  });
});

describe("sortIndices — 16-bit quantized counting sort, back-to-front (far-first)", () => {
  it("sorts a small hand-checkable cloud by ascending (identity-view) z, farthest first", () => {
    // z values: index0=-1, index1=-5, index2=3, index3=-2, index4=10
    const positions = new Float32Array([0, 0, -1, 0, 0, -5, 0, 0, 3, 0, 0, -2, 0, 0, 10]);
    const order = sortIndices(positions, new THREE.Matrix4());
    // Ascending z: -5(idx1), -2(idx3), -1(idx0), 3(idx2), 10(idx4)
    expect(Array.from(order)).toEqual([1, 3, 0, 2, 4]);
  });

  it("respects a non-identity view matrix (depth axis rotated onto world x)", () => {
    // makeRotationY(90deg): view-space depth becomes -worldX (see file header
    // derivation in the workstream notes) — ascending depth == descending x.
    const positions = new Float32Array([1, 0, 0, 5, 0, 0, -3, 0, 0, 2, 0, 0, 0, 0, 0]);
    const viewMatrix = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const order = sortIndices(positions, viewMatrix);
    // x values per index: [1, 5, -3, 2, 0] -> descending x order: 5,2,1,0,-3 -> indices 1,3,0,4,2
    expect(Array.from(order)).toEqual([1, 3, 0, 4, 2]);
  });

  it("returns an empty array for zero splats", () => {
    const order = sortIndices(new Float32Array(0), new THREE.Matrix4());
    expect(order.length).toBe(0);
  });

  it("writes into a provided `out` buffer instead of allocating, when lengths match", () => {
    const positions = new Float32Array([0, 0, -1, 0, 0, -5, 0, 0, 3]);
    const out = new Uint32Array(3);
    const result = sortIndices(positions, new THREE.Matrix4(), out);
    expect(result).toBe(out); // same reference, not a fresh allocation
    expect(Array.from(result)).toEqual([1, 0, 2]);
  });

  it("ignores a mismatched-length `out` buffer and allocates fresh instead", () => {
    const positions = new Float32Array([0, 0, -1, 0, 0, -5, 0, 0, 3]);
    const out = new Uint32Array(1); // wrong length for 3 splats
    const result = sortIndices(positions, new THREE.Matrix4(), out);
    expect(result).not.toBe(out);
    expect(result.length).toBe(3);
  });

  it("matches an Array.sort reference (by exact depth) on a large random cloud, up to same-bucket ties", () => {
    const count = 5000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 2] = -Math.random() * 500 - 1; // all in front of the camera
    }
    const viewMatrix = new THREE.Matrix4().makeTranslation(3, -1, 0).multiply(
      new THREE.Matrix4().makeRotationX(0.3)
    );

    const depths = computeViewDepths(positions, viewMatrix, count);
    const order = sortIndices(positions, viewMatrix);

    // 1. It's a genuine permutation of every index.
    const seen = new Set(order);
    expect(seen.size).toBe(count);
    for (let i = 0; i < count; i++) expect(seen.has(i)).toBe(true);

    // 2. The resulting depth sequence is monotonically non-decreasing
    // (painter's back-to-front order), modulo float noise at bucket
    // boundaries — quantize with the same 16-bit scheme sortIndices uses
    // internally and assert THAT sequence never decreases.
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < count; i++) {
      if (depths[i]! < min) min = depths[i]!;
      if (depths[i]! > max) max = depths[i]!;
    }
    const range = max - min || 1e-6;
    const bucketOf = (i: number) => Math.round(((depths[i]! - min) / range) * 65535);

    let prevBucket = -1;
    for (const idx of order) {
      const b = bucketOf(idx);
      expect(b).toBeGreaterThanOrEqual(prevBucket);
      prevBucket = b;
    }

    // 3. Cross-check against a plain Array.sort reference: the bucket
    // sequence sortIndices() produced must be IDENTICAL to a full-precision
    // Array.sort's bucket sequence (ties within one bucket are allowed to
    // land in a different relative order, but the bucket value at each
    // position in the sequence must match — same quantization, same input).
    const reference = Array.from({ length: count }, (_, i) => i).sort((a, b) => depths[a]! - depths[b]!);
    const referenceBuckets = reference.map(bucketOf);
    const orderBuckets = Array.from(order).map(bucketOf);
    expect(orderBuckets).toEqual(referenceBuckets);
  });
});
