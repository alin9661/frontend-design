// test/engine/splats/synthesize.test.ts
//
// gl/splats/synthesize.ts — synthesizeFromGeometry invariants (count, world-
// space bounds, scale/quat packing, normal-aligned anisotropy, determinism
// via seed) and synthesizeCanScene's composed totals.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { decodeByteToUnit } from "@/lib/engine/gl/splats/formats";
import {
  CAN_RADIUS,
  mergeSplatData,
  synthesizeCanScene,
  synthesizeFromGeometry,
} from "@/lib/engine/gl/splats/synthesize";

describe("synthesizeFromGeometry — a flat 10x10 plane (known bounds, known normal)", () => {
  const PLANE_SIZE = 10;

  it("produces exactly `count` splats with well-formed array lengths", () => {
    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
    const data = synthesizeFromGeometry(geo, { count: 300, scaleRange: [0.1, 0.5], seed: 1 });

    expect(data.count).toBe(300);
    expect(data.positions.length).toBe(300 * 3);
    expect(data.scales.length).toBe(300 * 3);
    expect(data.colors.length).toBe(300 * 4);
    expect(data.quats.length).toBe(300 * 4);
  });

  it("keeps every sampled position within the plane's world-space bounds (no jitter)", () => {
    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
    const data = synthesizeFromGeometry(geo, { count: 500, scaleRange: [0.1, 0.5], seed: 2 });

    for (let i = 0; i < data.count; i++) {
      expect(Math.abs(data.positions[i * 3 + 0]!)).toBeLessThanOrEqual(PLANE_SIZE / 2 + 1e-5);
      expect(Math.abs(data.positions[i * 3 + 1]!)).toBeLessThanOrEqual(PLANE_SIZE / 2 + 1e-5);
      expect(data.positions[i * 3 + 2]).toBeCloseTo(0, 5); // flat plane, no jitter -> z stays exactly 0
    }
  });

  it("pins the normal-aligned axis to scaleMin and keeps tangent axes within [scaleMin, scaleMax]", () => {
    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
    const [scaleMin, scaleMax] = [0.2, 1.4];
    const data = synthesizeFromGeometry(geo, { count: 400, scaleRange: [scaleMin, scaleMax], seed: 3 });

    for (let i = 0; i < data.count; i++) {
      // Local axis 2 is the flattened "coin" axis, rotated to align with the
      // surface normal — for this un-rotated plane, world z IS that axis.
      expect(data.scales[i * 3 + 2]).toBeCloseTo(scaleMin, 6);
      expect(data.scales[i * 3 + 0]).toBeGreaterThanOrEqual(scaleMin - 1e-6);
      expect(data.scales[i * 3 + 0]).toBeLessThanOrEqual(scaleMax + 1e-6);
      expect(data.scales[i * 3 + 1]).toBeGreaterThanOrEqual(scaleMin - 1e-6);
      expect(data.scales[i * 3 + 1]).toBeLessThanOrEqual(scaleMax + 1e-6);
    }
  });

  it("packs a near-unit quaternion into every splat (uint8 quantization tolerance)", () => {
    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
    const data = synthesizeFromGeometry(geo, { count: 200, scaleRange: [0.1, 0.5], seed: 4 });

    for (let i = 0; i < data.count; i++) {
      const x = decodeByteToUnit(data.quats[i * 4 + 0]!);
      const y = decodeByteToUnit(data.quats[i * 4 + 1]!);
      const z = decodeByteToUnit(data.quats[i * 4 + 2]!);
      const w = decodeByteToUnit(data.quats[i * 4 + 3]!);
      const magnitude = Math.sqrt(x * x + y * y + z * z + w * w);
      expect(magnitude).toBeGreaterThan(0.9);
      expect(magnitude).toBeLessThan(1.1);
    }
  });

  it("applies jitter along the normal (z moves off the flat plane) when jitter > 0", () => {
    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
    const data = synthesizeFromGeometry(geo, {
      count: 200,
      scaleRange: [0.1, 0.5],
      jitter: 1,
      seed: 5,
    });

    const anyOffPlane = Array.from({ length: data.count }, (_, i) => data.positions[i * 3 + 2]!).some(
      (z) => Math.abs(z) > 1e-4
    );
    expect(anyOffPlane).toBe(true);
  });

  it("uses the default flat gray color when no colorFn is supplied", () => {
    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
    const data = synthesizeFromGeometry(geo, { count: 10, scaleRange: [0.1, 0.5], seed: 6 });
    expect(Array.from(data.colors.subarray(0, 4))).toEqual([200, 200, 200, 255]);
  });

  it("uses colorFn's output, clamped into [0, 255], when supplied", () => {
    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
    const data = synthesizeFromGeometry(geo, {
      count: 10,
      scaleRange: [0.1, 0.5],
      seed: 7,
      colorFn: () => [10, 20, 300, -5], // 300/-5 exercise the clamp
    });
    for (let i = 0; i < data.count; i++) {
      expect(data.colors[i * 4 + 0]).toBe(10);
      expect(data.colors[i * 4 + 1]).toBe(20);
      expect(data.colors[i * 4 + 2]).toBe(255); // clamped
      expect(data.colors[i * 4 + 3]).toBe(0); // clamped
    }
  });

  it("is deterministic for a given seed, and differs across seeds", () => {
    const geo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE);
    const a = synthesizeFromGeometry(geo, { count: 50, scaleRange: [0.1, 0.5], seed: 42 });
    const b = synthesizeFromGeometry(geo, { count: 50, scaleRange: [0.1, 0.5], seed: 42 });
    const c = synthesizeFromGeometry(geo, { count: 50, scaleRange: [0.1, 0.5], seed: 99 });

    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.positions)).not.toEqual(Array.from(c.positions));
  });
});

describe("mergeSplatData", () => {
  it("concatenates count and every per-splat array in order", () => {
    const a = synthesizeFromGeometry(new THREE.PlaneGeometry(2, 2), { count: 3, scaleRange: [0.1, 0.2], seed: 1 });
    const b = synthesizeFromGeometry(new THREE.PlaneGeometry(2, 2), { count: 5, scaleRange: [0.1, 0.2], seed: 2 });

    const merged = mergeSplatData([a, b]);
    expect(merged.count).toBe(8);
    expect(merged.positions.length).toBe(8 * 3);
    expect(Array.from(merged.positions.subarray(0, 9))).toEqual(Array.from(a.positions));
    expect(Array.from(merged.positions.subarray(9))).toEqual(Array.from(b.positions));
    expect(Array.from(merged.colors.subarray(0, 12))).toEqual(Array.from(a.colors));
  });
});

describe("synthesizeCanScene", () => {
  it("produces a splat count in the design doc's ~80k-150k range", () => {
    const data = synthesizeCanScene({ seed: 1 });
    expect(data.count).toBeGreaterThanOrEqual(80000);
    expect(data.count).toBeLessThanOrEqual(150000);
  });

  it("every array's length matches SplatData's contract for `count`", () => {
    const data = synthesizeCanScene({ seed: 1 });
    expect(data.positions.length).toBe(data.count * 3);
    expect(data.scales.length).toBe(data.count * 3);
    expect(data.colors.length).toBe(data.count * 4);
    expect(data.quats.length).toBe(data.count * 4);
  });

  it("is deterministic for a given seed", () => {
    const a = synthesizeCanScene({ seed: 123 });
    const b = synthesizeCanScene({ seed: 123 });
    expect(a.count).toBe(b.count);
    expect(Array.from(a.positions.subarray(0, 300))).toEqual(Array.from(b.positions.subarray(0, 300)));
  });

  it("ambient puffs stay genuinely translucent (F-004 regression: alpha ≤ 30, never the old near-solid stacking)", () => {
    // Regression (design-review F-004): puffs at alpha 60 × 3000 splats per
    // volume compounded to near-solid dark blobs that swallowed the can.
    // Every splat must be either fully opaque subject/table (255) or true
    // haze (≤ 30); a middle band means the optical-depth budget regressed.
    const data = synthesizeCanScene({ seed: 1 });
    let hazeCount = 0;
    for (let i = 0; i < data.count; i++) {
      const alpha = data.colors[i * 4 + 3]!;
      if (alpha === 255) continue;
      expect(alpha).toBeLessThanOrEqual(30);
      hazeCount++;
    }
    // The haze layer exists but is sparse relative to the subject.
    expect(hazeCount).toBeGreaterThan(0);
    expect(hazeCount).toBeLessThan(data.count * 0.1);
  });

  it("keeps the seafoam can body the dominant read — the label band tints toward the accent, never past it (F-004 regression)", () => {
    // Regression (design-review F-004): the label band mixed `facing * 0.7`
    // toward canAccent (#14574A), so the whole camera-facing half of the can
    // went near-solid accent and read as a black cylinder. Retuned to 0.45
    // (band) / 0.08 (elsewhere), i.e. the body colour must always stay the
    // dominant contributor.
    const BODY_R = new THREE.Color("#7CC9B5").r * 255;
    const ACCENT_R = new THREE.Color("#14574A").r * 255;
    const data = synthesizeCanScene({ seed: 1 });

    let maxMix = 0;
    for (let i = 0; i < data.count; i++) {
      if (data.colors[i * 4 + 3] !== 255) continue; // haze, not the subject
      const r = data.colors[i * 4]!;
      // The flat lid disc and the cream table use their own palette entries
      // (both far lighter than the body), so they're not on the
      // body->accent ramp this assertion measures.
      if (r > BODY_R + 1) continue;
      const mix = (r - BODY_R) / (ACCENT_R - BODY_R);
      maxMix = Math.max(maxMix, mix);
    }

    // Never more than a 0.45 tint (+1 byte of quantisation slack); the old
    // 0.7 weight would land here at ~0.7.
    expect(maxMix).toBeLessThanOrEqual(0.47);
    // ...but the label band is still a visible tint, not a no-op.
    expect(maxMix).toBeGreaterThan(0.3);
  });

  it("scatters the haze sparsely and pushes it out past the table edge so it frames the can (F-004 regression)", () => {
    // Regression (design-review F-004): 6 puffs × 3000 splats at a
    // CAN_RADIUS*2.6 base offset sat between the orbit camera and the can.
    // Retuned to 6 × 350 splats pushed out to CAN_RADIUS*4.2 + jitter.
    const data = synthesizeCanScene({ seed: 1 });

    const hazeRadii: number[] = [];
    for (let i = 0; i < data.count; i++) {
      if (data.colors[i * 4 + 3] === 255) continue;
      hazeRadii.push(Math.hypot(data.positions[i * 3]!, data.positions[i * 3 + 2]!));
    }

    // 6 puffs × 350 splats — the density half of the optical-depth budget.
    expect(hazeRadii.length).toBe(6 * 350);

    const meanRadius = hazeRadii.reduce((sum, r) => sum + r, 0) / hazeRadii.length;
    // Comfortably beyond the old CAN_RADIUS*2.6 base offset, which put the
    // puffs between the camera and the subject for most of the orbit.
    expect(meanRadius).toBeGreaterThan(CAN_RADIUS * 3.5);
  });

  it("varies color across the cloud (not a single flat swatch)", () => {
    const data = synthesizeCanScene({ seed: 1 });
    const distinctColors = new Set<string>();
    for (let i = 0; i < data.count; i += 977) {
      distinctColors.add(`${data.colors[i * 4]},${data.colors[i * 4 + 1]},${data.colors[i * 4 + 2]}`);
      if (distinctColors.size > 1) break;
    }
    expect(distinctColors.size).toBeGreaterThan(1);
  });
});
