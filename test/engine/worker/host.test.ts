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
import type { RectData, RendererLike } from "@/lib/engine/types";
import { packFrameState, SCALAR_SLOT_COUNT, type FrameStateView } from "@/lib/engine/worker/protocol";

const { sceneInit, sceneUpdate, sceneDispose, sceneResize, sceneOnProgress, sceneGetStats } = vi.hoisted(() => ({
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
  }),
}));

// Imported after the mock is registered (vi.mock calls are hoisted above
// imports by Vitest, so this ordering in source doesn't matter, but it
// documents intent).
const { createRenderHost, MainThreadHost, WorkerHost, supportsOffscreenWorkerRendering } = await import(
  "@/lib/engine/worker/host"
);

function makeFrameState(views: FrameStateView[]): Float32Array {
  return packFrameState(
    { scrollCurrent: 0, scrollVelocity: 0, scrollProgress: 0, pointerX: 0, pointerY: 0, pointerVX: 0, pointerVY: 0 },
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
