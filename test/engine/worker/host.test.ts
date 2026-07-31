// test/engine/worker/host.test.ts
//
// Covers design doc §4A's two worker/host.ts requirements:
//  - createRenderHost() fallback selection: jsdom has neither
//    HTMLCanvasElement.prototype.transferControlToOffscreen nor
//    OffscreenCanvas, so it must silently select MainThreadHost.
//  - MainThreadHost end to end against a RendererLike mock (no real WebGL
//    context, matching the "jsdom test path" contract in the design doc):
//    init -> addView("placeholder") -> frame -> resize -> destroy, with the
//    placeholder scene module mocked so init/update/dispose calls are
//    directly observable.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Stage, type StageFrameInput } from "@/lib/engine/gl/stage";
import type { RectData, RendererLike, ViewContext } from "@/lib/engine/types";
import { packFrameState, SCALAR_SLOT_COUNT, type FrameStateView } from "@/lib/engine/worker/protocol";

const { sceneInit, sceneUpdate, sceneDispose, sceneResize, sceneOnProgress, sceneGetStats, sceneOnPointer } =
  vi.hoisted(() => ({
    sceneInit: vi.fn(),
    sceneUpdate: vi.fn(),
    sceneDispose: vi.fn(),
    sceneResize: vi.fn(),
    sceneOnProgress: vi.fn(),
    // Returns `undefined` by default (SceneModule.getStats is optional) —
    // individual tests configure a return value via
    // `sceneGetStats.mockReturnValue(...)` to exercise the STATS-summation
    // path (see the "BUG B3 stats regression" test below).
    sceneGetStats: vi.fn((): { splats?: number; sortMs?: number } | undefined => undefined),
    // SceneModule.onPointer is optional too — a spy so the raycast/HIT
    // wiring tests below can assert it was actually driven, without every
    // other test in this file needing to care.
    sceneOnPointer: vi.fn(),
  }));

// scene-registry.ts's "placeholder" loader does
// `import("@/lib/scenes/placeholder/scene").then((m) => m.default())` — mock
// the module it imports so the test observes calls directly instead of
// asserting on THREE.Mesh/material side effects (already covered by
// test/engine/contracts.test.ts's placeholder-scene suite).
vi.mock("@/lib/scenes/placeholder/scene", () => ({
  default: () => ({
    init: sceneInit,
    update: sceneUpdate,
    dispose: sceneDispose,
    resize: sceneResize,
    onProgress: sceneOnProgress,
    getStats: sceneGetStats,
    onPointer: sceneOnPointer,
  }),
}));

// Imported after the mock is registered (vi.mock calls are hoisted above
// imports by Vitest, so this ordering in source doesn't matter, but it
// documents intent).
const { createRenderHost, MainThreadHost, WorkerHost, supportsOffscreenWorkerRendering } = await import(
  "@/lib/engine/worker/host"
);

function makeFrameState(
  views: FrameStateView[],
  pointer: { pointerDown?: boolean; pointerInside?: boolean } = {}
): Float32Array {
  return packFrameState(
    {
      scrollCurrent: 0,
      scrollVelocity: 0,
      scrollProgress: 0,
      pointerX: 0,
      pointerY: 0,
      pointerVX: 0,
      pointerVY: 0,
      pointerDown: pointer.pointerDown ?? false,
      pointerInside: pointer.pointerInside ?? true,
    },
    views
  );
}

function makeRendererMock(): RendererLike {
  return {
    setSize: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
    setViewport: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  };
}

const PLACEHOLDER_RECT: RectData = { top: 0, left: 0, width: 300, height: 300 };

describe("createRenderHost — fallback selection", () => {
  it("jsdom has neither transferControlToOffscreen nor OffscreenCanvas", () => {
    expect(supportsOffscreenWorkerRendering()).toBe(false);
  });

  it("returns a MainThreadHost in jsdom (no OffscreenCanvas support)", () => {
    const host = createRenderHost();
    expect(host).toBeInstanceOf(MainThreadHost);
    expect(host.mode).toBe("main");
  });
});

describe("WorkerHost", () => {
  it("reports mode 'worker' without touching the Worker global (constructor only)", () => {
    const host = new WorkerHost();
    expect(host.mode).toBe("worker");
  });

  describe("init() — BUG B1 regression: renderer-creation failure inside the worker", () => {
    class FakeWorker {
      static instances: FakeWorker[] = [];
      listeners = new Set<(ev: MessageEvent) => void>();
      posted: unknown[] = [];
      constructor() {
        FakeWorker.instances.push(this);
      }
      addEventListener(type: string, cb: (ev: MessageEvent) => void) {
        if (type === "message") this.listeners.add(cb);
      }
      removeEventListener(type: string, cb: (ev: MessageEvent) => void) {
        if (type === "message") this.listeners.delete(cb);
      }
      postMessage(msg: unknown) {
        this.posted.push(msg);
      }
      terminate() {}
      /** Simulates render.worker.ts posting a WorkerToMain message back. */
      emit(data: unknown) {
        for (const cb of this.listeners) cb({ data } as MessageEvent);
      }
    }

    function fakeCanvas(): HTMLCanvasElement {
      const canvas = document.createElement("canvas");
      (canvas as unknown as { transferControlToOffscreen: () => unknown }).transferControlToOffscreen = () => ({});
      return canvas;
    }

    beforeEach(() => {
      FakeWorker.instances = [];
      vi.stubGlobal("Worker", FakeWorker);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("rejects instead of hanging forever when the worker posts INIT_FAILED (no READY ever arrives)", async () => {
      // On the old code, WorkerHost.init()'s `ready` promise only ever
      // resolved on a "READY" message — a worker that never posts one (the
      // pre-fix render.worker.ts on a renderer-construction throw) left this
      // promise pending forever, and EngineProvider's status stayed
      // "loading" 0% permanently. This assertion fails (times out) on the
      // pre-fix host.ts.
      const host = new WorkerHost();
      const initPromise = host.init(fakeCanvas(), { dpr: 1, quality: "high", reducedMotion: false });

      const worker = FakeWorker.instances.at(-1)!;
      worker.emit({ type: "INIT_FAILED", error: "WebGL2 context creation failed" });

      await expect(initPromise).rejects.toThrow("WebGL2 context creation failed");
    });

    it("still resolves normally on a real READY message (INIT_FAILED handling doesn't regress the happy path)", async () => {
      const host = new WorkerHost();
      const initPromise = host.init(fakeCanvas(), { dpr: 1, quality: "high", reducedMotion: false });

      const worker = FakeWorker.instances.at(-1)!;
      worker.emit({ type: "READY" });

      await expect(initPromise).resolves.toBeUndefined();
    });
  });
});

describe("MainThreadHost — end to end against a RendererLike mock", () => {
  beforeEach(() => {
    sceneInit.mockClear();
    sceneUpdate.mockClear();
    sceneDispose.mockClear();
    sceneResize.mockClear();
    sceneOnProgress.mockClear();
    sceneGetStats.mockReset().mockReturnValue(undefined);
  });

  it("init -> addView(placeholder) -> frame -> resize -> destroy drives the real scene lifecycle", async () => {
    const rendererMock = makeRendererMock();
    const host = new MainThreadHost({ createRenderer: () => rendererMock });
    const onMessage = vi.fn();
    host.onMessage(onMessage);

    const canvas = document.createElement("canvas");
    await host.init(canvas, { dpr: 1, quality: "high", reducedMotion: false });
    expect(onMessage).toHaveBeenCalledWith({ type: "READY" });

    host.addView(0, "placeholder", PLACEHOLDER_RECT);
    await vi.waitFor(() => expect(sceneInit).toHaveBeenCalledTimes(1));
    expect(sceneDispose).not.toHaveBeenCalled();

    // frame() before any resize(): canvas size is still {0,0}, so the view
    // has zero viewport height to be culled against — Stage must not crash,
    // and correctly treats the view as off-screen (no update/render yet).
    expect(() =>
      host.frame(makeFrameState([{ viewId: 0, ...PLACEHOLDER_RECT, progress: 0 }]))
    ).not.toThrow();
    expect(sceneUpdate).not.toHaveBeenCalled();
    expect(rendererMock.render).not.toHaveBeenCalled();

    host.resize(800, 600, 1);
    expect(rendererMock.setSize).toHaveBeenCalledWith(800, 600, false);

    // Now the view is in view (rect fits inside the resized viewport) — the
    // same frame() call should drive both SceneModule.update and a scissored render.
    host.frame(makeFrameState([{ viewId: 0, ...PLACEHOLDER_RECT, progress: 0.5 }]));
    expect(sceneUpdate).toHaveBeenCalledTimes(1);
    expect(sceneUpdate.mock.calls[0]![0]).toBeTypeOf("number");
    expect(rendererMock.render).toHaveBeenCalledTimes(1);
    expect(rendererMock.setScissor).toHaveBeenCalled();
    expect(rendererMock.setViewport).toHaveBeenCalled();

    host.destroy();
    expect(sceneDispose).toHaveBeenCalledTimes(1);
    expect(rendererMock.dispose).toHaveBeenCalledTimes(1);
  });

  it("skips SceneModule.update under reducedMotion but still renders (static frame, §6 a11y)", async () => {
    const rendererMock = makeRendererMock();
    const host = new MainThreadHost({ createRenderer: () => rendererMock });

    const canvas = document.createElement("canvas");
    await host.init(canvas, { dpr: 1, quality: "high", reducedMotion: true });
    host.addView(1, "placeholder", PLACEHOLDER_RECT);
    await vi.waitFor(() => expect(sceneInit).toHaveBeenCalledTimes(1));

    host.resize(800, 600, 1);
    host.frame(makeFrameState([{ viewId: 1, ...PLACEHOLDER_RECT, progress: 0 }]));

    expect(sceneUpdate).not.toHaveBeenCalled();
    expect(rendererMock.render).toHaveBeenCalledTimes(1); // still renders the static frame

    host.destroy();
  });

  it("removeView disposes the scene and stops driving it on later frames", async () => {
    const rendererMock = makeRendererMock();
    const host = new MainThreadHost({ createRenderer: () => rendererMock });

    const canvas = document.createElement("canvas");
    await host.init(canvas, { dpr: 1, quality: "high", reducedMotion: false });
    host.addView(2, "placeholder", PLACEHOLDER_RECT);
    await vi.waitFor(() => expect(sceneInit).toHaveBeenCalledTimes(1));
    host.resize(800, 600, 1);

    host.removeView(2);
    expect(sceneDispose).toHaveBeenCalledTimes(1);

    sceneUpdate.mockClear();
    host.frame(makeFrameState([{ viewId: 2, ...PLACEHOLDER_RECT, progress: 0 }]));
    expect(sceneUpdate).not.toHaveBeenCalled();

    host.destroy();
  });

  it("design review item B: remove-before-load-resolves disposes the orphaned module instead of resurrecting the view, and a re-add of the same viewId works without an 'already exists' throw", async () => {
    const rendererMock = makeRendererMock();
    const host = new MainThreadHost({ createRenderer: () => rendererMock });
    const canvas = document.createElement("canvas");
    await host.init(canvas, { dpr: 1, quality: "high", reducedMotion: false });

    // addView() kicks off loadScene()'s real dynamic import (a pending
    // microtask) — removeView() for the SAME viewId lands synchronously
    // right after, before that promise has any chance to resolve. On the
    // pre-fix code, the eventual `.then()` callback would still register the
    // now-removed view with Stage/moduleByView (a "zombie" view).
    host.addView(40, "placeholder", PLACEHOLDER_RECT);
    host.removeView(40);

    // Flush the pending loadScene() resolution.
    await vi.waitFor(() => expect(sceneDispose).toHaveBeenCalledTimes(1));
    // The orphaned module's own dispose() ran, but it was never handed to
    // Stage — its init() (called only by Stage.addView) never ran.
    expect(sceneInit).not.toHaveBeenCalled();

    // Re-adding the same viewId afterward must not throw "already exists"
    // (Stage never actually held view 40) and must load/init cleanly.
    sceneDispose.mockClear();
    expect(() => host.addView(40, "placeholder", PLACEHOLDER_RECT)).not.toThrow();
    await vi.waitFor(() => expect(sceneInit).toHaveBeenCalledTimes(1));
    expect(sceneDispose).not.toHaveBeenCalled();

    host.destroy();
  });

  it("design review item F4: resize() retains the last-known scroll/pointer state instead of resetting it to DEFAULTS", async () => {
    // Records every StageFrameInput handed to Stage.setFrame() (init's
    // initial frame, resize()'s, and frame()'s) so the exact scroll/pointer
    // MainThreadHost fed Stage at each step is directly observable — the
    // pre-fix bug was `resize()` calling `buildFrameInput()` with no args,
    // which defaulted back to DEFAULT_SCROLL/DEFAULT_POINTER instead of
    // retaining whatever a previous real `frame()` call had set.
    class RecordingStage extends Stage {
      readonly frames: StageFrameInput[] = [];
      override setFrame(frame: StageFrameInput): void {
        this.frames.push(frame);
        super.setFrame(frame);
      }
    }
    let capturedStage: RecordingStage | null = null;
    const rendererMock = makeRendererMock();
    const host = new MainThreadHost({
      createRenderer: () => rendererMock,
      createStage: (renderer, frame) => {
        capturedStage = new RecordingStage(renderer, frame);
        return capturedStage;
      },
    });

    const canvas = document.createElement("canvas");
    await host.init(canvas, { dpr: 1, quality: "high", reducedMotion: false });
    host.resize(800, 600, 1); // before any real frame() — nothing to retain yet, fine either way

    const realFrame = packFrameState(
      {
        scrollCurrent: 500,
        scrollVelocity: 12,
        scrollProgress: 0.5,
        pointerX: 0.3,
        pointerY: -0.4,
        pointerVX: 1,
        pointerVY: 2,
        pointerDown: true,
        pointerInside: true,
      },
      []
    );
    host.frame(realFrame);
    const framesAfterRealFrame = capturedStage!.frames.length;
    expect(capturedStage!.frames.at(-1)!.scroll.current).toBe(500);
    expect(capturedStage!.frames.at(-1)!.pointer.inside).toBe(true);

    // A resize with NO new FRAME_STATE in between must retain that same
    // scroll/pointer state, not reset it to DEFAULT_SCROLL/DEFAULT_POINTER.
    host.resize(900, 700, 1);
    expect(capturedStage!.frames.length).toBe(framesAfterRealFrame + 1);
    const afterResize = capturedStage!.frames.at(-1)!;
    expect(afterResize.scroll.current).toBe(500);
    expect(afterResize.scroll.velocity).toBe(12);
    expect(afterResize.pointer.x).toBeCloseTo(0.3, 5);
    expect(afterResize.pointer.down).toBe(true);
    expect(afterResize.pointer.inside).toBe(true);

    host.destroy();
  });

  it("frame() is a no-op before init() (no renderer/stage yet)", () => {
    const host = new MainThreadHost();
    expect(() => host.frame(makeFrameState([]))).not.toThrow();
  });

  it("regression: init() with zero registered assets still emits ASSETS_DONE (LoadingScreen must resolve)", async () => {
    // Regression for a real integration bug: MainThreadHost.init() built an
    // AssetManager and subscribed to its progress, but never called
    // .start() — with zero scenes registering asset jobs (the M1 checkpoint
    // state), ASSETS_DONE would never fire and EngineProvider's status
    // would be stuck at "loading" forever. On the old code this test times
    // out / fails because ASSETS_DONE is never observed.
    const rendererMock = makeRendererMock();
    const host = new MainThreadHost({ createRenderer: () => rendererMock });
    const onMessage = vi.fn();
    host.onMessage(onMessage);

    const canvas = document.createElement("canvas");
    await host.init(canvas, { dpr: 1, quality: "high", reducedMotion: false });

    expect(onMessage).toHaveBeenCalledWith({ type: "READY" });
    expect(onMessage).toHaveBeenCalledWith({ type: "ASSET_PROGRESS", p: 1, id: "" });
    expect(onMessage).toHaveBeenCalledWith({ type: "ASSETS_DONE" });

    host.destroy();
  });

  it("BUG B3 stats regression: reports real draw calls (renderer.info) and summed SceneModule.getStats() instead of hardcoded 0s", async () => {
    // On the old code, STATS always posted `drawCalls: 0, splats: 0, sortMs:
    // 0` no matter what actually rendered — the ?debug HUD could never show
    // real activity even once rendering itself worked. This assertion fails
    // on the pre-fix code (which ignores renderer.info and moduleByView
    // entirely).
    const rendererMock: RendererLike = {
      ...makeRendererMock(),
      info: { autoReset: true, reset: () => {}, render: { calls: 7 } },
    };
    sceneGetStats.mockReturnValue({ splats: 12345, sortMs: 2.5 });

    const host = new MainThreadHost({ createRenderer: () => rendererMock });
    const onMessage = vi.fn();
    host.onMessage(onMessage);

    const canvas = document.createElement("canvas");
    await host.init(canvas, { dpr: 1, quality: "high", reducedMotion: false });
    host.addView(0, "placeholder", PLACEHOLDER_RECT);
    await vi.waitFor(() => expect(sceneInit).toHaveBeenCalledTimes(1));
    host.resize(800, 600, 1);

    host.frame(makeFrameState([{ viewId: 0, ...PLACEHOLDER_RECT, progress: 0.5 }]));

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "STATS", drawCalls: 7, splats: 12345, sortMs: 2.5 })
    );

    host.destroy();
  });

  it("packed frame state with 0 views still round-trips through frame() without views", async () => {
    const rendererMock = makeRendererMock();
    const host = new MainThreadHost({ createRenderer: () => rendererMock });
    const canvas = document.createElement("canvas");
    await host.init(canvas, { dpr: 1, quality: "high", reducedMotion: false });

    const empty = makeFrameState([]);
    expect(empty.length).toBe(SCALAR_SLOT_COUNT);
    expect(() => host.frame(empty)).not.toThrow();

    host.destroy();
  });
});

// ---------------------------------------------------------------------------
// MainThreadHost — worker-side raycasting parity (design doc §4A): frame()
// must drive gl/raycast.ts's shared runViewRaycasts() exactly like
// render.worker.ts's RAF tick does (see render.worker.test.ts's identical
// suite) — HIT posted on enter/leave, no HIT spam while hovering the same
// target, SceneModule.onPointer called locally.
// ---------------------------------------------------------------------------

describe("MainThreadHost — raycast/HIT wiring (design doc §4A)", () => {
  const FULL_RECT: RectData = { top: 0, left: 0, width: 800, height: 600 };

  function packFrame(
    pointerX: number,
    pointerY: number,
    viewId: number,
    opts: { down?: boolean; inside?: boolean } = {}
  ): Float32Array {
    return packFrameState(
      {
        scrollCurrent: 0,
        scrollVelocity: 0,
        scrollProgress: 0,
        pointerX,
        pointerY,
        pointerVX: 0,
        pointerVY: 0,
        pointerDown: opts.down ?? false,
        pointerInside: opts.inside ?? true,
      },
      [{ viewId, ...FULL_RECT, progress: 0.5 }]
    );
  }

  beforeEach(() => {
    sceneInit.mockReset();
    sceneUpdate.mockReset();
    sceneDispose.mockReset();
    sceneOnPointer.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts HIT and calls SceneModule.onPointer on hover enter, not again while still hovering, then on leave", async () => {
    // frame()'s raycast path throttles per-view via performance.now() (see
    // gl/raycast.ts's DEFAULT_RAYCAST_THROTTLE_MS) — three back-to-back
    // synchronous frame() calls would otherwise land within the same
    // throttle window and the "leave" case below could never actually
    // re-cast. `performance.now()` is called twice per frame() (once for
    // `now`, once again for `renderMs`); space successive `now` values 1s
    // apart so every call is well past the throttle.
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1001)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(2001);

    const rendererMock = makeRendererMock();
    const host = new MainThreadHost({ createRenderer: () => rendererMock });
    const onMessage = vi.fn();
    host.onMessage(onMessage);

    // A huge plane dead-center so a pointer NDC of (0,0) always hits it,
    // regardless of the view camera's exact fov math. `camera.updateMatrixWorld()`
    // is what a real `THREE.WebGLRenderer.render(scene, camera)` call does
    // automatically for a parent-less camera (View's camera is never added
    // to its own scene — see gl/view.ts) before any raycast against it would
    // be meaningful; the mocked `RendererLike.render()` below is a no-op, so
    // nothing else would ever call it in this test.
    sceneInit.mockImplementationOnce((ctx: ViewContext) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial());
      ctx.scene.add(mesh);
      ctx.registerInteractive?.([mesh]);
      ctx.camera.updateMatrixWorld();
    });

    const canvas = document.createElement("canvas");
    await host.init(canvas, { dpr: 1, quality: "high", reducedMotion: false });
    host.resize(800, 600, 1);
    host.addView(20, "placeholder", FULL_RECT);
    await vi.waitFor(() => expect(sceneInit).toHaveBeenCalledTimes(1));

    // Centered pointer -> enters hover.
    host.frame(packFrame(0, 0, 20));
    expect(sceneOnPointer).toHaveBeenCalledTimes(1);
    expect(sceneOnPointer.mock.calls[0]![0]).not.toBeNull();
    expect(onMessage).toHaveBeenCalledWith({ type: "HIT", viewId: 20, hit: expect.anything() });

    // Still centered, 1s later (past the throttle window) — still hovering
    // the same target: no re-fire.
    onMessage.mockClear();
    host.frame(packFrame(0, 0, 20));
    expect(sceneOnPointer).toHaveBeenCalledTimes(1);
    expect(onMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "HIT" }));

    // Pointer far outside any real frustum, another 1s later -> leaves.
    host.frame(packFrame(50, 50, 20));
    expect(sceneOnPointer).toHaveBeenCalledTimes(2);
    expect(sceneOnPointer.mock.calls[1]![0]).toBeNull();
    expect(onMessage).toHaveBeenCalledWith({ type: "HIT", viewId: 20, hit: null });

    host.destroy();
  });

  it("design review item A: a real down-edge in FRAME_STATE reaches SceneModule.onPointer through MainThreadHost (not the old hardcoded down:false)", async () => {
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1001);

    const rendererMock = makeRendererMock();
    const host = new MainThreadHost({ createRenderer: () => rendererMock });
    const onMessage = vi.fn();
    host.onMessage(onMessage);

    sceneInit.mockImplementationOnce((ctx: ViewContext) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial());
      ctx.scene.add(mesh);
      ctx.registerInteractive?.([mesh]);
      ctx.camera.updateMatrixWorld();
    });

    const canvas = document.createElement("canvas");
    await host.init(canvas, { dpr: 1, quality: "high", reducedMotion: false });
    host.resize(800, 600, 1);
    host.addView(22, "placeholder", FULL_RECT);
    await vi.waitFor(() => expect(sceneInit).toHaveBeenCalledTimes(1));

    // Enter hover first (down:false) — on the pre-fix code this was the ONLY
    // reachable state (down was always hardcoded false), so onPointer could
    // never observe a down-edge at all.
    host.frame(packFrame(0, 0, 22, { down: false }));
    expect(sceneOnPointer).toHaveBeenCalledTimes(1);

    // Same hover target, now with down:true — a real down-edge while
    // hovering must reach onPointer again (gl/raycast.ts's ViewRaycaster
    // fires on down-edge even with no hover-state change).
    host.frame(packFrame(0, 0, 22, { down: true }));
    expect(sceneOnPointer).toHaveBeenCalledTimes(2);
    expect(sceneOnPointer.mock.calls[1]![0]).not.toBeNull();

    host.destroy();
  });

  it("design review item A: pointerInside:false forces a hover leave through the host even at an NDC that would otherwise hit", async () => {
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1001);

    const rendererMock = makeRendererMock();
    const host = new MainThreadHost({ createRenderer: () => rendererMock });
    const onMessage = vi.fn();
    host.onMessage(onMessage);

    sceneInit.mockImplementationOnce((ctx: ViewContext) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial());
      ctx.scene.add(mesh);
      ctx.registerInteractive?.([mesh]);
      ctx.camera.updateMatrixWorld();
    });

    const canvas = document.createElement("canvas");
    await host.init(canvas, { dpr: 1, quality: "high", reducedMotion: false });
    host.resize(800, 600, 1);
    host.addView(23, "placeholder", FULL_RECT);
    await vi.waitFor(() => expect(sceneInit).toHaveBeenCalledTimes(1));

    host.frame(packFrame(0, 0, 23, { inside: true }));
    expect(sceneOnPointer).toHaveBeenCalledTimes(1);
    expect(sceneOnPointer.mock.calls[0]![0]).not.toBeNull();

    // Same centered NDC, but pointerInside:false (pointer left the viewport
    // entirely) — on the pre-fix code `inside` was hardcoded `true`, so this
    // transition could never be observed; runViewRaycasts gates targets on
    // `pointer.inside` (see gl/raycast.ts), forcing a leave here.
    onMessage.mockClear();
    host.frame(packFrame(0, 0, 23, { inside: false }));
    expect(sceneOnPointer).toHaveBeenCalledTimes(2);
    expect(sceneOnPointer.mock.calls[1]![0]).toBeNull();
    expect(onMessage).toHaveBeenCalledWith({ type: "HIT", viewId: 23, hit: null });

    host.destroy();
  });

  it("design review item A: no spurious enter before any real pointer event — the initial default FRAME_STATE (pointerInside:false) must not hit a dead-center target", async () => {
    const rendererMock = makeRendererMock();
    const host = new MainThreadHost({ createRenderer: () => rendererMock });
    const onMessage = vi.fn();
    host.onMessage(onMessage);

    sceneInit.mockImplementationOnce((ctx: ViewContext) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial());
      ctx.scene.add(mesh);
      ctx.registerInteractive?.([mesh]);
      ctx.camera.updateMatrixWorld();
    });

    const canvas = document.createElement("canvas");
    await host.init(canvas, { dpr: 1, quality: "high", reducedMotion: false });
    host.resize(800, 600, 1);
    host.addView(24, "placeholder", FULL_RECT);
    await vi.waitFor(() => expect(sceneInit).toHaveBeenCalledTimes(1));

    // NDC (0,0) is dead-center of the huge plane — would hit if `inside`
    // were (incorrectly) true, matching core/pointer.ts's PointerTracker,
    // which starts `inside: false` until the first real pointermove/enter.
    host.frame(packFrame(0, 0, 24, { inside: false }));
    expect(sceneOnPointer).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "HIT" }));

    host.destroy();
  });

  it("never raycasts (no HIT, no onPointer) for a scene that never registers interactive objects", async () => {
    const rendererMock = makeRendererMock();
    const host = new MainThreadHost({ createRenderer: () => rendererMock });
    const onMessage = vi.fn();
    host.onMessage(onMessage);

    // sceneInit intentionally does NOT call ctx.registerInteractive.
    const canvas = document.createElement("canvas");
    await host.init(canvas, { dpr: 1, quality: "high", reducedMotion: false });
    host.resize(800, 600, 1);
    host.addView(21, "placeholder", FULL_RECT);
    await vi.waitFor(() => expect(sceneInit).toHaveBeenCalledTimes(1));

    host.frame(packFrame(0, 0, 21));

    expect(sceneOnPointer).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "HIT" }));

    host.destroy();
  });
});
