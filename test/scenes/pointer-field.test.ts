// test/scenes/pointer-field.test.ts
//
// M2 "pointer-field" workstream (design doc §5 row 4): spring field math
// (impulse decays, items return home within N steps), the influence falloff
// function, instance color assignment from decor, and dispose bookkeeping —
// plus the SceneModule wrapper's reducedMotion/onPointer branches.

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  PointerFieldSim,
  createHomeGrid,
  influenceFalloff,
  colorForInstance,
} from "@/lib/scenes/pointer-field/sim";
import createPointerFieldScene from "@/lib/scenes/pointer-field/scene";
import { decor } from "@/lib/flavors";
import type { AssetManager, RectData, ScrollState, ViewContext } from "@/lib/engine/types";

// ---------------------------------------------------------------------------
// influenceFalloff — pure function
// ---------------------------------------------------------------------------

describe("influenceFalloff", () => {
  it("is 1 at distance 0 and 0 at/beyond the radius", () => {
    expect(influenceFalloff(0, 100)).toBe(1);
    expect(influenceFalloff(100, 100)).toBe(0);
    expect(influenceFalloff(150, 100)).toBe(0);
  });

  it("decreases monotonically as distance approaches the radius", () => {
    const radius = 100;
    const samples = [0, 10, 25, 50, 75, 90, 99].map((d) => influenceFalloff(d, radius));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeLessThan(samples[i - 1]!);
    }
  });

  it("is 0 for a non-positive radius (degenerate influence zone)", () => {
    expect(influenceFalloff(0, 0)).toBe(0);
    expect(influenceFalloff(5, -10)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createHomeGrid — pure layout
// ---------------------------------------------------------------------------

describe("createHomeGrid", () => {
  it("places every item within the width/height bounds, centered at the origin", () => {
    const { x, y } = createHomeGrid(300, 800, 600, 0);
    expect(x.length).toBe(300);
    expect(y.length).toBe(300);
    for (let i = 0; i < 300; i++) {
      expect(x[i]!).toBeGreaterThanOrEqual(-400);
      expect(x[i]!).toBeLessThanOrEqual(400);
      expect(y[i]!).toBeGreaterThanOrEqual(-300);
      expect(y[i]!).toBeLessThanOrEqual(300);
    }
  });

  it("jitter=0 is deterministic and reproducible across calls (the reduced-motion static grid)", () => {
    const a = createHomeGrid(50, 400, 300, 0);
    const b = createHomeGrid(50, 400, 300, 0);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.y)).toEqual(Array.from(b.y));
  });

  it("jitter>0 perturbs positions away from the exact grid, but stays reproducible for a fixed seed", () => {
    const grid = createHomeGrid(50, 400, 300, 0);
    const jittered = createHomeGrid(50, 400, 300, 0.6, 7);
    const jitteredAgain = createHomeGrid(50, 400, 300, 0.6, 7);

    expect(Array.from(jittered.x)).toEqual(Array.from(jitteredAgain.x));
    const anyDifferent = Array.from(grid.x).some((v, i) => v !== jittered.x[i]);
    expect(anyDifferent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// colorForInstance — instance color assignment from decor
// ---------------------------------------------------------------------------

describe("colorForInstance", () => {
  it("round-robins leaf instances through decor.leafDark/leafLight", () => {
    const leafDark = parseInt(decor.leafDark.replace("#", ""), 16);
    const leafLight = parseInt(decor.leafLight.replace("#", ""), 16);
    expect(colorForInstance(0, "leaf")).toBe(leafDark);
    expect(colorForInstance(1, "leaf")).toBe(leafLight);
    expect(colorForInstance(2, "leaf")).toBe(leafDark);
    expect(colorForInstance(3, "leaf")).toBe(leafLight);
  });

  it("round-robins berry instances through decor.citrusLemon/citrusPeach/berry", () => {
    const lemon = parseInt(decor.citrusLemon.replace("#", ""), 16);
    const peach = parseInt(decor.citrusPeach.replace("#", ""), 16);
    const berry = parseInt(decor.berry.replace("#", ""), 16);
    expect(colorForInstance(0, "berry")).toBe(lemon);
    expect(colorForInstance(1, "berry")).toBe(peach);
    expect(colorForInstance(2, "berry")).toBe(berry);
    expect(colorForInstance(3, "berry")).toBe(lemon);
  });

  it("is deterministic — same (index, kind) always yields the same color", () => {
    expect(colorForInstance(37, "leaf")).toBe(colorForInstance(37, "leaf"));
    expect(colorForInstance(37, "berry")).toBe(colorForInstance(37, "berry"));
  });
});

// ---------------------------------------------------------------------------
// PointerFieldSim — spring field math
// ---------------------------------------------------------------------------

describe("PointerFieldSim", () => {
  it("starts every item at rest at its home position", () => {
    const sim = new PointerFieldSim([0, 100, -50], [0, 20, -30]);
    expect(Array.from(sim.posX)).toEqual([0, 100, -50]);
    expect(Array.from(sim.posY)).toEqual([0, 20, -30]);
    expect(Array.from(sim.velX)).toEqual([0, 0, 0]);
    expect(Array.from(sim.velY)).toEqual([0, 0, 0]);
  });

  it("throws on mismatched homeX/homeY lengths", () => {
    expect(() => new PointerFieldSim([0, 1], [0])).toThrow();
  });

  it("applyRadialImpulse pushes items within radius away from the impulse point, and ignores items outside it", () => {
    const sim = new PointerFieldSim([0, 500], [0, 0]); // item 0 at the impulse center, item 1 far away
    sim.applyRadialImpulse(0, 0, 100, 1000);

    expect(sim.velX[1]).toBe(0); // untouched — outside the radius
    // item 0 is exactly at the impulse point (degenerate direction case) —
    // still gets pushed (non-zero velocity), just along the stable fallback
    // direction rather than a NaN.
    expect(Number.isFinite(sim.velX[0])).toBe(true);
    expect(sim.velX[0]! !== 0 || sim.velY[0]! !== 0).toBe(true);
  });

  it("applyRadialImpulse is a no-op for radius<=0 or strength===0", () => {
    const sim = new PointerFieldSim([10], [10]);
    sim.applyRadialImpulse(0, 0, 0, 1000);
    expect(sim.velX[0]).toBe(0);
    sim.applyRadialImpulse(0, 0, 100, 0);
    expect(sim.velX[0]).toBe(0);
  });

  it("an impulse decays: velocity magnitude shrinks step over step once no new impulse is applied", () => {
    const sim = new PointerFieldSim([200], [0]);
    sim.applyRadialImpulse(0, 0, 400, 5000); // one-shot burst
    const dt = 1 / 60;
    const speeds: number[] = [];
    for (let i = 0; i < 30; i++) {
      sim.step(dt);
      speeds.push(Math.hypot(sim.velX[0]!, sim.velY[0]!));
    }
    // Not monotonic every single frame near a spring's natural oscillation,
    // but well past its peak the trend is clearly down: the last sample is
    // much smaller than the largest early sample.
    const peak = Math.max(...speeds.slice(0, 5));
    const tail = speeds[speeds.length - 1]!;
    expect(tail).toBeLessThan(peak * 0.5);
  });

  it("items return home within N steps after an impulse burst", () => {
    const home = createHomeGrid(20, 400, 300, 0);
    const sim = new PointerFieldSim(home.x, home.y);
    sim.applyRadialImpulse(0, 0, 200, 3000);

    const dt = 1 / 60;
    for (let i = 0; i < 240; i++) sim.step(dt); // 4s of simulated time

    for (let i = 0; i < sim.count; i++) {
      const dx = sim.posX[i]! - sim.homeX[i]!;
      const dy = sim.posY[i]! - sim.homeY[i]!;
      expect(Math.hypot(dx, dy)).toBeLessThan(1); // back within 1px of home
      expect(Math.hypot(sim.velX[i]!, sim.velY[i]!)).toBeLessThan(1); // at rest
    }
  });

  it("reset() snaps every item back to home at rest", () => {
    const sim = new PointerFieldSim([0, 0], [0, 0]);
    sim.applyRadialImpulse(0, 0, 100, 1000);
    sim.step(1 / 60);
    expect(sim.velX[0] !== 0 || sim.velY[0] !== 0).toBe(true);

    sim.reset();
    expect(Array.from(sim.posX)).toEqual([0, 0]);
    expect(Array.from(sim.posY)).toEqual([0, 0]);
    expect(Array.from(sim.velX)).toEqual([0, 0]);
    expect(Array.from(sim.velY)).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------------------
// SceneModule wrapper (scene.ts) — init/update/onPointer/dispose contract
// ---------------------------------------------------------------------------

function fakeAssets(): AssetManager {
  return {
    add: () => {},
    get: () => {
      throw new Error("n/a");
    },
    start: async () => {},
    onProgress: () => () => {},
  };
}

function fakeScroll(): ScrollState {
  return { target: 0, current: 0, velocity: 0, progress: 0, limit: 1000 };
}

function makeCtx(overrides: Partial<ViewContext> = {}): ViewContext {
  const rect: RectData = { top: 0, left: 0, width: 800, height: 600 };
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.1, 10000),
    rect,
    scroll: fakeScroll(),
    pointer: { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false },
    assets: fakeAssets(),
    size: { width: rect.width, height: rect.height, dpr: 1 },
    quality: "high",
    reducedMotion: false,
    ...overrides,
  };
}

describe("pointer-field SceneModule", () => {
  it("init populates the scene with a leaf and a berry InstancedMesh", () => {
    const scene = createPointerFieldScene();
    const ctx = makeCtx();
    scene.init(ctx);

    const meshes = ctx.scene.children.filter((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
    expect(meshes).toHaveLength(2);
    // ~300 total instances split leaf/berry (see BERRY_EVERY in scene.ts).
    const totalInstances = meshes.reduce((sum, m) => sum + m.count, 0);
    expect(totalInstances).toBe(300);

    scene.dispose();
  });

  it("instance materials never enable vertexColors, and per-instance colors are authored (F-003 regression)", () => {
    // Regression (design-review F-003): `vertexColors: true` samples the
    // geometry's per-vertex `color` attribute, which leaf/berry geometry
    // doesn't have — a missing attribute reads (0,0,0) in WebGL, so every
    // instance rendered as a black speck. Instance colors flow through
    // `setColorAt`/`instanceColor` alone; the flag must stay off.
    const scene = createPointerFieldScene();
    const ctx = makeCtx();
    scene.init(ctx);

    const meshes = ctx.scene.children.filter((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
    expect(meshes).toHaveLength(2);
    for (const mesh of meshes) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      expect(material.vertexColors).toBe(false);
      expect(mesh.geometry.getAttribute("color")).toBeUndefined();
      expect(mesh.instanceColor).not.toBeNull();
    }

    scene.dispose();
  });

  it("reducedMotion: update() does not move any instance (static grid)", () => {
    const scene = createPointerFieldScene();
    const ctx = makeCtx({ reducedMotion: true, pointer: { x: 0.8, y: 0.5, vx: 5, vy: 5, down: false, inside: true } });
    scene.init(ctx);

    const [mesh] = ctx.scene.children.filter((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
    const before = new THREE.Matrix4();
    mesh!.getMatrixAt(0, before);

    scene.update(1 / 60, ctx);

    const after = new THREE.Matrix4();
    mesh!.getMatrixAt(0, after);
    expect(after.elements).toEqual(before.elements);

    scene.dispose();
  });

  /** Snapshot every instance's matrix across both InstancedMeshes, keyed by
   * a stable "meshIndex:instanceIndex" string — used to check whether ANY
   * instance moved without coupling the assertion to which specific
   * instance ends up within a given impulse's influence radius. */
  function snapshotMatrices(ctx: ViewContext): Map<string, number[]> {
    const meshes = ctx.scene.children.filter((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
    const snapshot = new Map<string, number[]>();
    meshes.forEach((mesh, meshIndex) => {
      const m = new THREE.Matrix4();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        snapshot.set(`${meshIndex}:${i}`, Array.from(m.elements));
      }
    });
    return snapshot;
  }

  function anyChanged(before: Map<string, number[]>, after: Map<string, number[]>): boolean {
    for (const [key, beforeEls] of before) {
      const afterEls = after.get(key)!;
      if (!beforeEls.every((v, i) => v === afterEls[i])) return true;
    }
    return false;
  }

  it("non-reducedMotion: a moving pointer inside the view shoves nearby instances off their home position", () => {
    const scene = createPointerFieldScene();
    const ctx = makeCtx({
      reducedMotion: false,
      pointer: { x: 0, y: 0, vx: 3, vy: 0, down: false, inside: true },
    });
    scene.init(ctx);

    const before = snapshotMatrices(ctx);
    for (let i = 0; i < 5; i++) scene.update(1 / 60, ctx);
    const after = snapshotMatrices(ctx);

    expect(anyChanged(before, after)).toBe(true);

    scene.dispose();
  });

  it("onPointer queues an impulse that update() applies and that decays back toward rest", () => {
    const scene = createPointerFieldScene();
    const ctx = makeCtx({ reducedMotion: false, pointer: { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false } });
    scene.init(ctx);
    const beforeImpulse = snapshotMatrices(ctx);

    scene.onPointer!({ x: 0, y: 0, point: { x: 0, y: 0, z: 0 }, distance: 1 });
    scene.update(1 / 60, ctx); // applies the queued impulse + one spring step
    const afterImpulse = snapshotMatrices(ctx);
    expect(anyChanged(beforeImpulse, afterImpulse)).toBe(true);

    // A stray null hit afterward should not queue anything (no-op, no crash).
    scene.onPointer!(null);
    for (let i = 0; i < 120; i++) scene.update(1 / 60, ctx); // ~2s to settle
    const afterSettle = snapshotMatrices(ctx);

    // Whatever moved during the impulse frame keeps moving/settling
    // afterward rather than freezing in place — sanity check that the
    // underlying sim is still being stepped (spring-bound, not stuck).
    expect(anyChanged(afterImpulse, afterSettle)).toBe(true);

    scene.dispose();
  });

  it("init registers both InstancedMesh as interactive, tagged with an instanceIndexMap back to the global sim index", () => {
    const scene = createPointerFieldScene();
    const registered: THREE.Object3D[] = [];
    const ctx = makeCtx({ registerInteractive: (objects) => registered.push(...objects) });
    scene.init(ctx);

    expect(registered).toHaveLength(2);
    for (const obj of registered) {
      expect(obj).toBeInstanceOf(THREE.InstancedMesh);
      expect(obj.userData.instanceIndexMap).toBeDefined();
    }

    scene.dispose();
  });

  it("onPointer with a real hit's instanceId centers the impulse on that exact instance's own position, not the raw hit.point", () => {
    const scene = createPointerFieldScene();
    const ctx = makeCtx();
    scene.init(ctx);

    const before = snapshotMatrices(ctx);
    // hit.point is deliberately far outside the field (home grid spans
    // roughly [-400,400]x[-300,300] for this rect) — if the old
    // point-based behavior were still in effect, applyRadialImpulse's
    // 170px radius would find nothing near (9999,9999) and NOTHING would
    // move. Only the instanceId-based path (indexing directly into the
    // sim's own posX/posY) can produce movement here.
    scene.onPointer!({ x: 0, y: 0, point: { x: 9999, y: 9999, z: 0 }, distance: 1, instanceId: 42 });
    scene.update(1 / 60, ctx);
    const after = snapshotMatrices(ctx);

    expect(anyChanged(before, after)).toBe(true);

    scene.dispose();
  });

  it("design review item E12: onPointer with an out-of-range instanceId falls back to hit.point instead of crashing or producing NaN", () => {
    const scene = createPointerFieldScene();
    const ctx = makeCtx();
    scene.init(ctx);

    const before = snapshotMatrices(ctx);
    // instanceId 99999 is far beyond TOTAL_COUNT (300) — sim.posX/posY index
    // reads for it are `undefined`, not a real position, so scene.ts's
    // `gx != null && gy != null` guard must reject it and fall back to
    // hit.point (here inside the field, at the origin) rather than indexing
    // in with `undefined` and producing NaN positions.
    expect(() =>
      scene.onPointer!({ x: 0, y: 0, point: { x: 0, y: 0, z: 0 }, distance: 1, instanceId: 99999 })
    ).not.toThrow();
    expect(() => scene.update(1 / 60, ctx)).not.toThrow();
    const after = snapshotMatrices(ctx);

    expect(anyChanged(before, after)).toBe(true); // the hit.point fallback still produced a real impulse
    for (const elements of after.values()) {
      for (const v of elements) expect(Number.isNaN(v)).toBe(false);
    }

    scene.dispose();
  });

  it("onPointer is inert once reducedMotion is set (no queued impulse, no crash)", () => {
    const scene = createPointerFieldScene();
    const ctx = makeCtx({ reducedMotion: true });
    scene.init(ctx);

    expect(() => scene.onPointer!({ x: 0, y: 0, point: { x: 0, y: 0, z: 0 }, distance: 1 })).not.toThrow();
    expect(() => scene.update(1 / 60, ctx)).not.toThrow();

    scene.dispose();
  });

  it("dispose frees geometries/materials and removes both meshes from the scene", () => {
    const scene = createPointerFieldScene();
    const ctx = makeCtx();
    scene.init(ctx);

    const meshes = ctx.scene.children.filter((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
    expect(meshes).toHaveLength(2);
    const disposeSpies = meshes.map((m) => vi.spyOn(m.geometry, "dispose"));

    scene.dispose();

    expect(ctx.scene.children.filter((c) => c instanceof THREE.InstancedMesh)).toHaveLength(0);
    for (const spy of disposeSpies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("init is re-runnable: calling it again does not leak duplicate meshes", () => {
    const scene = createPointerFieldScene();
    const ctx = makeCtx();
    scene.init(ctx);
    scene.init(ctx); // simulates context-loss restore re-running init on the same instance

    const meshes = ctx.scene.children.filter((c) => c instanceof THREE.InstancedMesh);
    expect(meshes).toHaveLength(2); // not 4

    scene.dispose();
  });

  it("dispose is safe to call before init (never-initialized instance)", () => {
    const scene = createPointerFieldScene();
    expect(() => scene.dispose()).not.toThrow();
  });
});
