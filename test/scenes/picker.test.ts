// test/scenes/picker.test.ts
//
// Picker scene (docs/deep-wave-engine-design.md §5 row 6). Most of what's
// exercised below lives in lib/scenes/picker/carousel.ts and
// lib/scenes/picker/dispose-bag.ts — the two dependency-free modules that
// hold all of the picker's actual logic (carousel angle math, damped
// convergence, invoke dispatch, disposal bookkeeping). scene.ts itself (the
// SceneModule wiring THREE + those two + the hero-can/gl-text contracts) is
// deliberately a thin layer over them for exactly this reason: at the start
// of this workstream neither `@/lib/scenes/hero-can/*` nor
// `@/lib/engine/gl/text` existed yet (separate, in-parallel M2 workstreams —
// confirmed empirically that Vitest/Vite cannot mock a module whose file
// genuinely doesn't exist on disk: `vi.mock` doesn't help, since
// vite:import-analysis fails to resolve the *importing* file at transform
// time regardless, and this Vitest version has no Jest-style `virtual: true`
// escape hatch). Both landed mid-session, so the last suite below exercises
// the real, fully-wired scene.ts end to end; the carousel/dispose-bag suites
// above it remain the primary coverage regardless, since that's where the
// logic actually lives.

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  BG_LAMBDA,
  CAROUSEL_DAMPING,
  CAROUSEL_STIFFNESS,
  CENTER_SCALE,
  PickerCarousel,
  SIDE_SCALE,
  TWO_PI,
  hexToRgb,
  placementAngle,
  scaleForAngularOffset,
  targetRotationForIndex,
  wrapAngle,
  wrapIndex,
} from "@/lib/scenes/picker/carousel";
import { smoothstep } from "@/lib/engine/core/math";
import { DisposeBag } from "@/lib/scenes/picker/dispose-bag";
import createPickerScene from "@/lib/scenes/picker/scene";
import { flavors } from "@/lib/flavors";
import type { AssetManager, ViewContext } from "@/lib/engine/types";

const FLAVOR_BGS = ["#F2C94C", "#F2994A", "#24765F", "#B5301F", "#A8C24A"];

describe("carousel angle math", () => {
  it("placementAngle evenly spaces flavors around a full circle", () => {
    const count = 5;
    for (let i = 0; i < count; i++) {
      expect(placementAngle(i, count)).toBeCloseTo((i / count) * TWO_PI, 10);
    }
    // one full lap back to 0/2π by the time we wrap past the last flavor
    expect(placementAngle(count, count)).toBeCloseTo(TWO_PI, 10);
  });

  it("targetRotationForIndex is the negation of that flavor's placement angle", () => {
    expect(targetRotationForIndex(0, 5)).toBeCloseTo(0, 10);
    expect(targetRotationForIndex(1, 5)).toBeCloseTo(-placementAngle(1, 5), 10);
    expect(targetRotationForIndex(4, 5)).toBeCloseTo(-placementAngle(4, 5), 10);
  });

  it("wrapAngle normalizes into (-π, π]", () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 10);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 10);
    expect(wrapAngle(TWO_PI)).toBeCloseTo(0, 10);
    expect(wrapAngle(-TWO_PI)).toBeCloseTo(0, 10);
    expect(wrapAngle(TWO_PI + 0.5)).toBeCloseTo(0.5, 10);
    expect(wrapAngle(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1, 5);
  });

  it("wrapIndex wraps negative and overflowing indices into [0, count)", () => {
    expect(wrapIndex(0, 5)).toBe(0);
    expect(wrapIndex(4, 5)).toBe(4);
    expect(wrapIndex(5, 5)).toBe(0);
    expect(wrapIndex(-1, 5)).toBe(4);
    expect(wrapIndex(-6, 5)).toBe(4);
    expect(wrapIndex(12, 5)).toBe(2);
  });

  it("scaleForAngularOffset is centerScale dead-ahead and sideScale a full spacing away", () => {
    const count = 5;
    expect(scaleForAngularOffset(0, count)).toBeCloseTo(CENTER_SCALE, 10);
    const spacing = TWO_PI / count;
    expect(scaleForAngularOffset(spacing, count)).toBeCloseTo(SIDE_SCALE, 10);
    expect(scaleForAngularOffset(-spacing, count)).toBeCloseTo(SIDE_SCALE, 10);
    // halfway between: smoothstep(0.5) is exactly 0.5, same as a linear
    // falloff would give at the exact midpoint (see the N8 regression test
    // below for a point where the smoothstep and linear curves diverge).
    expect(scaleForAngularOffset(spacing / 2, count)).toBeCloseTo(
      (CENTER_SCALE + SIDE_SCALE) / 2,
      10
    );
  });

  it("N8 regression: scaleForAngularOffset eases (smoothstep) across the boundary instead of a raw linear falloff", () => {
    const count = 5;
    const spacing = TWO_PI / count;
    // A quarter of the way to one flavor-spacing: smoothstep(0.25) = 0.15625,
    // well short of a linear 0.25 fraction — the old linear implementation
    // would land exactly at the linear expectation instead.
    const normalized = 0.25;
    const linearExpectation = CENTER_SCALE + (SIDE_SCALE - CENTER_SCALE) * normalized;
    const eased = scaleForAngularOffset(spacing * normalized, count);
    expect(smoothstep(normalized)).toBeLessThan(normalized);
    expect(Math.abs(eased - CENTER_SCALE)).toBeLessThan(Math.abs(linearExpectation - CENTER_SCALE));
  });

  it("scaleForAngularOffset clamps beyond one spacing (never scales below sideScale)", () => {
    const count = 5;
    const spacing = TWO_PI / count;
    expect(scaleForAngularOffset(spacing * 2, count)).toBeCloseTo(SIDE_SCALE, 10);
  });

  it("hexToRgb normalizes a `#rrggbb` string to 0..1 channels", () => {
    expect(hexToRgb("#ffffff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    const half = hexToRgb("#800000");
    expect(half.r).toBeCloseTo(128 / 255, 5);
    expect(half.g).toBe(0);
    expect(half.b).toBe(0);
  });
});

describe("PickerCarousel — select(i)", () => {
  it("starts centered on flavor 0 by default (angle 0, bg = flavor 0's)", () => {
    const carousel = new PickerCarousel(FLAVOR_BGS);
    expect(carousel.selectedIndex).toBe(0);
    expect(carousel.angle).toBeCloseTo(0, 10);
    expect(carousel.bg).toEqual(hexToRgb(FLAVOR_BGS[0]!));
  });

  it("honors a non-zero initialIndex", () => {
    const carousel = new PickerCarousel(FLAVOR_BGS, { initialIndex: 2 });
    expect(carousel.selectedIndex).toBe(2);
    expect(carousel.angle).toBeCloseTo(targetRotationForIndex(2, 5), 10);
  });

  it("select(i) updates selectedIndex and sets new rotation/color targets immediately", () => {
    const carousel = new PickerCarousel(FLAVOR_BGS);
    carousel.select(3);
    expect(carousel.selectedIndex).toBe(3);
    // current angle/bg haven't jumped yet — step() damps toward the new target.
    expect(carousel.angle).toBeCloseTo(0, 10);
    expect(carousel.converged()).toBe(false);
  });

  it("select(i) wraps out-of-range indices the same way wrapIndex does", () => {
    const carousel = new PickerCarousel(FLAVOR_BGS);
    carousel.select(-1);
    expect(carousel.selectedIndex).toBe(4);
    carousel.select(7);
    expect(carousel.selectedIndex).toBe(2);
  });
});

describe("PickerCarousel — invoke plumbing", () => {
  it('invoke("select", [i]) selects flavor i, matching a direct select(i) call', () => {
    const a = new PickerCarousel(FLAVOR_BGS);
    const b = new PickerCarousel(FLAVOR_BGS);
    a.select(3);
    b.invoke("select", [3]);
    expect(b.selectedIndex).toBe(a.selectedIndex);
    expect(b.angle).toBeCloseTo(a.angle, 10);
  });

  it("ignores unknown methods", () => {
    const carousel = new PickerCarousel(FLAVOR_BGS);
    carousel.invoke("spin", [3]);
    expect(carousel.selectedIndex).toBe(0);
  });

  it("ignores non-numeric or missing args instead of throwing", () => {
    const carousel = new PickerCarousel(FLAVOR_BGS);
    expect(() => carousel.invoke("select", ["not-a-number"])).not.toThrow();
    expect(carousel.selectedIndex).toBe(0);
    expect(() => carousel.invoke("select", [])).not.toThrow();
    expect(carousel.selectedIndex).toBe(0);
    expect(() => carousel.invoke("select", [NaN])).not.toThrow();
    expect(carousel.selectedIndex).toBe(0);
  });
});

describe("PickerCarousel — damped centering converges", () => {
  it("step(dt) moves current angle/bg toward the target without ever overshooting instantly", () => {
    const carousel = new PickerCarousel(FLAVOR_BGS);
    carousel.select(1);
    const targetAngle = targetRotationForIndex(1, 5);

    carousel.step(1 / 60);
    // Damped one tick: strictly between the old (0) and new target, same sign of travel.
    expect(Math.abs(carousel.angle)).toBeGreaterThan(0);
    expect(Math.abs(carousel.angle)).toBeLessThan(Math.abs(targetAngle));
  });

  it("repeated ticks converge the angle and background color to the target", () => {
    const carousel = new PickerCarousel(FLAVOR_BGS);
    carousel.select(3);
    expect(carousel.converged()).toBe(false);

    for (let i = 0; i < 300; i++) {
      carousel.step(1 / 60);
    }

    expect(carousel.converged()).toBe(true);
    // `angle` is kept wrapped into (-π, π] (see carousel.ts's step()), so
    // compare against the wrapped equivalent of the raw target rotation.
    expect(carousel.angle).toBeCloseTo(wrapAngle(targetRotationForIndex(3, 5)), 3);
    const expectedBg = hexToRgb(FLAVOR_BGS[3]!);
    expect(carousel.bg.r).toBeCloseTo(expectedBg.r, 3);
    expect(carousel.bg.g).toBeCloseTo(expectedBg.g, 3);
    expect(carousel.bg.b).toBeCloseTo(expectedBg.b, 3);
  });

  it("is frame-rate independent: one big step ~= many small steps summing to the same dt", () => {
    const big = new PickerCarousel(FLAVOR_BGS);
    const small = new PickerCarousel(FLAVOR_BGS);
    big.select(2);
    small.select(2);

    big.step(0.5);
    for (let i = 0; i < 50; i++) small.step(0.01);

    // C1: SPRING_SUBSTEP_MAX was raised 1/1000 -> 1/240 (still far inside
    // the integrator's stable range at CAROUSEL_STIFFNESS/DAMPING — see
    // carousel.ts's comment on the constant), trading some of this
    // "frame-rate independence" precision for ~4x fewer sub-steps per
    // frame. A quarter-radian-scale rotation now landing within ~0.01 rad
    // (well under half a degree, imperceptible) of the fine-grained
    // reference is the intended precision/perf tradeoff, not a regression.
    expect(Math.abs(big.angle - small.angle)).toBeLessThan(0.01);
  });

  it("takes the short way around the carousel (never unwraps the long way for a wrap-around selection)", () => {
    // index 4 of 5 -> index 0: placement angles are 4/5*2π and 0. The short
    // step from angle(4) to angle(0) is +1/5*2π, not almost a full -4/5*2π.
    const carousel = new PickerCarousel(FLAVOR_BGS, { initialIndex: 4 });
    const startAngle = carousel.angle;
    carousel.select(0);
    carousel.step(1 / 60);
    const delta = carousel.angle - startAngle;
    expect(Math.abs(wrapAngle(delta))).toBeLessThan(TWO_PI / 5 + 1e-6);
  });

  it("uses the documented default spring/damp constants", () => {
    expect(CAROUSEL_STIFFNESS).toBe(110);
    expect(CAROUSEL_DAMPING).toBe(17);
    expect(BG_LAMBDA).toBe(6);
  });

  it("a custom stiffness changes the convergence rate (N8: springStep, not damp)", () => {
    const slow = new PickerCarousel(FLAVOR_BGS, { stiffness: 20, damping: 17 });
    const fast = new PickerCarousel(FLAVOR_BGS, { stiffness: 300, damping: 17 });
    slow.select(2);
    fast.select(2);

    slow.step(1 / 60);
    fast.step(1 / 60);

    expect(Math.abs(fast.angle)).toBeGreaterThan(Math.abs(slow.angle));
  });

  it("N8 regression: rotation accelerates from rest instead of starting at maximum velocity (springStep, not damp)", () => {
    // damp() has its steepest slope at t=0 (an exponential decaying toward
    // the target moves FASTEST the instant it starts); a spring starting at
    // rest (vel=0) instead ramps UP to speed. Two consecutive equal-size
    // ticks from a standing start should therefore cover MORE ground on the
    // second tick than the first — the opposite of what damp() would do.
    const carousel = new PickerCarousel(FLAVOR_BGS);
    carousel.select(2);

    carousel.step(1 / 60);
    const afterFirstTick = Math.abs(carousel.angle);

    carousel.step(1 / 60);
    const afterSecondTick = Math.abs(carousel.angle);
    const secondTickDelta = afterSecondTick - afterFirstTick;

    expect(secondTickDelta).toBeGreaterThan(afterFirstTick);
  });

  it("N8: sub-steps a large dt, so one janky frame integrates the same as many small ones", () => {
    // springStep is a semi-implicit Euler integrator, unlike damp()'s
    // exact-for-any-dt exponential — a single 250ms step at stiffness 110
    // would blow up without internal sub-stepping. Both carousels below
    // cover the same 250ms, so they must land close to the same place.
    const oneBigFrame = new PickerCarousel(FLAVOR_BGS);
    const manySmallFrames = new PickerCarousel(FLAVOR_BGS);
    oneBigFrame.select(2);
    manySmallFrames.select(2);

    oneBigFrame.step(0.25);
    for (let i = 0; i < 25; i++) manySmallFrames.step(0.01);

    expect(Number.isFinite(oneBigFrame.angle)).toBe(true);
    // C1: SPRING_SUBSTEP_MAX was raised 1/1000 -> 1/240 (see carousel.ts's
    // comment on the constant for why that's still well inside the
    // integrator's stable range) — coarser sub-stepping means this landing
    // spot is close, not bit-for-bit identical, to the fine-grained
    // reference. `toBeCloseTo(...,4)` (0.00005 rad) was calibrated for the
    // old 1ms sub-step; loosened to a still-tiny 0.005 rad (under a third
    // of a degree) for the new, intentionally coarser one.
    expect(Math.abs(oneBigFrame.angle - manySmallFrames.angle)).toBeLessThan(0.005);

    // And it still converges from there rather than oscillating forever.
    for (let i = 0; i < 20; i++) oneBigFrame.step(0.25);
    expect(oneBigFrame.converged()).toBe(true);
  });

  it("a custom damping changes the settle character (very underdamped overshoots; overdamped never does)", () => {
    const target = wrapAngle(targetRotationForIndex(2, FLAVOR_BGS.length));
    const overshoots = (damping: number): boolean => {
      const carousel = new PickerCarousel(FLAVOR_BGS, { stiffness: 110, damping });
      carousel.select(2);
      const initialSign = Math.sign(wrapAngle(target - carousel.angle));
      for (let i = 0; i < 180; i++) {
        carousel.step(1 / 60);
        const error = wrapAngle(target - carousel.angle);
        // Crossing the target flips the sign of the remaining error.
        if (Math.sign(error) === -initialSign && Math.abs(error) > 1e-3) return true;
      }
      return false;
    };

    expect(overshoots(2)).toBe(true); // ζ ≈ 0.1 — visibly bouncy
    expect(overshoots(40)).toBe(false); // ζ ≈ 1.9 — overdamped, crawls in
  });

  it("N8 regression: settles at rest without residual oscillation for a tiny delta", () => {
    // Regression guard for the settle-threshold snap: a near-converged
    // carousel re-selecting its OWN already-centered flavor must not jitter
    // or overshoot — it should already read as converged.
    const carousel = new PickerCarousel(FLAVOR_BGS, { initialIndex: 1 });
    for (let i = 0; i < 300; i++) carousel.step(1 / 60);
    expect(carousel.converged()).toBe(true);

    carousel.select(1); // reselect the already-centered flavor — target unchanged
    for (let i = 0; i < 10; i++) carousel.step(1 / 60);
    expect(carousel.converged()).toBe(true);
    expect(carousel.angle).toBeCloseTo(wrapAngle(targetRotationForIndex(1, 5)), 6);
  });

  it("C1: step(0) is a no-op", () => {
    const carousel = new PickerCarousel(FLAVOR_BGS);
    carousel.select(2);
    carousel.step(1 / 60); // get it moving, mid-flight (not settled)
    const angleBefore = carousel.angle;
    const bgBefore = { ...carousel.bg };

    carousel.step(0);

    expect(carousel.angle).toBe(angleBefore);
    expect(carousel.bg).toEqual(bgBefore);
  });

  it("C1 regression: once settled, further step() calls leave the angle exactly unchanged (early-out at rest)", () => {
    // Before C1's early-out, a settled carousel still ran the sub-step loop
    // (and its per-substep allocation) every frame forever — functionally
    // harmless (a converged spring stays converged) but wasteful. This
    // pins the early-out's OWN correctness: once at rest, `pos`/`vel` must
    // come back bit-for-bit identical, not just "close", since the guard
    // returns `{ pos: target, vel: 0 }` directly instead of re-integrating.
    const carousel = new PickerCarousel(FLAVOR_BGS);
    carousel.select(2);
    for (let i = 0; i < 300; i++) carousel.step(1 / 60);
    expect(carousel.converged()).toBe(true);
    const settledAngle = carousel.angle;

    for (let i = 0; i < 50; i++) carousel.step(1 / 60);
    expect(carousel.angle).toBe(settledAngle);
  });

  it("C1 regression: a single large-dt stall (0.5s) stays finite and lands close to the same elapsed time taken in tiny steps", () => {
    // Before C1's MAX_SUBSTEPS cap, the sub-step loop was bounded only by
    // the CALLER's MAX_DT_S clamp (worker/frame-shared.ts) — nothing in
    // this function itself stopped an unusually large dt (a genuine stall,
    // or a test/host that doesn't clamp) from sub-stepping without bound.
    // This drives a 0.5s stall directly into step() as a single call.
    const stalled = new PickerCarousel(FLAVOR_BGS);
    const reference = new PickerCarousel(FLAVOR_BGS);
    stalled.select(2);
    reference.select(2);

    stalled.step(0.5);
    for (let i = 0; i < 500; i++) reference.step(0.001);

    expect(Number.isFinite(stalled.angle)).toBe(true);
    expect(Math.abs(stalled.angle - reference.angle)).toBeLessThan(0.015);
  });

  it("H2 regression: converged() is false while the (underdamped) rotation spring is crossing the target at speed, true once actually at rest", () => {
    // CAROUSEL_STIFFNESS 110 / CAROUSEL_DAMPING 17 gives ζ ≈ 0.81 —
    // underdamped, so the rotation spring overshoots and crosses the
    // target before settling. Pre-fix, `converged()` checked position
    // only, so it read `true` at that crossing (velocity still large).
    // bgLambda is cranked way up so color convergence (a real, separate
    // AND-ed condition of `converged()`) is already done well before the
    // crossing — isolating the assertion to the angle/velocity term H2
    // actually changed. Without that isolation, `bgClose` alone would
    // already be false this early regardless of the fix, and the test
    // wouldn't distinguish pre- from post-fix behavior.
    const carousel = new PickerCarousel(FLAVOR_BGS, { bgLambda: 500 });
    const target = wrapAngle(targetRotationForIndex(2, FLAVOR_BGS.length));
    carousel.select(2);

    // Fine-grained scan (2ms steps) for the FIRST frame where position lands
    // within the default epsilon of the target — for an initially-monotonic
    // underdamped approach, that first crossing is a fast-moving instant,
    // not the eventual settle (which comes later, after the overshoot).
    const dt = 1 / 500;
    let foundCrossing = false;
    for (let i = 0; i < 5000 && !foundCrossing; i++) {
      carousel.step(dt);
      const error = Math.abs(wrapAngle(target - carousel.angle));
      if (error < 1e-3) {
        foundCrossing = true;
      }
    }
    expect(foundCrossing).toBe(true); // sanity: this stiffness/damping does cross close enough to matter
    // At the crossing, position is within epsilon of the target but
    // velocity is still large — not actually at rest. This assertion would
    // FAIL against the pre-fix, position-only `converged()` (which would
    // read `true` here, since position alone is already within epsilon).
    expect(carousel.converged()).toBe(false);

    for (let i = 0; i < 300; i++) carousel.step(1 / 60);
    expect(carousel.converged()).toBe(true);
  });
});

describe("PickerCarousel — scaleFor (centered can scales up)", () => {
  it("the selected (front-centered) can scales toward CENTER_SCALE, others toward SIDE_SCALE", () => {
    const carousel = new PickerCarousel(FLAVOR_BGS, { initialIndex: 0 });
    // already converged at construction (current angle starts at the target)
    expect(carousel.scaleFor(0)).toBeCloseTo(CENTER_SCALE, 10);
    expect(carousel.scaleFor(1)).toBeLessThan(CENTER_SCALE);
    expect(carousel.scaleFor(2)).toBeLessThan(CENTER_SCALE);
  });

  it("scaleFor tracks the currently-front can as the carousel rotates toward a new selection", () => {
    const carousel = new PickerCarousel(FLAVOR_BGS);
    carousel.select(2);
    for (let i = 0; i < 300; i++) carousel.step(1 / 60);

    expect(carousel.scaleFor(2)).toBeCloseTo(CENTER_SCALE, 2);
    expect(carousel.scaleFor(0)).toBeCloseTo(SIDE_SCALE, 1);
  });
});

describe("DisposeBag", () => {
  it("calls every registered disposer exactly once", () => {
    const bag = new DisposeBag();
    const calls: number[] = [];
    bag.add(() => calls.push(1));
    bag.add(() => calls.push(2));
    bag.add(() => calls.push(3));
    expect(bag.size).toBe(3);

    bag.disposeAll();

    expect(calls).toEqual([1, 2, 3]);
    expect(bag.size).toBe(0);
  });

  it("is idempotent — calling disposeAll() again does nothing", () => {
    const dispose = vi.fn();
    const bag = new DisposeBag();
    bag.add(dispose);

    bag.disposeAll();
    bag.disposeAll();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("disposeAll() on an empty bag is a safe no-op", () => {
    const bag = new DisposeBag();
    expect(() => bag.disposeAll()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// scene.ts — end-to-end wiring against the real, now-landed hero-can and
// gl/text contract modules (see this file's header).
// ---------------------------------------------------------------------------

function makeFakeAssets(): AssetManager {
  const jobs: Array<() => Promise<unknown>> = [];
  return {
    add: (_id, _weight, job) => {
      jobs.push(job);
    },
    get: () => {
      throw new Error("makeFakeAssets: nothing loaded (test never calls start())");
    },
    start: async () => {
      await Promise.all(jobs.map((job) => job()));
    },
    onProgress: () => () => {},
  };
}

function makeViewContext(overrides: Partial<ViewContext> = {}): ViewContext {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
  camera.position.z = 500;
  camera.updateProjectionMatrix();
  return {
    scene,
    camera,
    rect: { top: 0, left: 0, width: 500, height: 500 },
    scroll: { target: 0, current: 0, velocity: 0, progress: 0, limit: 1000 },
    pointer: { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false },
    assets: makeFakeAssets(),
    size: { width: 500, height: 500, dpr: 1 },
    quality: "high",
    reducedMotion: false,
    ...overrides,
  };
}

describe("picker scene.ts — SceneModule contract, end to end", () => {
  it("init() populates the scene graph with a background quad, lights, and one group per flavor", async () => {
    const scene = createPickerScene();
    const ctx = makeViewContext();

    await scene.init(ctx);

    // scene.ts hangs everything off a single root group added to ctx.scene.
    expect(ctx.scene.children.length).toBe(1);
    const root = ctx.scene.children[0] as THREE.Group;
    // bg quad + 2 lights + the ring group, at minimum (see scene.ts's
    // `ringGroup` doc comment for why the cans live one level deeper, in
    // their own non-root-rotating group, instead of directly under root).
    expect(root.children.length).toBeGreaterThanOrEqual(4);
    expect(root.children.filter((c) => c instanceof THREE.Light)).toHaveLength(2);

    const ringGroup = root.children.find(
      (c) => c instanceof THREE.Group && c.children.length >= flavors.length
    ) as THREE.Group | undefined;
    expect(ringGroup).toBeDefined();
    expect(ringGroup!.children.length).toBeGreaterThanOrEqual(flavors.length);

    scene.dispose();
  });

  it("lights the cans brightly enough for the label colors to reach their authored values (F-005 regression)", async () => {
    // Regression (design-review F-005): at ambient 0.65 / key 1.4 the
    // standard-material cans read olive/brown against the bright flavor
    // background — the authored label colors never arrived.
    const scene = createPickerScene();
    const ctx = makeViewContext();
    await scene.init(ctx);

    const root = ctx.scene.children[0] as THREE.Group;
    const ambient = root.children.find((c) => c instanceof THREE.AmbientLight) as THREE.AmbientLight;
    const key = root.children.find((c) => c instanceof THREE.DirectionalLight) as THREE.DirectionalLight;

    expect(ambient.intensity).toBeCloseTo(0.95);
    expect(key.intensity).toBeCloseTo(1.8);
    expect(key.position.toArray()).toEqual([1.2, 1.6, 1.4]);

    scene.dispose();
  });

  it("update() does not throw across several ticks, with and without reduced motion", async () => {
    const scene = createPickerScene();
    const ctx = makeViewContext();
    await scene.init(ctx);

    for (let i = 0; i < 5; i++) scene.update(1 / 60, ctx);
    ctx.reducedMotion = true;
    for (let i = 0; i < 5; i++) scene.update(1 / 60, ctx);

    scene.dispose();
  });

  it('invoke("select", [i]) is wired through to the carousel (rotates the ring toward flavor i)', async () => {
    const scene = createPickerScene();
    const ctx = makeViewContext();
    await scene.init(ctx);

    // The carousel's rotation lives on the ring group (a child of root that
    // isn't root itself — see scene.ts's `ringGroup` doc comment for why:
    // root has to stay non-rotating so the bg quad/lights/text don't sweep
    // around with the carousel), identified here as whichever group child
    // holds all `flavors.length` can groups.
    const root = ctx.scene.children.find((c) => c instanceof THREE.Group) as THREE.Group | undefined;
    expect(root).toBeDefined();
    const ringGroup = root!.children.find(
      (c) => c instanceof THREE.Group && c.children.length >= flavors.length
    ) as THREE.Group | undefined;
    expect(ringGroup).toBeDefined();
    const before = ringGroup!.rotation.y;

    scene.invoke!("select", [2]);
    for (let i = 0; i < 60; i++) scene.update(1 / 60, ctx);

    expect(ringGroup!.rotation.y).not.toBeCloseTo(before, 3);

    scene.dispose();
  });

  it("init() does NOT register any raycast targets (design review item D: dropped until hover-selection lands — selection flows through DOM buttons + invoke)", async () => {
    const scene = createPickerScene();
    const registered: THREE.Object3D[] = [];
    const ctx = makeViewContext({ registerInteractive: (objects) => registered.push(...objects) });

    await scene.init(ctx);

    expect(registered).toHaveLength(0);

    scene.dispose();
  });

  it("dispose() removes the root from the scene and is safe to call twice", async () => {
    const scene = createPickerScene();
    const ctx = makeViewContext();
    await scene.init(ctx);
    const childCountBefore = ctx.scene.children.length;
    expect(childCountBefore).toBeGreaterThan(0);

    scene.dispose();
    expect(ctx.scene.children.length).toBe(0);
    expect(() => scene.dispose()).not.toThrow();
  });

  it("init() is re-runnable (context-loss restore) without leaking the previous instance's scene graph", async () => {
    const scene = createPickerScene();
    const ctx = makeViewContext();

    await scene.init(ctx);
    const countAfterFirstInit = ctx.scene.children.length;
    await scene.init(ctx);
    const countAfterSecondInit = ctx.scene.children.length;

    expect(countAfterSecondInit).toBe(countAfterFirstInit);

    scene.dispose();
  });
});
