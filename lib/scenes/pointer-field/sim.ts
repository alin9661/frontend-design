// lib/scenes/pointer-field/sim.ts
//
// Pure spring-field simulation for the "pointer-field" scene (design doc §5
// row 4): typed-array per-instance home/pos/vel driven by core/pointer's
// pure `springStep` integrator, plus a radial-impulse helper used both for
// the continuous pointer-velocity shove and one-shot click/impulse bursts.
// No THREE, DOM, or window import — scene.ts is the THREE-facing wrapper;
// this file is what's actually unit-tested and stays reusable from either
// host (worker or main-thread fallback) per the gl/ layering law.

import { springStep } from "@/lib/engine/core/pointer";
import { clamp } from "@/lib/engine/core/math";
import { decor } from "@/lib/flavors";

export interface PointerFieldOptions {
  /** Spring constant pulling each item back toward its home position. */
  stiffness?: number;
  /** Spring damping (higher = settles faster, less overshoot). */
  damping?: number;
}

const DEFAULT_STIFFNESS = 90;
const DEFAULT_DAMPING = 12;

/**
 * Smooth radial falloff: 1 at `distance` 0, decaying to 0 at `distance ===
 * radius` (smoothstep shape, so it eases out rather than cutting off
 * linearly), and 0 for any distance beyond `radius`. Pure.
 */
export function influenceFalloff(distance: number, radius: number): number {
  if (radius <= 0) return 0;
  if (distance >= radius) return 0;
  if (distance <= 0) return 1;
  const t = clamp(distance / radius, 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Typed-array home/pos/vel field for `count` instances, advanced by the
 * shared semi-implicit-Euler `springStep` integrator. Items always spring
 * back toward their home position; `applyRadialImpulse` adds outward
 * velocity to whatever is currently within `radius` of a world-space point
 * — called with a small per-frame strength for continuous pointer-velocity
 * shove, or a single large strength for a click/impulse burst.
 */
export class PointerFieldSim {
  readonly count: number;
  readonly homeX: Float32Array;
  readonly homeY: Float32Array;
  readonly posX: Float32Array;
  readonly posY: Float32Array;
  readonly velX: Float32Array;
  readonly velY: Float32Array;
  private readonly stiffness: number;
  private readonly damping: number;

  constructor(homeX: ArrayLike<number>, homeY: ArrayLike<number>, opts: PointerFieldOptions = {}) {
    if (homeX.length !== homeY.length) {
      throw new Error("PointerFieldSim: homeX/homeY length mismatch");
    }
    this.count = homeX.length;
    this.homeX = Float32Array.from(homeX);
    this.homeY = Float32Array.from(homeY);
    this.posX = Float32Array.from(homeX);
    this.posY = Float32Array.from(homeY);
    this.velX = new Float32Array(this.count);
    this.velY = new Float32Array(this.count);
    this.stiffness = opts.stiffness ?? DEFAULT_STIFFNESS;
    this.damping = opts.damping ?? DEFAULT_DAMPING;
  }

  /**
   * Adds outward velocity to every item within `radius` of (x, y), scaled by
   * `strength` and the smooth falloff. A no-op when `radius <= 0` or
   * `strength === 0`.
   */
  applyRadialImpulse(x: number, y: number, radius: number, strength: number): void {
    if (radius <= 0 || strength === 0) return;
    for (let i = 0; i < this.count; i++) {
      const dx = this.posX[i]! - x;
      const dy = this.posY[i]! - y;
      const dist = Math.hypot(dx, dy);
      if (dist >= radius) continue;
      const falloff = influenceFalloff(dist, radius);
      // Push directly away from (x, y); guard the degenerate dist===0 case
      // (item exactly under the pointer/click) with a stable direction so it
      // doesn't get a NaN/zero-length push.
      const nx = dist > 1e-6 ? dx / dist : 1;
      const ny = dist > 1e-6 ? dy / dist : 0;
      this.velX[i]! += nx * strength * falloff;
      this.velY[i]! += ny * strength * falloff;
    }
  }

  /**
   * Advances every item one step: springs toward home, integrated with the
   * shared `springStep`. Call `applyRadialImpulse` (if any) first each
   * frame, then `step`.
   */
  step(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      const rx = springStep(this.posX[i]!, this.velX[i]!, this.homeX[i]!, this.stiffness, this.damping, dt);
      const ry = springStep(this.posY[i]!, this.velY[i]!, this.homeY[i]!, this.stiffness, this.damping, dt);
      this.posX[i] = rx.pos;
      this.velX[i] = rx.vel;
      this.posY[i] = ry.pos;
      this.velY[i] = ry.vel;
    }
  }

  /** Snaps every item back to its home position at rest — the reduced-motion
   * "static grid" path, and what a fresh/re-run `init()` starts from. */
  reset(): void {
    this.posX.set(this.homeX);
    this.posY.set(this.homeY);
    this.velX.fill(0);
    this.velY.fill(0);
  }
}

/**
 * Deterministic home-position layout: an evenly spaced grid across
 * `width`x`height`, centered at the origin (matches View's 1-unit=1px, y-up
 * camera convention — design doc §4 gl/stage.ts,view.ts), with optional
 * per-item jitter for an organic scatter. `jitter === 0` yields the literal
 * static grid the reduced-motion path renders (design doc §5 row 4:
 * "reducedMotion → static grid"). Uses a tiny seeded PRNG (not Math.random)
 * so the layout — and any test asserting against it — is reproducible.
 */
export function createHomeGrid(
  count: number,
  width: number,
  height: number,
  jitter = 0,
  seed = 1
): { x: Float32Array; y: Float32Array } {
  const safeCount = Math.max(0, Math.floor(count));
  const cols = Math.max(1, Math.round(Math.sqrt((safeCount * Math.max(width, 1e-6)) / Math.max(height, 1e-6))));
  const rows = Math.max(1, Math.ceil(safeCount / cols));
  const cellW = width / cols;
  const cellH = height / rows;
  const x = new Float32Array(safeCount);
  const y = new Float32Array(safeCount);
  const rand = mulberry32(seed);

  for (let i = 0; i < safeCount; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = (col + 0.5) * cellW - width / 2;
    const cy = height / 2 - (row + 0.5) * cellH;
    const jx = jitter > 0 ? (rand() * 2 - 1) * jitter * cellW * 0.5 : 0;
    const jy = jitter > 0 ? (rand() * 2 - 1) * jitter * cellH * 0.5 : 0;
    x[i] = cx + jx;
    y[i] = cy + jy;
  }
  return { x, y };
}

/** Deterministic 32-bit PRNG (mulberry32) — small, seedable, good enough for
 * a cosmetic layout jitter. Returns floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FieldItemKind = "leaf" | "berry";

const LEAF_COLORS = [decor.leafDark, decor.leafLight];
const BERRY_COLORS = [decor.citrusLemon, decor.citrusPeach, decor.berry];

/**
 * Deterministic decor-palette color (as a 0xRRGGBB number, ready for
 * `THREE.Color.setHex`) for instance `index` of the given kind —
 * round-robins the decor palette so ~300 instances read as a varied,
 * on-brand field rather than a single flat color, with no per-instance
 * randomness so the mapping is reproducible and testable.
 */
export function colorForInstance(index: number, kind: FieldItemKind): number {
  const palette = kind === "leaf" ? LEAF_COLORS : BERRY_COLORS;
  const hex = palette[((index % palette.length) + palette.length) % palette.length]!;
  return hexToNumber(hex);
}

function hexToNumber(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}
