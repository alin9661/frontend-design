// lib/engine/core/math.ts
//
// Pure numeric primitives shared across the engine (see design doc §4,
// core/math.ts). `damp` is THE smoothing primitive — every other core
// module (scroll.ts, pointer.ts) builds its frame-rate-independent
// interpolation on top of it. Everything here is side-effect free and takes
// no DOM/three dependency, per the core/ layering law (§3).

/** Linear interpolation: `a` at t=0, `b` at t=1. Not clamped. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frame-rate-independent exponential smoothing (Freya Holmer's "damp").
 * Converges `a` toward `b` at rate `lambda` (higher = snappier), regardless
 * of `dt` — calling it once with dt=32ms gives (approximately) the same
 * result as calling it twice with dt=16ms.
 */
export function damp(a: number, b: number, lambda: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}

/** Clamps `v` into [min, max]. Works even if min > max (order-independent). */
export function clamp(v: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Remaps `v` from [inMin, inMax] into [outMin, outMax]. When `clampOut` is
 * true, the result is clamped into the output range (order-independent, so
 * a descending output range like [1, 0] still clamps correctly).
 */
export function mapRange(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
  clampOut = false
): number {
  const inRange = inMax - inMin;
  const t = inRange === 0 ? 0 : (v - inMin) / inRange;
  const out = lerp(outMin, outMax, t);
  return clampOut ? clamp(out, outMin, outMax) : out;
}

/** Decelerating exponential ease-out; exact 1 at t=1 (no asymptotic tail). */
export function easeOutExpo(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(2, -10 * t);
}

/** Symmetric cubic ease-in-out. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Cubic ease-out that overshoots past 1 before settling ("back" easing). */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
