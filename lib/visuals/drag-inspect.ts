// lib/visuals/drag-inspect.ts
//
// The pure interaction core behind "drag the can to inspect it": pointer
// coordinates in, rotation state out. No three.js, no React, no DOM, no
// globals — the integrator owns the listeners and the render rig, this owns
// the gesture arbitration and the numbers.
//
// The whole reason this exists as a standalone state machine is AXIS LOCK.
// The origin film is a 1200svh/1500svh vertical scroll, so an inspector that
// grabs every pointer gesture eats the page's scroll on touch. The machine is
// therefore explicitly undecided (`axis: "none"`) until the pointer travels
// past `axisLockThreshold`, and it NEVER asks for `preventDefault()` while
// undecided. Once vertical wins, the gesture is dead to the inspector for its
// entire remaining life (see `axisLatched` below); once horizontal wins, the
// inspector owns both screen axes for the rest of that gesture.
//
// THE ONE NON-OBVIOUS DECISION: inertia and spring-back are integrated with
// the CLOSED-FORM solution of `v' = -damping*v; u' = v - returnSpring*u`
// (`integrateAxis`), not with a per-frame Euler/`springStep` loop. An Euler
// spring is not frame-rate independent — one 100ms step overshoots where ten
// 10ms steps do not, which on a scroll-driven film means the can settles in a
// different pose on a 30fps phone than on a 120fps laptop. The exact flow of a
// linear ODE composes (φ(a+b) = φ(a)∘φ(b)), so `update(0.1)` and ten
// `update(0.01)` calls agree to floating-point noise. That property is
// asserted directly in the tests.

import { clamp, damp } from "@/lib/engine/core/math";

/** Which screen axis the current gesture was locked to. */
export type DragAxis = "none" | "horizontal" | "vertical";

export interface DragInspectorOptions {
  /** Pointer travel (CSS px) before the gesture commits to an axis. Below
   * this the machine consumes nothing and rotates nothing. Default 8. */
  axisLockThreshold?: number;
  /** Radians of rotation per CSS px of pointer travel. Default 0.01. */
  sensitivity?: number;
  /** Exponential decay rate (1/s) of the post-release flick velocity. Higher
   * stops sooner. Default 3.5. */
  damping?: number;
  /** Exponential rate (1/s) at which the pose is pulled back to the rest pose
   * after release. 0 (the default) disables spring-back entirely, leaving the
   * can wherever inertia parked it. */
  returnSpring?: number;
  /** Rest pose the spring targets. Defaults to 0/0. */
  restYaw?: number;
  restPitch?: number;
  /** Pitch clamp, radians. Yaw is deliberately unclamped (it wraps). */
  minPitch?: number;
  maxPitch?: number;
  /** When true the can follows the finger exactly and stops dead on release:
   * no inertia, no spring-back. Default false. */
  reducedMotion?: boolean;
  /** Smoothing rate (1/s) for the drag velocity estimate feeding the flick.
   * Default 20. */
  velocitySmoothing?: number;
}

export interface DragInspectorState {
  /** Radians, wrapped into (-PI, PI]. Drag right => yaw increases. */
  readonly yaw: number;
  /** Radians, clamped into [minPitch, maxPitch]. Drag down => pitch increases. */
  readonly pitch: number;
  /** A pointer is down and the page has NOT been handed the gesture, i.e.
   * the axis is still undecided or locked horizontal. False the moment a
   * vertical lock releases the gesture back to the scroller. */
  readonly dragging: boolean;
  readonly axis: DragAxis;
  /** True only while the inspector owns the gesture (pointer down AND axis
   * locked horizontal). The integrator must call `preventDefault()` when and
   * only when this is true. */
  readonly shouldPreventDefault: boolean;
  readonly yawVelocity: number;
  readonly pitchVelocity: number;
  /** Nothing left to animate: not dragging, velocities at rest, and (when
   * spring-back is enabled) sitting on the rest pose. The integrator may stop
   * ticking until the next pointer event. */
  readonly settled: boolean;
}

export interface DragInspector {
  /** Begins a gesture. ALWAYS returns false — a pointerdown is never enough
   * information to steal the page's scroll. */
  onPointerDown(x: number, y: number): boolean;
  /** Feeds a move. Returns `shouldPreventDefault` for this event. */
  onPointerMove(x: number, y: number): boolean;
  /** Ends the gesture, handing any measured velocity to the inertia. */
  onPointerUp(): void;
  /** Ends the gesture the way the browser cancels one: stops dead. */
  onPointerCancel(): void;
  /** Advances inertia/spring-back by `dt` SECONDS, and samples drag velocity
   * while a drag is in progress. Non-finite or non-positive `dt` is a no-op. */
  update(dt: number): void;
  /** Snaps back to the rest pose and clears the gesture. */
  reset(): void;
  readonly state: DragInspectorState;
}

/**
 * The `touch-action` the hit element MUST carry, as a policy constant so the
 * integrator cannot drift from what this machine assumes:
 *
 *   `pan-y` lets the browser keep vertical panning natively (the film's scroll
 *   never stutters, even on the frames before our JS runs) while handing
 *   horizontal gestures to us. `shouldPreventDefault` then suppresses only the
 *   gestures we actually took. `none` would make the can a scroll trap;
 *   `auto` would make horizontal drags fight native overscroll.
 *
 *   `pinch-zoom` is the second half of the value and is NOT optional. A bare
 *   `pan-y` also revokes pinch-to-zoom for every pixel of the element and of
 *   its whole subtree — the UA intersects `touch-action` down the ancestor
 *   chain — which on a full-viewport stage is a WCAG 1.4.4 failure across the
 *   entire section. Zooming is not a gesture this machine wants, so it is
 *   handed straight back.
 *
 * Two integrator rules follow from that same intersection rule, and
 * `DRAG_INSPECT_SCOPE_NOTE` restates them at the use site:
 *
 *   1. Put this on the smallest element that can host the drag, never on an
 *      ancestor of unrelated UI — anything nested inside inherits the
 *      restriction and cannot opt back out (a horizontally scrollable strip
 *      under a `pan-y` ancestor simply stops panning).
 *   2. Apply it only while inspection can actually be honoured. An element
 *      that advertises `pan-y` when no drag will ever be arbitrated is paying
 *      the cost (the platform's own edge-swipe gestures included) for nothing.
 */
export const DRAG_INSPECT_TOUCH_ACTION = "pan-y pinch-zoom";

/** The value to apply when inspection is NOT live — see rule 2 above. */
export const DRAG_INSPECT_TOUCH_ACTION_IDLE = "auto";

export const DRAG_INSPECT_DEFAULTS = {
  axisLockThreshold: 8,
  sensitivity: 0.01,
  damping: 3.5,
  returnSpring: 0,
  restYaw: 0,
  restPitch: 0,
  minPitch: -0.45,
  maxPitch: 0.45,
  reducedMotion: false,
  velocitySmoothing: 20,
} as const;

const TWO_PI = Math.PI * 2;
/** Below this (rad/s) a flick counts as stopped. */
const VELOCITY_EPSILON = 1e-3;
/** Below this (rad) the pose counts as sitting on the rest pose. */
const ANGLE_EPSILON = 1e-3;
/** `integrateAxis` switches to its repeated-root form inside this gap. */
const RATE_TIE_EPSILON = 1e-9;

/** Wraps an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  const r = a % TWO_PI;
  if (r > Math.PI) return r - TWO_PI;
  if (r <= -Math.PI) return r + TWO_PI;
  return r;
}

/**
 * Closed-form flow of `v' = -lambda*v`, `u' = v - k*u` over `dt`, where `u` is
 * the offset from the rest pose. Exact, therefore frame-rate independent: one
 * step of `dt` equals N steps summing to `dt`. `k = 0` degrades to pure damped
 * inertia; `lambda = 0` to an undamped carrier pulled toward rest.
 */
export function integrateAxis(
  u0: number,
  v0: number,
  lambda: number,
  k: number,
  dt: number
): { u: number; v: number } {
  const eL = Math.exp(-lambda * dt);
  const v = v0 * eL;
  if (Math.abs(k - lambda) < RATE_TIE_EPSILON) {
    // Repeated root (covers the common lambda === k === 0 case as u0 + v0*dt).
    return { u: u0 * eL + v0 * dt * eL, v };
  }
  const eK = Math.exp(-k * dt);
  return { u: u0 * eK + (v0 * (eL - eK)) / (k - lambda), v };
}

export function createDragInspector(options: DragInspectorOptions = {}): DragInspector {
  const axisLockThreshold = options.axisLockThreshold ?? DRAG_INSPECT_DEFAULTS.axisLockThreshold;
  const sensitivity = options.sensitivity ?? DRAG_INSPECT_DEFAULTS.sensitivity;
  const damping = options.damping ?? DRAG_INSPECT_DEFAULTS.damping;
  const returnSpring = options.returnSpring ?? DRAG_INSPECT_DEFAULTS.returnSpring;
  const restYaw = options.restYaw ?? DRAG_INSPECT_DEFAULTS.restYaw;
  const restPitch = options.restPitch ?? DRAG_INSPECT_DEFAULTS.restPitch;
  const minPitch = Math.min(
    options.minPitch ?? DRAG_INSPECT_DEFAULTS.minPitch,
    options.maxPitch ?? DRAG_INSPECT_DEFAULTS.maxPitch
  );
  const maxPitch = Math.max(
    options.minPitch ?? DRAG_INSPECT_DEFAULTS.minPitch,
    options.maxPitch ?? DRAG_INSPECT_DEFAULTS.maxPitch
  );
  const reducedMotion = options.reducedMotion ?? DRAG_INSPECT_DEFAULTS.reducedMotion;
  const velocitySmoothing = options.velocitySmoothing ?? DRAG_INSPECT_DEFAULTS.velocitySmoothing;

  let yaw = wrapAngle(restYaw);
  let pitch = clamp(restPitch, minPitch, maxPitch);
  let yawVelocity = 0;
  let pitchVelocity = 0;

  // Gesture bookkeeping.
  let pointerDown = false;
  let axis: DragAxis = "none";
  /** Once the axis is decided it never changes again for this gesture — a
   * user who starts scrolling and then wiggles sideways must never have the
   * scroll stolen mid-flick. */
  let axisLatched = false;
  let originX = 0;
  let originY = 0;
  /** Rebased to the pointer position at the moment of the horizontal lock, so
   * committing to the gesture does not snap the can by `axisLockThreshold` px. */
  let lastX = 0;
  let lastY = 0;
  /** Rotation applied since the last `update()`, used to measure flick speed. */
  let pendingYaw = 0;
  let pendingPitch = 0;
  /** Last positive dt seen, so a pointerup landing between frames can still
   * convert its unsampled travel into velocity. */
  let lastDt = 0;

  let snapshot: DragInspectorState | null = null;

  function invalidate(): void {
    snapshot = null;
  }

  function isSettled(): boolean {
    // A gesture that is still undecided (or already ours) may yet move things;
    // one handed to the scroller never will.
    if (pointerDown && axis !== "vertical") return false;
    if (Math.abs(yawVelocity) > VELOCITY_EPSILON) return false;
    if (Math.abs(pitchVelocity) > VELOCITY_EPSILON) return false;
    // Reduced motion disables spring-back, so "on the rest pose" is not part
    // of resting there — the can stops dead wherever the finger left it.
    if (!reducedMotion && returnSpring > 0) {
      if (Math.abs(wrapAngle(yaw - restYaw)) > ANGLE_EPSILON) return false;
      if (Math.abs(pitch - restPitch) > ANGLE_EPSILON) return false;
    }
    return true;
  }

  function owns(): boolean {
    return pointerDown && axis === "horizontal";
  }

  function applyPointerDelta(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    const dYaw = dx * sensitivity;
    yaw = wrapAngle(yaw + dYaw);
    pendingYaw += dYaw;

    const nextPitch = clamp(pitch + dy * sensitivity, minPitch, maxPitch);
    pendingPitch += nextPitch - pitch;
    pitch = nextPitch;
    invalidate();
  }

  /** Turns unsampled drag travel into a smoothed velocity estimate. */
  function sampleVelocity(dt: number): void {
    if (dt <= 0) return;
    const instYaw = pendingYaw / dt;
    const instPitch = pendingPitch / dt;
    yawVelocity = damp(yawVelocity, instYaw, velocitySmoothing, dt);
    pitchVelocity = damp(pitchVelocity, instPitch, velocitySmoothing, dt);
    pendingYaw = 0;
    pendingPitch = 0;
    invalidate();
  }

  function endGesture(keepVelocity: boolean): void {
    if (!pointerDown) return;
    if (keepVelocity && !reducedMotion) {
      // A release between frames still carries its last, unsampled travel.
      if ((pendingYaw !== 0 || pendingPitch !== 0) && lastDt > 0) sampleVelocity(lastDt);
    } else {
      yawVelocity = 0;
      pitchVelocity = 0;
    }
    pendingYaw = 0;
    pendingPitch = 0;
    pointerDown = false;
    axis = "none";
    axisLatched = false;
    invalidate();
  }

  return {
    onPointerDown(x: number, y: number): boolean {
      pointerDown = true;
      axis = "none";
      axisLatched = false;
      originX = x;
      originY = y;
      lastX = x;
      lastY = y;
      pendingYaw = 0;
      pendingPitch = 0;
      // Grabbing the can kills any in-flight inertia; the finger is authority.
      yawVelocity = 0;
      pitchVelocity = 0;
      invalidate();
      return false;
    },

    onPointerMove(x: number, y: number): boolean {
      if (!pointerDown) return false;

      if (!axisLatched) {
        const dx = x - originX;
        const dy = y - originY;
        if (Math.max(Math.abs(dx), Math.abs(dy)) >= axisLockThreshold) {
          // Ties go to the page: stealing a scroll is far worse than missing
          // an inspect.
          axis = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
          axisLatched = true;
          // Rebase so the rotation starts from the lock point, not the origin.
          lastX = x;
          lastY = y;
          invalidate();
        } else {
          // Undecided: consume nothing, rotate nothing.
          return false;
        }
      }

      if (axis !== "horizontal") return false;

      applyPointerDelta(x - lastX, y - lastY);
      lastX = x;
      lastY = y;
      return true;
    },

    onPointerUp(): void {
      endGesture(true);
    },

    onPointerCancel(): void {
      endGesture(false);
    },

    update(dt: number): void {
      if (!Number.isFinite(dt) || dt <= 0) return;
      lastDt = dt;

      if (owns()) {
        sampleVelocity(dt);
        return;
      }
      if (pointerDown) return; // undecided or handed to the scroller

      if (reducedMotion) {
        // Stops dead on release: no inertia, no spring-back.
        yawVelocity = 0;
        pitchVelocity = 0;
        invalidate();
        return;
      }

      // NB: no epsilon-snapping of the integrated result — any such shortcut is
      // step-size dependent and would break the frame-rate independence above.
      // `settled` reports the resting threshold instead.
      const y = integrateAxis(wrapAngle(yaw - restYaw), yawVelocity, damping, returnSpring, dt);
      yaw = wrapAngle(restYaw + y.u);
      yawVelocity = y.v;

      const p = integrateAxis(pitch - restPitch, pitchVelocity, damping, returnSpring, dt);
      const rawPitch = restPitch + p.u;
      pitch = clamp(rawPitch, minPitch, maxPitch);
      // Hitting the clamp must kill the velocity, or the can sits at the limit
      // with stored energy and springs off it later.
      pitchVelocity = pitch !== rawPitch ? 0 : p.v;

      invalidate();
    },

    reset(): void {
      yaw = wrapAngle(restYaw);
      pitch = clamp(restPitch, minPitch, maxPitch);
      yawVelocity = 0;
      pitchVelocity = 0;
      pointerDown = false;
      axis = "none";
      axisLatched = false;
      pendingYaw = 0;
      pendingPitch = 0;
      invalidate();
    },

    get state(): DragInspectorState {
      if (snapshot === null) {
        snapshot = Object.freeze({
          yaw,
          pitch,
          dragging: pointerDown && axis !== "vertical",
          axis,
          shouldPreventDefault: owns(),
          yawVelocity,
          pitchVelocity,
          settled: isSettled(),
        });
      }
      return snapshot;
    },
  };
}
