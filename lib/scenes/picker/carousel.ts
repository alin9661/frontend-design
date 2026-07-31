// lib/scenes/picker/carousel.ts
//
// Pure, framework-agnostic carousel state machine for the picker scene
// (docs/deep-wave-engine-design.md §5 row 6): angle-per-flavor placement
// math, damped rotation toward a selected flavor, damped centered-can
// scale-up, and damped background-tint color — all as plain numbers, with
// zero dependency on three/hero-can/gl-text. This is what actually makes
// the picker testable: scene.ts (which DOES import the can/text contracts
// per docs/deep-wave-engine-design.md, and so can't be resolved by Vitest
// until those land — see this workstream's notes) is a thin wiring layer
// over this class, so all the interesting logic lands here where it can be
// unit-tested today.
//
// Follows gl/'s layering law (§3): no document/window/react/three imports —
// worker-safe.

import { damp } from "@/lib/engine/core/math";

export const TWO_PI = Math.PI * 2;

/** Default convergence rate for both angle and color damping (see core/math damp). */
export const CAROUSEL_LAMBDA = 8;
export const BG_LAMBDA = 6;

/** Centered can scale (damped toward); flanking cans damp toward `SIDE_SCALE`. */
// Was 1.35 — trimmed slightly alongside scene.ts's RING_X_OFFSET_FACTOR
// after visually confirming the larger front can clipped the flavor-pill
// row at 1440px.
export const CENTER_SCALE = 1.2;
// Was 0.85 — a confirmed design-review finding asked flanking cans to
// "recede" more clearly (~0.7x) instead of lining up at nearly-equal size.
export const SIDE_SCALE = 0.7;

/** Wraps an angle (radians) into (-PI, PI]. */
export function wrapAngle(a: number): number {
  let wrapped = a % TWO_PI;
  if (wrapped > Math.PI) wrapped -= TWO_PI;
  if (wrapped <= -Math.PI) wrapped += TWO_PI;
  return wrapped;
}

/** Wraps an arbitrary integer index into [0, count) (handles negatives). */
export function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((Math.trunc(index) % count) + count) % count;
}

/** The carousel placement angle (radians) of flavor `index` of `count`, evenly spaced. */
export function placementAngle(index: number, count: number): number {
  if (count <= 0) return 0;
  return (index / count) * TWO_PI;
}

/**
 * The carousel ROOT rotation (radians) that brings flavor `index` to the
 * front (angle 0, facing the camera) — the negation of its own placement
 * angle, since rotating the whole group by -theta undoes that can's offset.
 */
export function targetRotationForIndex(index: number, count: number): number {
  return -placementAngle(index, count);
}

/**
 * Scale for a can currently at `effectiveAngle` (radians, its placement
 * angle plus the carousel's current rotation — i.e. its angular distance
 * from "straight ahead" after rotation is applied) — 1 at the front,
 * falling off linearly to `SIDE_SCALE` by the time it's one flavor-spacing
 * away (and clamped there beyond, for count < 3 where neighbors overlap).
 */
export function scaleForAngularOffset(
  effectiveAngle: number,
  count: number,
  centerScale: number = CENTER_SCALE,
  sideScale: number = SIDE_SCALE
): number {
  const spacing = count > 0 ? TWO_PI / count : TWO_PI;
  const normalized = spacing === 0 ? 0 : Math.min(1, Math.abs(wrapAngle(effectiveAngle)) / spacing);
  return centerScale + (sideScale - centerScale) * normalized;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** `"#rrggbb"` -> normalized (0..1) RGB. Tolerates a missing leading `#`. */
export function hexToRgb(hex: string): RGB {
  const clean = hex.replace(/^#/, "");
  const int = parseInt(clean, 16);
  return {
    r: ((int >> 16) & 255) / 255,
    g: ((int >> 8) & 255) / 255,
    b: (int & 255) / 255,
  };
}

export interface PickerCarouselOptions {
  lambda?: number;
  bgLambda?: number;
  initialIndex?: number;
}

/**
 * Owns the picker's rotation/scale/color state. `select()` sets new targets
 * (called from `invoke("select", [i])`'s cross-thread RPC, or directly);
 * `step(dt)` damps current values toward those targets every frame
 * (SceneModule.update, see ../../engine/types.ts); `scaleFor(index)` and
 * `.bg`/`.angle` are read back each frame to drive the THREE scene graph.
 */
export class PickerCarousel {
  readonly count: number;
  private bgHexByIndex: string[];
  private lambda: number;
  private bgLambda: number;

  private _selectedIndex: number;
  private _targetAngle: number;
  private _currentAngle: number;
  private _targetBg: RGB;
  private _currentBg: RGB;

  constructor(bgHexByIndex: string[], opts: PickerCarouselOptions = {}) {
    this.bgHexByIndex = bgHexByIndex;
    this.count = bgHexByIndex.length;
    this.lambda = opts.lambda ?? CAROUSEL_LAMBDA;
    this.bgLambda = opts.bgLambda ?? BG_LAMBDA;

    this._selectedIndex = wrapIndex(opts.initialIndex ?? 0, this.count);
    this._targetAngle = targetRotationForIndex(this._selectedIndex, this.count);
    this._currentAngle = this._targetAngle;
    this._targetBg = hexToRgb(this.bgHexByIndex[this._selectedIndex] ?? "#000000");
    this._currentBg = { ...this._targetBg };
  }

  get selectedIndex(): number {
    return this._selectedIndex;
  }

  /** Current damped carousel rotation, radians. */
  get angle(): number {
    return this._currentAngle;
  }

  /** Current damped background tint. */
  get bg(): RGB {
    return this._currentBg;
  }

  /** Sets new rotation/color targets for flavor `index` (wraps out-of-range indices). */
  select(index: number): void {
    const i = wrapIndex(index, this.count);
    this._selectedIndex = i;
    this._targetAngle = targetRotationForIndex(i, this.count);
    this._targetBg = hexToRgb(this.bgHexByIndex[i] ?? "#000000");
  }

  /**
   * SceneModule.invoke's dispatch table (see ../../engine/types.ts) — the
   * cross-thread RPC path from `useEngine().invoke(viewId, "select", [i])`
   * (SCENE_INVOKE over postMessage in worker mode). Unknown methods and
   * malformed args are ignored rather than throwing: a stray/future RPC
   * must not crash the render loop.
   */
  invoke(method: string, args: unknown[]): void {
    if (method !== "select") return;
    const index = args[0];
    if (typeof index !== "number" || !Number.isFinite(index)) return;
    this.select(index);
  }

  /** Damps rotation and color one tick toward their current targets. Idempotent at convergence. */
  step(dt: number): void {
    this._currentAngle = wrapAngle(
      damp(this._currentAngle, this.nearestEquivalentTarget(), this.lambda, dt)
    );
    this._currentBg = {
      r: damp(this._currentBg.r, this._targetBg.r, this.bgLambda, dt),
      g: damp(this._currentBg.g, this._targetBg.g, this.bgLambda, dt),
      b: damp(this._currentBg.b, this._targetBg.b, this.bgLambda, dt),
    };
  }

  /** The centered can's scale-up factor for `index`, given the carousel's current rotation. */
  scaleFor(index: number): number {
    const effective = placementAngle(index, this.count) + this._currentAngle;
    return scaleForAngularOffset(effective, this.count);
  }

  /** True once rotation and color have both damped within `epsilon` of their targets. */
  converged(epsilon: number = 1e-3): boolean {
    const angleClose = Math.abs(wrapAngle(this._targetAngle - this._currentAngle)) < epsilon;
    const bgClose =
      Math.abs(this._targetBg.r - this._currentBg.r) < epsilon &&
      Math.abs(this._targetBg.g - this._currentBg.g) < epsilon &&
      Math.abs(this._targetBg.b - this._currentBg.b) < epsilon;
    return angleClose && bgClose;
  }

  /**
   * Picks whichever of `_targetAngle`, `_targetAngle + 2π`, `_targetAngle - 2π`
   * is numerically closest to `_currentAngle` — so damping always takes the
   * short way around the carousel instead of unwrapping the long way when
   * e.g. selecting index 0 from index (count-1).
   */
  private nearestEquivalentTarget(): number {
    const delta = wrapAngle(this._targetAngle - this._currentAngle);
    return this._currentAngle + delta;
  }
}
