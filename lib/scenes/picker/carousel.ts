// lib/scenes/picker/carousel.ts
//
// Pure, framework-agnostic carousel state machine for the picker scene
// (docs/deep-wave-engine-design.md §5 row 6): angle-per-flavor placement
// math, spring-integrated rotation toward a selected flavor, a
// smoothstep-eased centered-can scale-up, and damped background-tint color
// (B1: rotation and scale stopped being `damp()`-based when N8 replaced
// rotation with a spring and reworked the scale falloff — see
// `integrateAngleSpring` and `scaleForAngularOffset` below; color is still
// genuinely `damp()`-driven) — all as plain numbers, with zero dependency on
// three/hero-can/gl-text. This is what actually makes the picker testable:
// scene.ts (which DOES import the can/text contracts per
// docs/deep-wave-engine-design.md, and so can't be resolved by Vitest until
// those land — see this workstream's notes) is a thin wiring layer over this
// class, so all the interesting logic lands here where it can be
// unit-tested today.
//
// Follows gl/'s layering law (§3): no document/window/react/three imports —
// worker-safe. (H4: this used to import `springStep` from
// `core/pointer.ts`, which binds `window`/registers DOM listeners — that
// made the claim above literally false, even though nothing evaluated at
// module scope so the worker didn't actually break. `integrateAngleSpring`
// below now inlines the same semi-implicit-Euler math directly instead of
// calling the shared `core/math.ts` `springStep` helper — partly to restore
// this file's own worker-safety independent of where `springStep` lives,
// partly for C1's allocation-free sub-stepping. See core/math.ts's
// `springStep` for the canonical, tested version of this integrator.)

import { damp, smoothstep } from "@/lib/engine/core/math";

export const TWO_PI = Math.PI * 2;

/**
 * Motion-audit fix N8: rotation used to converge via `damp()` (exponential
 * decay) — maximum velocity right at the click, then a long, slowly-decaying
 * creep tail as it approached the target. Replaced with a critically-damped-
 * ish spring (see `integrateAngleSpring` below, and core/math.ts's
 * `springStep` for the canonical integrator it inlines) for an
 * accelerate-then-settle feel instead: starts at rest, ramps up, eases into
 * the target rather than crawling up to it asymptotically forever.
 */
export const CAROUSEL_STIFFNESS = 110;
export const CAROUSEL_DAMPING = 17;
/** Background-tint convergence rate (unchanged — see core/math's `damp`). */
export const BG_LAMBDA = 6;

/**
 * C1 fix: was `1 / 1000` — a semi-implicit Euler integrator (like the one
 * this sub-steps) is stable at a given step size roughly up to
 * `2 / omega_n`, and at `CAROUSEL_STIFFNESS` 110 (`omega_n = sqrt(stiffness)
 * ≈ 10.5 rad/s`) that's well past a single 64ms frame (the engine's own
 * `MAX_DT_S` clamp, worker/frame-shared.ts) — so 1ms sub-stepping was ~17x
 * finer than the stability requirement actually needs, costing ~17
 * allocation-free-now-but-previously-allocating iterations every frame even
 * once the carousel had settled. Raised to `1/240` (~4.17ms): still far
 * inside the stable range, ~4x fewer iterations per frame. */
const SPRING_SUBSTEP_MAX = 1 / 240;
/** C1 fix: the sub-step loop used to be bounded only by the CALLER's
 * MAX_DT_S clamp (worker/frame-shared.ts), not by itself — this makes
 * `integrateAngleSpring` own its bound regardless of caller, so an
 * unexpectedly large `dt` (a multi-second stall, a hand-rolled test) still
 * degrades to a coarser (but per SPRING_SUBSTEP_MAX's comment, still
 * numerically stable) sub-step size instead of the loop itself growing
 * unbounded. */
const MAX_SUBSTEPS = 64;
/** Below these thresholds the spring is close enough to rest that residual
 * (sub-visible) float jitter would otherwise linger indefinitely — snap to
 * the exact target instead of asymptotically approaching it forever. Also
 * used by `converged()` (H2) to mean "actually at rest", not just
 * "momentarily passing through the target". */
const ANGLE_SETTLE_EPSILON = 1e-4; // rad
const ANGLE_VELOCITY_SETTLE_EPSILON = 1e-3; // rad/s

/** Integrates a critically-damped-ish spring from `pos`/`vel` toward `target`
 * over `dt`, internally sub-stepping so large `dt` values stay stable and
 * (approximately) frame-rate independent. Snaps to `target` (zero velocity)
 * once both position error and velocity are below their settle epsilons, so
 * the carousel doesn't oscillate/creep forever at tiny deltas.
 *
 * C1 fix: early-outs before the loop when already at rest (PickerScene.update
 * calls `carousel.step(dt)` every frame for the view's whole lifetime, so a
 * long-settled carousel used to still pay for a sub-stepped loop — and its
 * per-substep `{pos,vel}` allocation — every frame forever). The loop itself
 * now integrates two local scalars directly (the same semi-implicit-Euler
 * math as core/math.ts's `springStep`) instead of calling it, so it stays
 * allocation-free per sub-step too — only the final returned object
 * allocates. */
function integrateAngleSpring(
  pos: number,
  vel: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number
): { pos: number; vel: number } {
  if (Math.abs(target - pos) < ANGLE_SETTLE_EPSILON && Math.abs(vel) < ANGLE_VELOCITY_SETTLE_EPSILON) {
    return { pos: target, vel: 0 };
  }

  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / SPRING_SUBSTEP_MAX)));
  const subDt = dt / steps;
  let p = pos;
  let v = vel;
  for (let i = 0; i < steps; i++) {
    const force = (target - p) * stiffness - v * damping;
    v = v + force * subDt;
    p = p + v * subDt;
  }
  if (Math.abs(target - p) < ANGLE_SETTLE_EPSILON && Math.abs(v) < ANGLE_VELOCITY_SETTLE_EPSILON) {
    return { pos: target, vel: 0 };
  }
  return { pos: p, vel: v };
}

/** Centered can scale, eased (smoothstep) as angular offset from front grows;
 * flanking cans ease the same way toward `SIDE_SCALE`. */
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
 * easing (smoothstep) off to `SIDE_SCALE` by the time it's one
 * flavor-spacing away (and clamped there beyond, for count < 3 where
 * neighbors overlap).
 */
export function scaleForAngularOffset(
  effectiveAngle: number,
  count: number,
  centerScale: number = CENTER_SCALE,
  sideScale: number = SIDE_SCALE
): number {
  const spacing = count > 0 ? TWO_PI / count : TWO_PI;
  const normalized = spacing === 0 ? 0 : Math.min(1, Math.abs(wrapAngle(effectiveAngle)) / spacing);
  // Motion-audit fix N8: falloff used to be a raw linear lerp on `normalized`,
  // which reads fine mid-range but has an obvious velocity corner right at
  // the `clamp`'s boundary (one flavor-spacing away) where the slope
  // discontinuously drops to zero. Smoothstepping `normalized` first eases
  // the can's scale across that boundary instead of hard-cornering into it.
  const eased = smoothstep(normalized);
  return centerScale + (sideScale - centerScale) * eased;
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
  /** Rotation spring stiffness (see core/math.ts's `springStep`). */
  stiffness?: number;
  /** Rotation spring damping (see core/math.ts's `springStep`). */
  damping?: number;
  bgLambda?: number;
  initialIndex?: number;
}

/**
 * Owns the picker's rotation/scale/color state. `select()` sets new targets
 * (called from `invoke("select", [i])`'s cross-thread RPC, or directly);
 * `step(dt)` springs/damps current values toward those targets every frame
 * (SceneModule.update, see ../../engine/types.ts); `scaleFor(index)` and
 * `.bg`/`.angle` are read back each frame to drive the THREE scene graph.
 */
export class PickerCarousel {
  readonly count: number;
  private bgHexByIndex: string[];
  private stiffness: number;
  private damping: number;
  private bgLambda: number;

  private _selectedIndex: number;
  private _targetAngle: number;
  private _currentAngle: number;
  private _angleVel = 0;
  private _targetBg: RGB;
  private _currentBg: RGB;

  constructor(bgHexByIndex: string[], opts: PickerCarouselOptions = {}) {
    this.bgHexByIndex = bgHexByIndex;
    this.count = bgHexByIndex.length;
    this.stiffness = opts.stiffness ?? CAROUSEL_STIFFNESS;
    this.damping = opts.damping ?? CAROUSEL_DAMPING;
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

  /** Current spring-integrated carousel rotation, radians. */
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

  /**
   * Springs rotation and damps color one tick toward their current targets.
   * Idempotent at convergence (once settled, repeated calls are a no-op).
   */
  step(dt: number): void {
    const spring = integrateAngleSpring(
      this._currentAngle,
      this._angleVel,
      this.nearestEquivalentTarget(),
      this.stiffness,
      this.damping,
      dt
    );
    this._angleVel = spring.vel;
    this._currentAngle = wrapAngle(spring.pos);

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

  /**
   * True once color has damped within `epsilon` of its target AND rotation
   * is actually AT REST there — both position within `epsilon` of the
   * target and velocity below `ANGLE_VELOCITY_SETTLE_EPSILON`.
   *
   * H2 fix: `damp()`'s exponential approach is monotonic, so a
   * position-only check was sound for it — but rotation is a spring now
   * (N8), and at `CAROUSEL_STIFFNESS`/`CAROUSEL_DAMPING`'s default ratio
   * (ζ ≈ 0.81, underdamped) it overshoots and crosses the target at full
   * speed before settling. A position-only check reported "converged" at
   * that crossing, mid-flight. The velocity term restores "converged" to
   * actually meaning "at rest".
   */
  converged(epsilon: number = 1e-3): boolean {
    const angleClose =
      Math.abs(wrapAngle(this._targetAngle - this._currentAngle)) < epsilon &&
      Math.abs(this._angleVel) < ANGLE_VELOCITY_SETTLE_EPSILON;
    const bgClose =
      Math.abs(this._targetBg.r - this._currentBg.r) < epsilon &&
      Math.abs(this._targetBg.g - this._currentBg.g) < epsilon &&
      Math.abs(this._targetBg.b - this._currentBg.b) < epsilon;
    return angleClose && bgClose;
  }

  /**
   * Picks whichever of `_targetAngle`, `_targetAngle + 2π`, `_targetAngle - 2π`
   * is numerically closest to `_currentAngle` — so the rotation spring
   * always takes the short way around the carousel instead of unwrapping
   * the long way when e.g. selecting index 0 from index (count-1).
   */
  private nearestEquivalentTarget(): number {
    const delta = wrapAngle(this._targetAngle - this._currentAngle);
    return this._currentAngle + delta;
  }
}
