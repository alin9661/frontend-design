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
  CAROUSEL_LAMBDA,
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
    // halfway between: linear falloff -> halfway between the two scales
    expect(scaleForAngularOffset(spacing / 2, count)).toBeCloseTo(
      (CENTER_SCALE + SIDE_SCALE) / 2,
      10
    );
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

    expect(big.angle).toBeCloseTo(small.angle, 3);
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

  it("uses the documented default lambdas", () => {
    expect(CAROUSEL_LAMBDA).toBe(8);
    expect(BG_LAMBDA).toBe(6);
  });

  it("a custom lambda changes the convergence rate", () => {
    const slow = new PickerCarousel(FLAVOR_BGS, { lambda: 1 });
    const fast = new PickerCarousel(FLAVOR_BGS, { lambda: 20 });
    slow.select(2);
    fast.select(2);

    slow.step(1 / 60);
    fast.step(1 / 60);

    expect(Math.abs(fast.angle)).toBeGreaterThan(Math.abs(slow.angle));
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

  it("init() registers one interactive object per flavor (design doc §4A raycast registration)", async () => {
    const scene = createPickerScene();
    const registered: THREE.Object3D[] = [];
    const ctx = makeViewContext({ registerInteractive: (objects) => registered.push(...objects) });

    await scene.init(ctx);

    expect(registered).toHaveLength(flavors.length);
    for (const obj of registered) expect(obj).toBeInstanceOf(THREE.Group);

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
