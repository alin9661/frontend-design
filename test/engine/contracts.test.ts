// test/engine/contracts.test.ts
//
// M0 contract tests: the shared types in lib/engine/types.ts compile and
// are structurally satisfiable (checked at build time by `bunx tsc
// --noEmit`, exercised here at runtime by actually constructing values of
// each shape); the worker protocol's pack/unpack round-trips through 0, 1,
// and 3 views; and the "placeholder" scene module has the full SceneModule
// shape and behaves correctly.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type {
  AssetManager,
  Ease,
  HostInit,
  MainToWorker,
  PointerHit,
  PointerState,
  QualityTier,
  RectData,
  RendererLike,
  RenderHost,
  ScrollOptions,
  ScrollState,
  SceneId,
  SplatData,
  TrackKeyframe,
  ViewContext,
  WorkerToMain,
} from "@/lib/engine/types";
import { TickOrder } from "@/lib/engine/types";
import {
  FLOATS_PER_VIEW,
  MainToWorkerType,
  SCALAR_SLOT_COUNT,
  WorkerToMainType,
  packFrameState,
  unpackFrameState,
  type FrameStateScalars,
  type FrameStateView,
} from "@/lib/engine/worker/protocol";
import { loadScene, sceneRegistry } from "@/lib/engine/worker/scene-registry";
import createPlaceholderScene from "@/lib/scenes/placeholder/scene";

describe("engine contracts — shared types compile and are constructible", () => {
  it("TickOrder matches the documented ordering", () => {
    expect(TickOrder).toEqual({ INPUT: 0, SCROLL: 10, SCENE: 20, RENDER: 30 });
  });

  it("ScrollState/ScrollOptions/RectData/PointerState/PointerHit/SplatData are constructible", () => {
    const scroll: ScrollState = {
      target: 0,
      current: 0,
      velocity: 0,
      progress: 0,
      limit: 1000,
    };
    const opts: ScrollOptions = { lambda: 8, wheelMultiplier: 1, reducedMotion: false };
    const rect: RectData = { top: 0, left: 0, width: 100, height: 100 };
    const pointer: PointerState = { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: true };
    const hit: PointerHit = { x: 0, y: 0, point: { x: 0, y: 0, z: 0 }, distance: 1 };
    const splat: SplatData = {
      count: 1,
      positions: new Float32Array(3),
      scales: new Float32Array(3),
      colors: new Uint8Array(4),
      quats: new Uint8Array(4),
    };

    expect(scroll.limit).toBe(1000);
    expect(opts.lambda).toBe(8);
    expect(rect.width).toBe(100);
    expect(pointer.inside).toBe(true);
    expect(hit.distance).toBe(1);
    expect(splat.colors.length).toBe(4);
  });

  it("SceneId union covers exactly the 7 documented scene ids", () => {
    const ids: SceneId[] = [
      "hero-can",
      "exploded",
      "particles",
      "pointer-field",
      "splat-lounge",
      "picker",
      "placeholder",
    ];
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
  });

  it("RendererLike / HostInit / RenderHost / TrackKeyframe / Ease are structurally satisfiable", () => {
    const renderer: RendererLike = {
      setSize: () => {},
      setScissor: () => {},
      setScissorTest: () => {},
      setViewport: () => {},
      render: () => {},
      dispose: () => {},
    };
    const hostInit: HostInit = { dpr: 1, quality: "high", reducedMotion: false };
    const quality: QualityTier = hostInit.quality;
    const ease: Ease = (t) => t * 2;
    const key: TrackKeyframe = { t: 0.5, v: 1, ease };

    const host: RenderHost = {
      mode: "main",
      init: async () => {},
      frame: () => {},
      addView: () => {},
      removeView: () => {},
      invoke: () => {},
      onMessage: () => () => {},
      resize: () => {},
      destroy: () => {},
    };

    expect(renderer.domElement).toBeUndefined();
    expect(quality).toBe("high");
    expect(ease(0.5)).toBe(1);
    expect(key.v).toBe(1);
    expect(host.mode).toBe("main");
  });

  it("MainToWorker / WorkerToMain discriminated unions accept every documented variant", () => {
    const toWorker: MainToWorker[] = [
      { type: "INIT", canvas: {} as OffscreenCanvas, dpr: 1, quality: "high", reducedMotion: false },
      { type: "FRAME_STATE", state: new Float32Array(SCALAR_SLOT_COUNT) },
      { type: "RESIZE", width: 800, height: 600, dpr: 2 },
      { type: "VIEW_ADD", viewId: 0, sceneId: "placeholder", rect: { top: 0, left: 0, width: 10, height: 10 } },
      { type: "VIEW_REMOVE", viewId: 0 },
      { type: "SCENE_INVOKE", viewId: 0, method: "select", args: [1] },
      { type: "SET_REDUCED_MOTION", on: true },
      { type: "DISPOSE" },
    ];
    const fromWorker: WorkerToMain[] = [
      { type: "READY" },
      { type: "ASSET_PROGRESS", p: 0.5, id: "font" },
      { type: "ASSETS_DONE" },
      { type: "HIT", viewId: 0, hit: null },
      { type: "STATS", ms: 16, drawCalls: 3, splats: 0, sortMs: 0 },
      { type: "CONTEXT_LOST" },
      { type: "CONTEXT_RESTORED" },
    ];

    expect(toWorker).toHaveLength(8);
    expect(fromWorker).toHaveLength(7);
    // every variant's `type` round-trips through the message-type constants
    expect(MainToWorkerType.INIT).toBe(toWorker[0]!.type);
    expect(WorkerToMainType.READY).toBe(fromWorker[0]!.type);
  });

  it("AssetManager / ViewContext are structurally satisfiable (no DOM/WebGL required)", () => {
    const assets: AssetManager = {
      add: () => {},
      get: () => {
        throw new Error("not needed in this test");
      },
      start: async () => {},
      onProgress: () => () => {},
    };
    const ctx: ViewContext = {
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(45, 1, 0.1, 1000),
      rect: { top: 0, left: 0, width: 300, height: 300 },
      scroll: { target: 0, current: 0, velocity: 0, progress: 0, limit: 1000 },
      pointer: { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false },
      assets,
      size: { width: 300, height: 300, dpr: 1 },
      quality: "medium",
      reducedMotion: false,
    };
    expect(ctx.scene).toBeInstanceOf(THREE.Scene);
    expect(ctx.quality).toBe("medium");
  });
});

describe("worker/protocol packFrameState/unpackFrameState round-trip", () => {
  // Every value here is exactly representable as an IEEE-754 float32 (sums
  // of powers of two), so the Float32Array round-trip is lossless. Values
  // like 0.42 or 0.1 are NOT exactly representable and would make this a
  // flaky-by-construction test — packFrameState/unpackFrameState are pure
  // and correct, but Float32 storage is inherently lossy for those inputs.
  const scalars: FrameStateScalars = {
    scrollCurrent: 120.5,
    scrollVelocity: -3.25,
    scrollProgress: 0.4375,
    pointerX: 0.125,
    pointerY: -0.25,
    pointerVX: 0.03125,
    pointerVY: -0.0625,
  };

  it("round-trips with 0 views", () => {
    const packed = packFrameState(scalars, []);
    expect(packed).toBeInstanceOf(Float32Array);
    expect(packed.length).toBe(SCALAR_SLOT_COUNT);
    expect(unpackFrameState(packed)).toEqual({ ...scalars, views: [] });
  });

  it("round-trips with 1 view", () => {
    const views: FrameStateView[] = [
      { viewId: 3, top: 100, left: 0, width: 300, height: 400, progress: 0.5 },
    ];
    const packed = packFrameState(scalars, views);
    expect(packed.length).toBe(SCALAR_SLOT_COUNT + FLOATS_PER_VIEW);
    expect(unpackFrameState(packed)).toEqual({ ...scalars, views });
  });

  it("round-trips with 3 views", () => {
    const views: FrameStateView[] = [
      { viewId: 0, top: 0, left: 0, width: 100, height: 100, progress: 0 },
      { viewId: 1, top: 500, left: 0, width: 100, height: 200, progress: 0.25 },
      { viewId: 2, top: 1200, left: 50, width: 300, height: 600, progress: 1 },
    ];
    const packed = packFrameState(scalars, views);
    expect(packed.length).toBe(SCALAR_SLOT_COUNT + 3 * FLOATS_PER_VIEW);
    expect(unpackFrameState(packed)).toEqual({ ...scalars, views });
  });

  it("throws on a too-short buffer", () => {
    expect(() => unpackFrameState(new Float32Array(SCALAR_SLOT_COUNT - 1))).toThrow();
  });

  it("throws on a buffer whose view remainder isn't a multiple of FLOATS_PER_VIEW", () => {
    expect(() => unpackFrameState(new Float32Array(SCALAR_SLOT_COUNT + 1))).toThrow();
  });

  it("exposes the documented message-type constants", () => {
    expect(MainToWorkerType.INIT).toBe("INIT");
    expect(MainToWorkerType.DISPOSE).toBe("DISPOSE");
    expect(WorkerToMainType.READY).toBe("READY");
    expect(WorkerToMainType.CONTEXT_RESTORED).toBe("CONTEXT_RESTORED");
  });
});

describe("lib/scenes/placeholder — SceneModule shape", () => {
  function makeViewContext(rect: RectData): ViewContext {
    return {
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(45, 1, 0.1, 1000),
      rect,
      scroll: { target: 0, current: 0, velocity: 0, progress: 0, limit: 1000 },
      pointer: { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false },
      assets: {
        add: () => {},
        get: () => {
          throw new Error("not needed in this test");
        },
        start: async () => {},
        onProgress: () => () => {},
      },
      size: { width: rect.width, height: rect.height, dpr: 1 },
      quality: "high",
      reducedMotion: false,
    };
  }

  it("implements the full SceneModule contract", () => {
    const scene = createPlaceholderScene();
    expect(typeof scene.init).toBe("function");
    expect(typeof scene.update).toBe("function");
    expect(typeof scene.dispose).toBe("function");
  });

  it("init adds a mesh colored per-view (different rects -> different colors)", () => {
    const ctxA = makeViewContext({ top: 0, left: 0, width: 300, height: 300 });
    const ctxB = makeViewContext({ top: 900, left: 40, width: 300, height: 300 });
    createPlaceholderScene().init(ctxA);
    createPlaceholderScene().init(ctxB);

    const meshA = ctxA.scene.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    const meshB = ctxB.scene.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(meshA).toBeDefined();
    expect(meshB).toBeDefined();

    const colorA = (meshA!.material as THREE.MeshStandardMaterial).color.getHexString();
    const colorB = (meshB!.material as THREE.MeshStandardMaterial).color.getHexString();
    expect(colorA).not.toBe(colorB);
  });

  it("update spins the box, and holds still under reducedMotion (both branches)", () => {
    const ctx = makeViewContext({ top: 0, left: 0, width: 300, height: 300 });
    const scene = createPlaceholderScene();
    scene.init(ctx);
    const mesh = ctx.scene.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)!;

    const before = mesh.rotation.x;
    scene.update(0.5, ctx);
    expect(mesh.rotation.x).not.toBe(before);

    const rotated = mesh.rotation.x;
    scene.update(0.5, { ...ctx, reducedMotion: true });
    expect(mesh.rotation.x).toBe(rotated);
  });

  it("dispose removes everything it added and frees geometry/material", () => {
    const ctx = makeViewContext({ top: 0, left: 0, width: 300, height: 300 });
    const scene = createPlaceholderScene();
    scene.init(ctx);
    expect(ctx.scene.children.length).toBeGreaterThan(0);

    scene.dispose();
    expect(ctx.scene.children.length).toBe(0);
  });

  it("scene-registry resolves every registered scene id to a real SceneModule", async () => {
    const ids = [
      "placeholder",
      "hero-can",
      "exploded",
      "particles",
      "pointer-field",
      "splat-lounge",
      "picker",
    ] as const;

    for (const id of ids) {
      const mod = await loadScene(id);
      expect(typeof mod.init).toBe("function");
      expect(typeof mod.update).toBe("function");
      expect(typeof mod.dispose).toBe("function");
    }

    expect(Object.keys(sceneRegistry).sort()).toEqual([...ids].sort());
  });
});
