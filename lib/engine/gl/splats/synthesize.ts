// lib/engine/gl/splats/synthesize.ts
//
// Synthesizes SplatData from procedural THREE geometry instead of loading
// captured/scanned content (design doc §4B, §1 "our deltas" — zero
// downloads). Two exports:
//
// - `synthesizeFromGeometry`: area-weighted surface sampling of ANY
//   BufferGeometry, producing normal-aligned anisotropic splats (thin along
//   the surface normal, wide across the surface tangent plane — this is what
//   makes a splat cloud read as a *surface* rather than a fog of spheres).
// - `synthesizeCanScene`: the demo asset. Composes a can-ish lathe body + a
//   flat table plane + a handful of soft ambient "puff" volumes into ONE
//   SplatData (~80-150k splats total), Mateína mint-flavor palette.
//
// Pure-ish: imports `three` (allowed in gl/, per the layering law) purely for
// its geometry/math value types — no document/window/renderer/canvas touched,
// so this stays worker-safe.

import * as THREE from "three";
import type { SplatData } from "../../types";
import { encodeUnitToByte } from "./formats";

// ---------------------------------------------------------------------------
// Deterministic seedable RNG (mulberry32) — not part of the design doc's
// documented `synthesizeFromGeometry` signature, but added as an optional
// `seed` field so both the demo scene and its tests get reproducible output
// instead of a different splat cloud every run. Falls back to `Math.random`
// when omitted (ASSUMPTION, flagged in workstream return notes).
// ---------------------------------------------------------------------------

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed?: number): Rng {
  return seed === undefined ? Math.random : mulberry32(seed);
}

// ---------------------------------------------------------------------------
// synthesizeFromGeometry
// ---------------------------------------------------------------------------

export type ColorFn = (
  position: THREE.Vector3,
  normal: THREE.Vector3
) => readonly [number, number, number, number]; // rgba, 0..255

export interface SynthesizeOptions {
  count: number;
  /** [min, max] world-unit half-extent a splat's scale axes are clamped into. */
  scaleRange: [number, number];
  colorFn?: ColorFn;
  /** Fraction (of `scaleRange[1]`) of random offset applied along the surface normal, default 0. */
  jitter?: number;
  /** Deterministic RNG seed — see note above. */
  seed?: number;
}

interface Triangle {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  cumulativeArea: number;
}

function buildTriangleList(geo: THREE.BufferGeometry): Triangle[] {
  const posAttr = geo.getAttribute("position");
  if (!posAttr) {
    throw new Error("synthesizeFromGeometry: geometry has no position attribute");
  }
  const index = geo.getIndex();
  const triCount = index ? index.count / 3 : posAttr.count / 3;

  const triangles: Triangle[] = [];
  let cumulative = 0;
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const cross = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    let ia: number, ib: number, ic: number;
    if (index) {
      ia = index.getX(t * 3);
      ib = index.getX(t * 3 + 1);
      ic = index.getX(t * 3 + 2);
    } else {
      ia = t * 3;
      ib = t * 3 + 1;
      ic = t * 3 + 2;
    }
    const a = new THREE.Vector3().fromBufferAttribute(posAttr, ia);
    const b = new THREE.Vector3().fromBufferAttribute(posAttr, ib);
    const c = new THREE.Vector3().fromBufferAttribute(posAttr, ic);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    cross.crossVectors(ab, ac);
    const area = cross.length() * 0.5;

    cumulative += area;
    triangles.push({ a, b, c, cumulativeArea: cumulative });
  }

  return triangles;
}

/** Binary search for the first triangle whose cumulative area exceeds `r`. */
function pickTriangle(triangles: Triangle[], r: number): Triangle {
  let lo = 0;
  let hi = triangles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (triangles[mid]!.cumulativeArea < r) lo = mid + 1;
    else hi = mid;
  }
  return triangles[lo]!;
}

const DEFAULT_COLOR: readonly [number, number, number, number] = [200, 200, 200, 255];

/**
 * Area-weighted random surface sampling of `geo` into `opts.count` splats.
 * Each splat's ellipsoid is flattened along the surface normal (a thin
 * "coin") and spread across the tangent plane, so the cloud reads as a
 * surface instead of a volumetric haze.
 */
export function synthesizeFromGeometry(geo: THREE.BufferGeometry, opts: SynthesizeOptions): SplatData {
  const { count, scaleRange, colorFn, jitter = 0, seed } = opts;
  const rng = makeRng(seed);
  const triangles = buildTriangleList(geo);
  const totalArea = triangles.length > 0 ? triangles[triangles.length - 1]!.cumulativeArea : 0;

  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 4);
  const quats = new Uint8Array(count * 4);

  const [scaleMin, scaleMax] = scaleRange;
  const normalScale = scaleMin; // thin along the normal
  const up = new THREE.Vector3(0, 0, 1);
  const normal = new THREE.Vector3();
  const point = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const twist = new THREE.Quaternion();

  for (let i = 0; i < count; i++) {
    if (triangles.length === 0 || totalArea <= 0) {
      // Degenerate/empty geometry: still return well-formed (zeroed) data
      // rather than throwing — a zero-triangle geometry is a caller bug, but
      // count invariants must hold for downstream code (SplatMesh, tests).
      colors.set(colorFn ? colorFn(point, up) : DEFAULT_COLOR, i * 4);
      continue;
    }

    const tri = pickTriangle(triangles, rng() * totalArea);

    // Uniform barycentric sampling (Osada et al.): sqrt(r1) folds the
    // triangle's area distortion out of a naive (r1, r2) sample.
    const r1 = rng();
    const r2 = rng();
    const sqrtR1 = Math.sqrt(r1);
    const wa = 1 - sqrtR1;
    const wb = sqrtR1 * (1 - r2);
    const wc = sqrtR1 * r2;

    point
      .set(0, 0, 0)
      .addScaledVector(tri.a, wa)
      .addScaledVector(tri.b, wb)
      .addScaledVector(tri.c, wc);

    normal
      .subVectors(tri.b, tri.a)
      .cross(new THREE.Vector3().subVectors(tri.c, tri.a))
      .normalize();
    if (!Number.isFinite(normal.x)) normal.set(0, 0, 1); // degenerate (zero-area) triangle guard

    if (jitter > 0) {
      point.addScaledVector(normal, (rng() * 2 - 1) * jitter * scaleMax);
    }

    positions[i * 3 + 0] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;

    // Tangent-plane axes get a random spread within [scaleMin, scaleMax];
    // the normal axis stays pinned near scaleMin (flattened "coin" shape).
    scales[i * 3 + 0] = scaleMin + rng() * (scaleMax - scaleMin);
    scales[i * 3 + 1] = scaleMin + rng() * (scaleMax - scaleMin);
    scales[i * 3 + 2] = normalScale;

    // Align local +Z (the flattened axis) to the surface normal, plus a
    // random twist around it so the tangent-plane axes aren't all parallel.
    quat.setFromUnitVectors(up, normal);
    twist.setFromAxisAngle(up, rng() * Math.PI * 2);
    quat.multiply(twist);

    quats[i * 4 + 0] = encodeUnitToByte(quat.x);
    quats[i * 4 + 1] = encodeUnitToByte(quat.y);
    quats[i * 4 + 2] = encodeUnitToByte(quat.z);
    quats[i * 4 + 3] = encodeUnitToByte(quat.w);

    const rgba = colorFn ? colorFn(point, normal) : DEFAULT_COLOR;
    colors[i * 4 + 0] = clampByte(rgba[0]);
    colors[i * 4 + 1] = clampByte(rgba[1]);
    colors[i * 4 + 2] = clampByte(rgba[2]);
    colors[i * 4 + 3] = clampByte(rgba[3]);
  }

  return { count, positions, scales, colors, quats };
}

function clampByte(v: number): number {
  return Math.round(Math.min(255, Math.max(0, v)));
}

// ---------------------------------------------------------------------------
// synthesizeCanScene — the demo asset (design doc §5, section 5 "Splat lounge").
// ---------------------------------------------------------------------------

// Mateína mint-flavor palette (lib/flavors.ts `mint`) — read-only reference,
// duplicated as sRGB triples here since gl/ can't import a "use client"-free
// but still app-layer module without coupling gl/ to app content structure
// (same rationale as gl/shaders/chunks.ts's brandColors, which does the same
// thing for GLSL).
const PALETTE = {
  canBody: new THREE.Color("#7CC9B5"),
  canAccent: new THREE.Color("#14574A"),
  lid: new THREE.Color("#E7E7E2"),
  table: new THREE.Color("#F9F9EE"),
  tableShadow: new THREE.Color("#1D423C"),
  puff: new THREE.Color("#24765F"),
} as const;

export const CAN_RADIUS = 42;
export const CAN_HEIGHT = 200;
const TABLE_SIZE = 520;

/** Builds a simplified can profile (radius vs height) revolved into a lathe, echoing components/svg/Can.tsx's proportions (200x480, rounded shoulders, flat lid). */
function buildCanGeometry(): THREE.LatheGeometry {
  const r = CAN_RADIUS;
  const h = CAN_HEIGHT;
  const profile = [
    new THREE.Vector2(r * 0.94, 0), // base rim
    new THREE.Vector2(r, h * 0.04),
    new THREE.Vector2(r, h * 0.92), // body, straight wall
    new THREE.Vector2(r * 0.86, h * 0.97), // shoulder taper
    new THREE.Vector2(r * 0.42, h), // lid rim
    new THREE.Vector2(0, h * 0.995), // lid center (near-flat dome)
  ];
  return new THREE.LatheGeometry(profile, 32);
}

function buildTableGeometry(): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(TABLE_SIZE, TABLE_SIZE, 1, 1);
  geo.rotateX(-Math.PI / 2); // lay flat, facing +Y
  geo.translate(0, -1, 0); // just under the can's base rim
  return geo;
}

/** A handful of soft, low-density "ambient puff" volumes floating around the
 * can — an icosphere per puff, sampled sparsely with heavy jitter for a
 * diffuse look rather than a hard-edged ball.
 *
 * Distance tuning (design-review F-004): at the original CAN_RADIUS·2.6
 * base offset the puff volumes sat between the orbit camera and the can for
 * most of the orbit, and (combined with the old 3000-splat density — see
 * synthesizeCanScene) rendered as opaque dark-green lobes that swallowed the
 * whole diorama. Pushed out past the table edge so they frame the subject. */
function buildPuffGeometries(rng: Rng): THREE.BufferGeometry[] {
  const puffs: THREE.BufferGeometry[] = [];
  const PUFF_COUNT = 6;
  for (let i = 0; i < PUFF_COUNT; i++) {
    const radius = 50 + rng() * 60;
    const geo = new THREE.IcosahedronGeometry(radius, 1);
    const angle = (i / PUFF_COUNT) * Math.PI * 2 + rng() * 0.5;
    const dist = CAN_RADIUS * 4.2 + rng() * 160;
    geo.translate(
      Math.cos(angle) * dist,
      CAN_HEIGHT * (0.2 + rng() * 0.6),
      Math.sin(angle) * dist
    );
    puffs.push(geo);
  }
  return puffs;
}

function mergeSplatData(parts: SplatData[]): SplatData {
  const count = parts.reduce((sum, p) => sum + p.count, 0);
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 4);
  const quats = new Uint8Array(count * 4);

  let offset = 0;
  for (const part of parts) {
    positions.set(part.positions, offset * 3);
    scales.set(part.scales, offset * 3);
    colors.set(part.colors, offset * 4);
    quats.set(part.quats, offset * 4);
    offset += part.count;
  }

  return { count, positions, scales, colors, quats };
}

export interface SynthesizeCanSceneOptions {
  seed?: number;
}

/**
 * Composes the whole splat-lounge demo asset into one SplatData: the can
 * body (label band darkened toward front-facing normals to fake a printed
 * label without a texture), the table it sits on, and ambient puffs
 * scattered around it. Totals land in the ~80-150k splat range the design
 * doc targets, at "high" tier counts below; scene.ts is responsible for
 * scaling counts down further per `ctx.quality` if desired.
 */
export function synthesizeCanScene(opts: SynthesizeCanSceneOptions = {}): SplatData {
  const seed = opts.seed ?? 20260130;
  const rng = mulberry32(seed);

  const canColorFn: ColorFn = (position, normal) => {
    const heightT = THREE.MathUtils.clamp(position.y / CAN_HEIGHT, 0, 1);
    if (heightT > 0.94) {
      return [PALETTE.lid.r * 255, PALETTE.lid.g * 255, PALETTE.lid.b * 255, 255];
    }
    // Front-facing band (a rough "label" without a texture): darken toward
    // the accent color when the normal faces the default camera (+Z-ish).
    // Mix weights tuned down (design-review F-004): at 0.7 the whole
    // camera-facing half of the can went near-solid accent (#14574A), so
    // the subject read as a black cylinder — the seafoam body must stay
    // the dominant read, with the accent as a tint.
    const facing = THREE.MathUtils.clamp(normal.z * 0.5 + 0.5, 0, 1);
    const isLabelBand = heightT > 0.18 && heightT < 0.72;
    const mixT = isLabelBand ? facing * 0.45 : facing * 0.08;
    const c = PALETTE.canBody.clone().lerp(PALETTE.canAccent, mixT);
    return [c.r * 255, c.g * 255, c.b * 255, 255];
  };

  const tableColorFn: ColorFn = (position) => {
    const distFromCenter = Math.hypot(position.x, position.z);
    const shadowT = THREE.MathUtils.clamp(1 - distFromCenter / (CAN_RADIUS * 4), 0, 1) * 0.35;
    const c = PALETTE.table.clone().lerp(PALETTE.tableShadow, shadowT);
    return [c.r * 255, c.g * 255, c.b * 255, 255];
  };

  const puffColorFn: ColorFn = () => [
    PALETTE.puff.r * 255,
    PALETTE.puff.g * 255,
    PALETTE.puff.b * 255,
    // Design-review F-004: was 60 — individually translucent, but with 3000
    // splats per puff dozens of them stacked along every ray, compounding
    // to a near-solid dark blob (1-(1-0.24)^20 ≈ 1). Alpha and per-puff
    // density (below) must be read TOGETHER as the haze's optical depth:
    // 350 splats × alpha 14/255 leaves ~50% transmission through a puff's
    // core — background stays readable through every puff.
    14,
  ];

  const can = synthesizeFromGeometry(buildCanGeometry(), {
    count: 90000,
    scaleRange: [0.6, 2.6],
    colorFn: canColorFn,
    jitter: 0.15,
    seed: seed + 1,
  });

  const table = synthesizeFromGeometry(buildTableGeometry(), {
    count: 22000,
    scaleRange: [3, 9],
    colorFn: tableColorFn,
    jitter: 0.05,
    seed: seed + 2,
  });

  const puffGeometries = buildPuffGeometries(rng);
  const puffs = puffGeometries.map((geo, i) =>
    synthesizeFromGeometry(geo, {
      // 350 bigger, fainter splats per puff (was 3000 × [4,14] @ alpha 60):
      // reads as actual haze instead of cauliflower — see puffColorFn note.
      count: 350,
      scaleRange: [10, 24],
      colorFn: puffColorFn,
      jitter: 0.8,
      seed: seed + 100 + i,
    })
  );

  return mergeSplatData([can, table, ...puffs]);
}

export { mergeSplatData, buildCanGeometry, buildTableGeometry };
