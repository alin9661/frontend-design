// test/scenes/origin-film-pollen.test.ts
//
// lib/scenes/origin-film/pollen.ts — the GPGPU pollen field. Everything here
// runs in jsdom: the module never touches a live WebGLRenderer, so the
// capability verdict is injected and the render-to-texture seam is a mock,
// same pattern as test/engine/gl/gpgpu.test.ts.
//
// Covered: the float -> half-float -> CPU capability chain (including that
// "none" must NOT construct a Gpgpu, which throws by design), per-tier
// budgets, the progress opacity bell, reduced motion freezing the pose on
// both paths, pointer and scroll-velocity forces measurably moving the CPU
// pose, the renderer-present vs renderer-null branches, and dispose()
// actually reaching every allocated resource.

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { GpgpuRenderer } from "@/lib/engine/gl/gpgpu";
import {
  PollenField,
  POLLEN_BOUNDS,
  POLLEN_CPU_COUNT,
  POLLEN_FADE,
  POLLEN_MAX_OPACITY,
  POLLEN_MIN_COUNT,
  POLLEN_SIM_SIZE,
  SCROLL_VELOCITY_REFERENCE,
  buildPollenSeeds,
  pollenOpacityForProgress,
  resolvePollenBudget,
} from "@/lib/scenes/origin-film/pollen";

function makeRenderer() {
  const renderer = {
    setRenderTarget: vi.fn<(target: THREE.WebGLRenderTarget | null) => void>(),
    render: vi.fn<(scene: THREE.Scene, camera: THREE.Camera) => void>(),
  };
  return renderer satisfies GpgpuRenderer;
}

/** Snapshot of the instance matrices — the CPU path's observable pose. */
function cpuPose(field: PollenField): Float32Array {
  const motes = field.motes;
  if (!motes) throw new Error("expected a CPU-path field");
  return Float32Array.from(motes.instanceMatrix.array);
}

function maxAbsDelta(a: Float32Array, b: Float32Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) {
    worst = Math.max(worst, Math.abs(a[i]! - b[i]!));
  }
  return worst;
}

function run(
  field: PollenField,
  frames: number,
  ctx: Parameters<PollenField["update"]>[1],
): void {
  for (let i = 0; i < frames; i += 1) {
    field.update(1 / 60, ctx);
  }
}

describe("resolvePollenBudget", () => {
  it("takes the GPU path on high with float support, sized by tier", () => {
    const budget = resolvePollenBudget({ support: "float", quality: "high" });
    expect(budget.path).toBe("gpu");
    expect(budget.simSize).toBe(POLLEN_SIM_SIZE.high);
    expect(budget.count).toBe(POLLEN_SIM_SIZE.high * POLLEN_SIM_SIZE.high);
  });

  it("still takes the GPU path on half-float, at the medium tier size", () => {
    const budget = resolvePollenBudget({ support: "half-float", quality: "medium" });
    expect(budget.path).toBe("gpu");
    expect(budget.simSize).toBe(POLLEN_SIM_SIZE.medium);
  });

  it("prefers the CPU path on low even when float support exists", () => {
    const budget = resolvePollenBudget({ support: "float", quality: "low" });
    expect(budget.path).toBe("cpu");
    expect(budget.simSize).toBe(0);
    expect(budget.count).toBe(POLLEN_CPU_COUNT.low);
  });

  it("falls back to the CPU path whenever float render targets are unavailable", () => {
    expect(resolvePollenBudget({ support: "none", quality: "high" })).toEqual({
      path: "cpu",
      count: POLLEN_CPU_COUNT.high,
      simSize: 0,
    });
  });

  it("rounds a requested count up to a square sim texture on the GPU path", () => {
    const budget = resolvePollenBudget({ support: "float", quality: "high", count: 90 });
    expect(budget.simSize).toBe(10);
    expect(budget.count).toBe(100);
  });

  it("clamps a requested count to the tier ceiling and the module floor", () => {
    const huge = resolvePollenBudget({ support: "float", quality: "medium", count: 1_000_000 });
    expect(huge.simSize).toBe(POLLEN_SIM_SIZE.medium);

    const tinyGpu = resolvePollenBudget({ support: "float", quality: "medium", count: 1 });
    expect(tinyGpu.count).toBeGreaterThanOrEqual(POLLEN_MIN_COUNT);

    const hugeCpu = resolvePollenBudget({ support: "none", quality: "low", count: 5000 });
    expect(hugeCpu.count).toBe(POLLEN_CPU_COUNT.low);

    const tinyCpu = resolvePollenBudget({ support: "none", quality: "low", count: 0 });
    expect(tinyCpu.count).toBe(POLLEN_MIN_COUNT);
  });
});

describe("pollenOpacityForProgress", () => {
  it("is absent at both chapter edges and peaks across the middle", () => {
    expect(pollenOpacityForProgress(0)).toBe(0);
    expect(pollenOpacityForProgress(1)).toBe(0);
    expect(pollenOpacityForProgress(0.5)).toBeCloseTo(POLLEN_MAX_OPACITY, 6);
    expect(pollenOpacityForProgress(POLLEN_FADE)).toBeCloseTo(POLLEN_MAX_OPACITY, 6);
  });

  it("rises monotonically through the fade-in and is symmetric about the middle", () => {
    const quarter = pollenOpacityForProgress(POLLEN_FADE / 2);
    expect(quarter).toBeGreaterThan(0);
    expect(quarter).toBeLessThan(POLLEN_MAX_OPACITY);
    expect(pollenOpacityForProgress(1 - POLLEN_FADE / 2)).toBeCloseTo(quarter, 6);
  });

  it("clamps out-of-range progress instead of going negative", () => {
    expect(pollenOpacityForProgress(-3)).toBe(0);
    expect(pollenOpacityForProgress(9)).toBe(0);
  });
});

describe("buildPollenSeeds", () => {
  it("places every mote inside the field bounds with a 0..1 phase", () => {
    const seeds = buildPollenSeeds(64);
    expect(seeds).toHaveLength(64 * 4);
    for (let i = 0; i < 64; i += 1) {
      expect(Math.abs(seeds[i * 4]!)).toBeLessThanOrEqual(POLLEN_BOUNDS.x);
      expect(Math.abs(seeds[i * 4 + 1]!)).toBeLessThanOrEqual(POLLEN_BOUNDS.y);
      expect(Math.abs(seeds[i * 4 + 2]!)).toBeLessThanOrEqual(POLLEN_BOUNDS.z);
      expect(seeds[i * 4 + 3]!).toBeGreaterThanOrEqual(0);
      expect(seeds[i * 4 + 3]!).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic, so two fields with the same budget agree exactly", () => {
    expect(Array.from(buildPollenSeeds(32))).toEqual(Array.from(buildPollenSeeds(32)));
  });

  it("does not place every mote at the same spot", () => {
    const seeds = buildPollenSeeds(32);
    const xs = new Set(Array.from({ length: 32 }, (_, i) => seeds[i * 4]));
    expect(xs.size).toBeGreaterThan(16);
  });
});

describe("PollenField capability chain", () => {
  it("allocates FloatType ping-pong targets when float support is reported", () => {
    const field = new PollenField({
      support: "float",
      quality: "high",
      reducedMotion: false,
      count: 64,
    });

    expect(field.path).toBe("gpu");
    expect(field.gpgpu).not.toBeNull();
    expect(field.gpgpu!.read.texture.type).toBe(THREE.FloatType);
    expect(field.gpgpu!.write.texture.type).toBe(THREE.FloatType);
    expect(field.points).toBeInstanceOf(THREE.Points);
    expect(field.motes).toBeNull();
    field.dispose();
  });

  it("allocates HalfFloatType targets when only half-float is reported", () => {
    const field = new PollenField({
      support: "half-float",
      quality: "high",
      reducedMotion: false,
      count: 64,
    });

    expect(field.gpgpu!.read.texture.type).toBe(THREE.HalfFloatType);
    expect(field.gpgpu!.write.texture.type).toBe(THREE.HalfFloatType);
    field.dispose();
  });

  it('takes the CPU path without throwing when support is "none"', () => {
    let field: PollenField | undefined;
    expect(() => {
      field = new PollenField({
        support: "none",
        quality: "high",
        reducedMotion: false,
        count: 40,
      });
    }).not.toThrow();

    expect(field!.path).toBe("cpu");
    expect(field!.gpgpu).toBeNull();
    expect(field!.points).toBeNull();
    expect(field!.motes).toBeInstanceOf(THREE.InstancedMesh);
    expect(field!.motes!.count).toBe(40);
    expect(field!.object3d.children).toContain(field!.motes);
    field!.dispose();
  });

  it("keeps the field alive on low-tier hardware that does have float support", () => {
    const field = new PollenField({ support: "float", quality: "low", reducedMotion: false });
    expect(field.path).toBe("cpu");
    expect(field.motes!.count).toBe(POLLEN_CPU_COUNT.low);
    field.dispose();
  });
});

describe("PollenField GPU simulation", () => {
  it("steps the ping-pong pass and hands the result to the render material", () => {
    const field = new PollenField({
      support: "float",
      quality: "high",
      reducedMotion: false,
      count: 64,
    });
    const renderer = makeRenderer();
    const sim = field.simulationMaterial!;
    const render = field.points!.material as THREE.ShaderMaterial;

    expect(sim.uniforms.uFirstFrame!.value).toBe(1);
    expect(render.uniforms.uUseSimTexture!.value).toBe(0);

    field.update(1 / 60, { renderer, progress: 0.5 });

    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.setRenderTarget).toHaveBeenCalledTimes(2); // write, then null
    expect(sim.uniforms.uFirstFrame!.value).toBe(0);
    expect(sim.uniforms.uDelta!.value).toBeCloseTo(1 / 60, 6);
    expect(sim.uniforms.uProgress!.value).toBe(0.5);
    expect(render.uniforms.uUseSimTexture!.value).toBe(1);
    expect(render.uniforms.uPositionTexture!.value).toBe(field.gpgpu!.read.texture);
    expect(field.time).toBeCloseTo(1 / 60, 6);
    field.dispose();
  });

  it("feeds pointer and scroll-velocity forces into the sim uniforms", () => {
    const field = new PollenField({
      support: "float",
      quality: "high",
      reducedMotion: false,
      count: 64,
    });
    const renderer = makeRenderer();

    run(field, 60, {
      renderer,
      progress: 0.5,
      pointer: { x: 0.8, y: -0.4 },
      scrollVelocity: SCROLL_VELOCITY_REFERENCE,
    });

    const pointer = field.simulationMaterial!.uniforms.uPointer!.value as THREE.Vector2;
    expect(pointer.x).toBeGreaterThan(0.4);
    expect(pointer.y).toBeLessThan(-0.2);
    expect(field.simulationMaterial!.uniforms.uScrollVelocity!.value).toBeGreaterThan(0.4);
    field.dispose();
  });

  it("saturates the scroll force rather than letting a fast fling run away", () => {
    const field = new PollenField({
      support: "float",
      quality: "high",
      reducedMotion: false,
      count: 64,
    });
    const renderer = makeRenderer();

    run(field, 240, { renderer, scrollVelocity: SCROLL_VELOCITY_REFERENCE * 50 });
    expect(field.simulationMaterial!.uniforms.uScrollVelocity!.value).toBeLessThanOrEqual(1);
    field.dispose();
  });

  it("holds its pose without throwing when no renderer is lent this frame", () => {
    const field = new PollenField({
      support: "float",
      quality: "high",
      reducedMotion: false,
      count: 64,
    });
    const render = field.points!.material as THREE.ShaderMaterial;

    expect(() => field.update(1 / 60, { renderer: null, progress: 0.5 })).not.toThrow();

    expect(render.uniforms.uUseSimTexture!.value).toBe(0);
    expect(field.simulationMaterial!.uniforms.uFirstFrame!.value).toBe(1);
    expect(field.time).toBe(0);
    field.dispose();
  });

  it("tracks progress opacity on the render material, including when omitted", () => {
    const field = new PollenField({
      support: "float",
      quality: "high",
      reducedMotion: false,
      count: 64,
    });
    const renderer = makeRenderer();
    const render = field.points!.material as THREE.ShaderMaterial;

    field.update(1 / 60, { renderer, progress: 0.5 });
    expect(render.uniforms.uOpacity!.value).toBeCloseTo(POLLEN_MAX_OPACITY, 6);

    field.update(1 / 60, { renderer });
    expect(render.uniforms.uOpacity!.value).toBe(0); // progress defaults to 0
    field.dispose();
  });
});

describe("PollenField reduced motion", () => {
  it("never allocates render targets and never touches the renderer on the GPU path", () => {
    const field = new PollenField({
      support: "float",
      quality: "high",
      reducedMotion: true,
      count: 64,
    });
    const renderer = makeRenderer();
    const render = field.points!.material as THREE.ShaderMaterial;

    expect(field.path).toBe("gpu");
    expect(field.gpgpu).toBeNull();
    expect(field.simulationMaterial).toBeNull();

    run(field, 10, { renderer, progress: 0.5, pointer: { x: 1, y: 1 }, scrollVelocity: 4000 });

    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderer.setRenderTarget).not.toHaveBeenCalled();
    expect(render.uniforms.uUseSimTexture!.value).toBe(0); // static seed pose
    expect(field.time).toBe(0);
    field.dispose();
  });

  it("holds an identical CPU pose across two update() calls", () => {
    const field = new PollenField({
      support: "none",
      quality: "high",
      reducedMotion: true,
      count: 40,
    });
    const ctx = {
      renderer: null,
      progress: 0.5,
      pointer: { x: 0.9, y: 0.6 },
      scrollVelocity: 3000,
    };

    field.update(1 / 60, ctx);
    const first = cpuPose(field);
    field.update(1 / 60, ctx);
    const second = cpuPose(field);

    expect(first.some((v) => v !== 0)).toBe(true); // the resting pose was written
    expect(Array.from(second)).toEqual(Array.from(first));
    field.dispose();
  });

  it("moves the CPU pose between updates when motion is allowed", () => {
    const field = new PollenField({
      support: "none",
      quality: "high",
      reducedMotion: false,
      count: 40,
    });
    const ctx = { renderer: null, progress: 0.5 };

    field.update(1 / 60, ctx);
    const first = cpuPose(field);
    field.update(1 / 60, ctx);
    const second = cpuPose(field);

    expect(maxAbsDelta(first, second)).toBeGreaterThan(1e-4);
    field.dispose();
  });
});

describe("PollenField CPU forces", () => {
  const options = {
    support: "none" as const,
    quality: "high" as const,
    reducedMotion: false,
    count: 40,
  };

  it("produces identical poses for identical inputs (the control)", () => {
    const a = new PollenField(options);
    const b = new PollenField(options);
    const ctx = { renderer: null, progress: 0.4 };

    run(a, 40, ctx);
    run(b, 40, ctx);

    expect(Array.from(cpuPose(a))).toEqual(Array.from(cpuPose(b)));
    a.dispose();
    b.dispose();
  });

  it("moves motes measurably when the pointer is off-centre", () => {
    const still = new PollenField(options);
    const disturbed = new PollenField(options);

    run(still, 40, { renderer: null, progress: 0.4 });
    run(disturbed, 40, { renderer: null, progress: 0.4, pointer: { x: 0.9, y: 0.5 } });

    expect(maxAbsDelta(cpuPose(still), cpuPose(disturbed))).toBeGreaterThan(1);
    still.dispose();
    disturbed.dispose();
  });

  it("moves motes measurably from scroll velocity alone (the touch-device path)", () => {
    const still = new PollenField(options);
    const scrolled = new PollenField(options);

    run(still, 40, { renderer: null, progress: 0.4 });
    run(scrolled, 40, {
      renderer: null,
      progress: 0.4,
      scrollVelocity: SCROLL_VELOCITY_REFERENCE,
    });

    expect(maxAbsDelta(cpuPose(still), cpuPose(scrolled))).toBeGreaterThan(1);
    still.dispose();
    scrolled.dispose();
  });

  it("fades the instanced material with chapter progress", () => {
    const field = new PollenField(options);
    const material = field.motes!.material as THREE.MeshBasicMaterial;

    field.update(1 / 60, { renderer: null, progress: 0.5 });
    expect(material.opacity).toBeCloseTo(POLLEN_MAX_OPACITY, 6);

    field.update(1 / 60, { renderer: null, progress: 1 });
    expect(material.opacity).toBe(0);
    field.dispose();
  });
});

describe("PollenField.dispose", () => {
  it("frees every GPU-path resource it allocated", () => {
    const field = new PollenField({
      support: "float",
      quality: "high",
      reducedMotion: false,
      count: 64,
    });

    const readTarget = vi.spyOn(field.gpgpu!.read, "dispose");
    const writeTarget = vi.spyOn(field.gpgpu!.write, "dispose");
    const seed = vi.spyOn(field.seedTexture!, "dispose");
    const sim = vi.spyOn(field.simulationMaterial!, "dispose");
    const geometry = vi.spyOn(field.points!.geometry, "dispose");
    const material = vi.spyOn(field.points!.material as THREE.ShaderMaterial, "dispose");

    field.dispose();

    expect(readTarget).toHaveBeenCalledTimes(1);
    expect(writeTarget).toHaveBeenCalledTimes(1);
    expect(seed).toHaveBeenCalledTimes(1);
    expect(sim).toHaveBeenCalledTimes(1);
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
    expect(field.object3d.children).toHaveLength(0);
  });

  it("frees every CPU-path resource it allocated", () => {
    const field = new PollenField({
      support: "none",
      quality: "high",
      reducedMotion: false,
      count: 40,
    });

    const geometry = vi.spyOn(field.motes!.geometry, "dispose");
    const material = vi.spyOn(field.motes!.material as THREE.MeshBasicMaterial, "dispose");
    const instanced = vi.spyOn(field.motes!, "dispose");

    field.dispose();

    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
    expect(instanced).toHaveBeenCalledTimes(1);
    expect(field.object3d.children).toHaveLength(0);
  });

  it("is idempotent and makes update() a no-op afterwards", () => {
    const field = new PollenField({
      support: "float",
      quality: "high",
      reducedMotion: false,
      count: 64,
    });
    const seed = vi.spyOn(field.seedTexture!, "dispose");
    const renderer = makeRenderer();

    field.dispose();
    field.dispose();
    expect(seed).toHaveBeenCalledTimes(1);

    expect(() => field.update(1 / 60, { renderer })).not.toThrow();
    expect(renderer.render).not.toHaveBeenCalled();
  });
});
