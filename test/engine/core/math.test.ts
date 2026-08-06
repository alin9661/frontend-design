// test/engine/core/math.test.ts
//
// lib/engine/core/math.ts — pure numeric primitives. `damp` in particular
// gets exact-value assertions since it's the smoothing primitive every
// other core module (scroll.ts, pointer.ts) builds on.

import { describe, expect, it } from "vitest";
import {
  clamp,
  damp,
  easeInOutCubic,
  easeOutBack,
  easeOutExpo,
  lerp,
  mapRange,
  smoothstep,
} from "@/lib/engine/core/math";

describe("lerp", () => {
  it("returns a at t=0 and b at t=1", () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it("interpolates linearly at intermediate t, including t outside [0,1]", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 2)).toBe(20); // not clamped
    expect(lerp(0, 10, -1)).toBe(-10);
  });
});

describe("damp", () => {
  it("matches lerp(a, b, 1 - exp(-lambda*dt)) exactly", () => {
    const a = 0;
    const b = 100;
    const lambda = 8;
    const dt = 1 / 60;
    const expected = lerp(a, b, 1 - Math.exp(-lambda * dt));
    expect(damp(a, b, lambda, dt)).toBeCloseTo(expected, 10);
  });

  it("is frame-rate independent: two half-steps ~= one full step", () => {
    const lambda = 8;
    const dtFull = 1 / 30;
    const dtHalf = dtFull / 2;

    const oneStep = damp(0, 100, lambda, dtFull);
    const twoSteps = damp(damp(0, 100, lambda, dtHalf), 100, lambda, dtHalf);

    expect(twoSteps).toBeCloseTo(oneStep, 5);
  });

  it("converges toward b as dt grows and never overshoots", () => {
    const near = damp(0, 100, 8, 10); // huge dt
    expect(near).toBeCloseTo(100, 5);
  });

  it("dt=0 leaves a unchanged", () => {
    expect(damp(42, 100, 8, 0)).toBe(42);
  });
});

describe("clamp", () => {
  it("passes through values inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to min/max at the boundaries and beyond", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it("is order-independent when min > max", () => {
    expect(clamp(5, 10, 0)).toBe(5);
    expect(clamp(-5, 10, 0)).toBe(0);
    expect(clamp(15, 10, 0)).toBe(10);
  });
});

describe("mapRange", () => {
  it("remaps a value linearly between ranges", () => {
    expect(mapRange(5, 0, 10, 0, 100)).toBe(50);
    expect(mapRange(0, 0, 10, 0, 100)).toBe(0);
    expect(mapRange(10, 0, 10, 0, 100)).toBe(100);
  });

  it("supports a descending output range", () => {
    expect(mapRange(5, 0, 10, 100, 0)).toBe(50);
    expect(mapRange(0, 0, 10, 100, 0)).toBe(100);
  });

  it("without clampOut, extrapolates past the output range", () => {
    expect(mapRange(20, 0, 10, 0, 100)).toBe(200);
    expect(mapRange(-10, 0, 10, 0, 100)).toBe(-100);
  });

  it("with clampOut=true, clamps into the output range (both orientations)", () => {
    expect(mapRange(20, 0, 10, 0, 100, true)).toBe(100);
    expect(mapRange(-10, 0, 10, 0, 100, true)).toBe(0);
    expect(mapRange(20, 0, 10, 100, 0, true)).toBe(0);
  });

  it("does not divide by zero when inMin === inMax", () => {
    expect(mapRange(5, 3, 3, 0, 100)).toBe(0);
  });
});

describe("easeOutExpo", () => {
  it("is exactly 0 at t=0 and exactly 1 at t=1 (no asymptotic tail)", () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
  });

  it("front-loads motion (by the midpoint it is already most of the way to 1)", () => {
    expect(easeOutExpo(0.5)).toBeGreaterThan(0.9);
  });
});

describe("easeInOutCubic", () => {
  it("is 0 at t=0, 1 at t=1, 0.5 at the midpoint", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
  });

  it("is symmetric around the midpoint", () => {
    const a = easeInOutCubic(0.25);
    const b = easeInOutCubic(0.75);
    expect(a + b).toBeCloseTo(1, 10);
  });
});

describe("smoothstep", () => {
  it("is 0 at t=0, 1 at t=1, and 0.5 exactly at the midpoint", () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 10);
  });

  it("eases velocity at both ends (grows slower than linear near 0 and 1)", () => {
    expect(smoothstep(0.1)).toBeLessThan(0.1);
    expect(smoothstep(0.9)).toBeGreaterThan(0.9);
  });

  it("clamps below 0 to 0 and above 1 to 1 instead of extrapolating", () => {
    expect(smoothstep(-0.5)).toBe(0);
    expect(smoothstep(-5)).toBe(0);
    expect(smoothstep(1.5)).toBe(1);
    expect(smoothstep(5)).toBe(1);
  });
});

describe("easeOutBack", () => {
  it("is ~0 at t=0 and exactly 1 at t=1", () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 10);
    expect(easeOutBack(1)).toBe(1);
  });

  it("overshoots past 1 before settling", () => {
    const values = Array.from({ length: 20 }, (_, i) => easeOutBack(i / 19));
    expect(Math.max(...values)).toBeGreaterThan(1);
  });
});
