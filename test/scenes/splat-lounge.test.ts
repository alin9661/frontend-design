// test/scenes/splat-lounge.test.ts
//
// M2 "splats" workstream (design doc §5 row 5): the SceneModule wrapper
// around SplatMesh + synthesizeCanScene — init/onProgress/update/dispose
// contract, camera orbiting driven by scroll progress, re-runnable init,
// and dispose bookkeeping. The splat math itself (covariance, sort,
// synthesize invariants, format parsers) is covered in test/engine/splats/.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import createSplatLoungeScene from "@/lib/scenes/splat-lounge/scene";
import type { AssetManager, RectData, ScrollState, ViewContext } from "@/lib/engine/types";

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

function findSplatMesh(ctx: ViewContext): THREE.Mesh | undefined {
  return ctx.scene.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
}

describe("splat-lounge SceneModule", () => {
  it("init adds the synthesized splat mesh to the scene, with the design doc's ~80k-150k instance count", () => {
    const scene = createSplatLoungeScene();
    const ctx = makeCtx();
    scene.init(ctx);

    const mesh = findSplatMesh(ctx);
    expect(mesh).toBeDefined();
    const geometry = mesh!.geometry as THREE.InstancedBufferGeometry;
    expect(geometry.instanceCount).toBeGreaterThanOrEqual(80000);
    expect(geometry.instanceCount).toBeLessThanOrEqual(150000);

    scene.dispose();
  });

  it("positions the camera per the orbit timeline immediately on init (p=0 sample)", () => {
    const scene = createSplatLoungeScene();
    const ctx = makeCtx();
    scene.init(ctx);

    // Camera should be pulled back from the origin onto the orbit circle,
    // looking generally back toward the can (not left at its ViewContext
    // default of the origin).
    expect(ctx.camera.position.length()).toBeGreaterThan(100);

    scene.dispose();
  });

  it("onProgress + update moves the camera along the orbit as progress advances", () => {
    const scene = createSplatLoungeScene();
    const ctx = makeCtx();
    scene.init(ctx);

    scene.onProgress?.(0);
    scene.update(1 / 60, ctx);
    const posAtStart = ctx.camera.position.clone();

    scene.onProgress?.(1);
    scene.update(1 / 60, ctx);
    const posAtEnd = ctx.camera.position.clone();

    expect(posAtStart.distanceTo(posAtEnd)).toBeGreaterThan(1);

    scene.dispose();
  });

  it("update() does not throw across repeated calls (drives SplatMesh.update's depth sort each time)", () => {
    const scene = createSplatLoungeScene();
    const ctx = makeCtx();
    scene.init(ctx);

    expect(() => {
      for (let i = 0; i < 5; i++) {
        scene.onProgress?.(i / 5);
        scene.update(1 / 60, ctx);
      }
    }).not.toThrow();

    scene.dispose();
  });

  it("dispose removes the splat mesh from the scene", () => {
    const scene = createSplatLoungeScene();
    const ctx = makeCtx();
    scene.init(ctx);
    expect(findSplatMesh(ctx)).toBeDefined();

    scene.dispose();
    expect(findSplatMesh(ctx)).toBeUndefined();
  });

  it("init is re-runnable: calling it again does not leak a duplicate mesh", () => {
    const scene = createSplatLoungeScene();
    const ctx = makeCtx();
    scene.init(ctx);
    scene.init(ctx); // simulates context-loss restore re-running init on the same instance

    const meshes = ctx.scene.children.filter((c) => c instanceof THREE.Mesh);
    expect(meshes).toHaveLength(1); // not 2

    scene.dispose();
  });

  it("dispose is safe to call before init (never-initialized instance)", () => {
    const scene = createSplatLoungeScene();
    expect(() => scene.dispose()).not.toThrow();
  });

  it("BUG B3 stats regression: getStats() surfaces the real SplatMesh count/sortMs instead of the HUD's hardcoded 0/0", () => {
    // Before this method existed, worker/render.worker.ts and
    // worker/host.ts's MainThreadHost had no way to read a scene's splat
    // count at all and hardcoded `splats: 0, sortMs: 0` in every STATS
    // message — see the gap documented in
    // components/deep-wave/SectionSplats.tsx.
    const scene = createSplatLoungeScene();
    const ctx = makeCtx();
    scene.init(ctx);

    const stats = scene.getStats?.();
    expect(stats).toBeTruthy();
    expect(stats!.splats).toBeGreaterThanOrEqual(80000);
    expect(stats!.splats).toBeLessThanOrEqual(150000);
    expect(stats!.sortMs).toBeGreaterThanOrEqual(0);

    scene.dispose();
  });

  it("getStats() before init reports zero splats instead of throwing", () => {
    const scene = createSplatLoungeScene();
    expect(scene.getStats?.()).toEqual({ splats: 0, sortMs: 0 });
  });
});
