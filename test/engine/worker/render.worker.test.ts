// test/engine/worker/render.worker.test.ts
//
// Regression coverage for render.worker.ts's INIT handler. Companion to
// host.test.ts's equivalent MainThreadHost regression test — both files had
// the same bug: an AssetManager was constructed and (here) never even had
// its progress listened to, and `.start()` was never called on either side,
// so ASSETS_DONE would never reach the main thread and EngineProvider's
// status would be stuck at "loading" forever (even with zero registered
// asset jobs, the current M1-checkpoint state).
//
// gl/renderer.ts's real `createRenderer` builds a real THREE.WebGLRenderer
// (untestable in jsdom — no WebGL context), so it's the only mocked
// dependency; gl/stage.ts's real `Stage` only needs a `RendererLike` (see
// worker/host.test.ts for the identical pattern against MainThreadHost) so
// it's exercised for real here too.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { RectData, RendererLike, ViewContext } from "@/lib/engine/types";
import { createRenderer } from "@/lib/engine/gl/renderer";
import { packFrameState } from "@/lib/engine/worker/protocol";

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

const rendererMock = makeRendererMock();

vi.mock("@/lib/engine/gl/renderer", () => ({
  createRenderer: vi.fn(() => rendererMock),
  setSize: vi.fn(),
}));

// scene-registry.ts's "placeholder" loader does
// `import("@/lib/scenes/placeholder/scene").then((m) => m.default())` — mock
// the module it imports so SCENE_INVOKE routing can be observed directly
// (mirrors test/engine/worker/host.test.ts's identical pattern for
// MainThreadHost).
const { sceneInit, sceneUpdate, sceneDispose, sceneInvoke, sceneOnPointer } = vi.hoisted(() => ({
  sceneInit: vi.fn(),
  sceneUpdate: vi.fn(),
  sceneDispose: vi.fn(),
  sceneInvoke: vi.fn(),
  // SceneModule.onPointer is optional — a spy so the raycast/HIT wiring
  // suite below can assert it was actually driven, without every other
  // test in this file needing to care.
  sceneOnPointer: vi.fn(),
}));

vi.mock("@/lib/scenes/placeholder/scene", () => ({
  default: () => ({
    init: sceneInit,
    update: sceneUpdate,
    dispose: sceneDispose,
    invoke: sceneInvoke,
    onPointer: sceneOnPointer,
  }),
}));

// Imported after the mocks are registered (vi.mock is hoisted by Vitest, but
// this documents intent). Importing this module has the side effect of
// installing `self.onmessage` — that's the worker's real entry point.
await import("@/lib/engine/worker/render.worker");

function fakeOffscreenCanvas(): OffscreenCanvas {
  return {
    width: 300,
    height: 300,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as OffscreenCanvas;
}

describe("render.worker.ts — INIT handler asset wiring", () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMessageSpy = vi.fn();
    (globalThis as unknown as { postMessage: typeof postMessageSpy }).postMessage = postMessageSpy;
  });

  it("BUG B1 regression: renderer construction failure posts INIT_FAILED instead of hanging forever (no READY, no throw)", () => {
    // On the old code, a throw from createRenderer() (e.g. real WebGL2
    // context creation failing in a headless/SwiftShader environment) was
    // uncaught inside this onmessage handler: nothing was posted back, so
    // WorkerHost.init()'s `ready` promise (awaiting a "READY" message) hung
    // forever and EngineProvider stayed stuck at status "loading" 0% with
    // the LoadingScreen covering the page permanently. This assertion fails
    // on the pre-fix code (the throw escapes onmessage uncaught instead of
    // being turned into a message).
    vi.mocked(createRenderer).mockImplementationOnce(() => {
      throw new Error("WebGL2 context creation failed");
    });

    const onmessage = (globalThis as unknown as { onmessage: (ev: MessageEvent) => void }).onmessage;

    expect(() =>
      onmessage({
        data: { type: "INIT", canvas: fakeOffscreenCanvas(), dpr: 1, quality: "high", reducedMotion: false },
      } as MessageEvent)
    ).not.toThrow();

    expect(postMessageSpy).toHaveBeenCalledWith({
      type: "INIT_FAILED",
      error: "WebGL2 context creation failed",
    });
    expect(postMessageSpy).not.toHaveBeenCalledWith({ type: "READY" });

    // No RAF loop was started (handleInit returned before startTicking()),
    // so there is nothing to tear down here.
  });

  it("regression: INIT with zero registered assets still posts ASSETS_DONE (LoadingScreen must resolve)", () => {
    // On the old code, handleInit() never called `assets.start()` (and never
    // subscribed to `assets.onProgress()` at all) — ASSETS_DONE was never
    // posted, so this assertion fails on the pre-fix code.
    const onmessage = (globalThis as unknown as { onmessage: (ev: MessageEvent) => void }).onmessage;
    expect(onmessage).toBeTypeOf("function");

    onmessage({
      data: { type: "INIT", canvas: fakeOffscreenCanvas(), dpr: 1, quality: "high", reducedMotion: false },
    } as MessageEvent);

    expect(postMessageSpy).toHaveBeenCalledWith({ type: "READY" });
    expect(postMessageSpy).toHaveBeenCalledWith({ type: "ASSET_PROGRESS", p: 1, id: "" });
    expect(postMessageSpy).toHaveBeenCalledWith({ type: "ASSETS_DONE" });

    // Tear down so the RAF loop started by handleInit() doesn't leak past
    // this test.
    onmessage({ data: { type: "DISPOSE" } } as MessageEvent);
  });
});

describe("render.worker.ts — SCENE_INVOKE routing", () => {
  beforeEach(() => {
    (globalThis as unknown as { postMessage: typeof vi.fn }).postMessage = vi.fn();
    sceneInvoke.mockClear();
  });

  it("regression: SCENE_INVOKE reaches the target view's SceneModule.invoke instead of being dropped", async () => {
    // On the old code, the SCENE_INVOKE case only logged a console.warn and
    // never called into any SceneModule — the picker scene's carousel
    // "select" RPC (invoked via useEngine().invoke -> WorkerHost.invoke ->
    // this SCENE_INVOKE message) silently did nothing whenever the worker
    // render path was in use. This assertion fails on the pre-fix code.
    const onmessage = (globalThis as unknown as { onmessage: (ev: MessageEvent) => void }).onmessage;

    onmessage({
      data: { type: "INIT", canvas: fakeOffscreenCanvas(), dpr: 1, quality: "high", reducedMotion: false },
    } as MessageEvent);

    const rect: RectData = { top: 0, left: 0, width: 300, height: 300 };
    onmessage({ data: { type: "VIEW_ADD", viewId: 7, sceneId: "placeholder", rect } } as MessageEvent);

    // loadScene()'s dynamic import + .then() chain resolves asynchronously —
    // flush it before SCENE_INVOKE is expected to have a module to route to.
    await new Promise((resolve) => setTimeout(resolve, 0));

    onmessage({ data: { type: "SCENE_INVOKE", viewId: 7, method: "select", args: [2] } } as MessageEvent);

    expect(sceneInvoke).toHaveBeenCalledWith("select", [2]);

    // A SCENE_INVOKE for an unknown/removed view must not throw.
    expect(() =>
      onmessage({ data: { type: "SCENE_INVOKE", viewId: 999, method: "select", args: [0] } } as MessageEvent)
    ).not.toThrow();

    onmessage({ data: { type: "VIEW_REMOVE", viewId: 7 } } as MessageEvent);
    onmessage({ data: { type: "SCENE_INVOKE", viewId: 7, method: "select", args: [3] } } as MessageEvent);
    expect(sceneInvoke).toHaveBeenCalledTimes(1);

    onmessage({ data: { type: "DISPOSE" } } as MessageEvent);
  });
});

describe("render.worker.ts — VIEW_REMOVE vs async loadScene race (design review item B)", () => {
  beforeEach(() => {
    (globalThis as unknown as { postMessage: typeof vi.fn }).postMessage = vi.fn();
    sceneInit.mockClear();
    sceneDispose.mockClear();
  });

  it("remove-before-load-resolves disposes the orphaned module instead of resurrecting the view, and a re-add of the same viewId works without an 'already exists' throw", async () => {
    const onmessage = (globalThis as unknown as { onmessage: (ev: MessageEvent) => void }).onmessage;
    const rect: RectData = { top: 0, left: 0, width: 300, height: 300 };

    onmessage({
      data: { type: "INIT", canvas: fakeOffscreenCanvas(), dpr: 1, quality: "high", reducedMotion: false },
    } as MessageEvent);

    // VIEW_ADD kicks off loadScene()'s real dynamic import (a pending
    // microtask); VIEW_REMOVE for the SAME viewId lands synchronously right
    // after, before that promise has any chance to resolve. On the pre-fix
    // code, the eventual `.then()` callback would still register the
    // now-removed view with Stage/moduleByView (a "zombie" view).
    onmessage({ data: { type: "VIEW_ADD", viewId: 50, sceneId: "placeholder", rect } } as MessageEvent);
    onmessage({ data: { type: "VIEW_REMOVE", viewId: 50 } } as MessageEvent);

    // Flush the pending loadScene() resolution.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The orphaned module's own dispose() ran, but it was never handed to
    // Stage — its init() (called only by Stage.addView) never ran.
    expect(sceneDispose).toHaveBeenCalledTimes(1);
    expect(sceneInit).not.toHaveBeenCalled();

    // Re-adding the same viewId afterward must not throw "already exists"
    // (Stage never actually held view 50) and must load/init cleanly.
    sceneDispose.mockClear();
    expect(() =>
      onmessage({ data: { type: "VIEW_ADD", viewId: 50, sceneId: "placeholder", rect } } as MessageEvent)
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sceneInit).toHaveBeenCalledTimes(1);
    expect(sceneDispose).not.toHaveBeenCalled();

    onmessage({ data: { type: "DISPOSE" } } as MessageEvent);
  });
});

// ---------------------------------------------------------------------------
// Worker-side raycasting (design doc §4A): the RAF `tick()` loop runs
// gl/raycast.ts's shared `runViewRaycasts()` (the SAME function
// worker/host.ts's MainThreadHost calls — see host.test.ts's identical
// suite) and posts HIT on every enter/leave transition. `tick` itself isn't
// exported, so the RAF loop is driven manually here: `requestAnimationFrame`
// is stubbed to capture the callback the worker schedules, then invoked
// directly with controlled timestamps (the raycaster's throttle seam) —
// this is the "mock raycaster seam" this suite exercises against.
// ---------------------------------------------------------------------------

describe("render.worker.ts — raycast/HIT wiring (design doc §4A)", () => {
  let rafCallback: ((t: number) => void) | null = null;
  const RECT: RectData = { top: 0, left: 0, width: 300, height: 300 };

  function frameState(
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
      [{ viewId, ...RECT, progress: 0.5 }]
    );
  }

  beforeEach(() => {
    rafCallback = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: (t: number) => void) => {
        rafCallback = cb;
        return 1;
      })
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    sceneInit.mockReset();
    sceneUpdate.mockReset();
    sceneDispose.mockReset();
    sceneOnPointer.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts HIT on enter/leave and calls SceneModule.onPointer locally, without HIT spam while hovering the same target", async () => {
    // A huge plane dead-center so a pointer NDC of (0,0) always hits it.
    // `camera.updateMatrixWorld()` is what a real `THREE.WebGLRenderer.
    // render(scene, camera)` call does automatically for a parent-less
    // camera (View's camera is never added to its own scene — see
    // gl/view.ts) before any raycast against it would be meaningful; the
    // renderer here is a `RendererLike` mock (no real WebGL), so nothing
    // else would ever call it in this test.
    sceneInit.mockImplementationOnce((ctx: ViewContext) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial());
      ctx.scene.add(mesh);
      ctx.registerInteractive?.([mesh]);
      ctx.camera.updateMatrixWorld();
    });

    const postMessageSpy = vi.fn();
    (globalThis as unknown as { postMessage: typeof postMessageSpy }).postMessage = postMessageSpy;
    const onmessage = (globalThis as unknown as { onmessage: (ev: MessageEvent) => void }).onmessage;

    onmessage({
      data: { type: "INIT", canvas: fakeOffscreenCanvas(), dpr: 1, quality: "high", reducedMotion: false },
    } as MessageEvent);
    onmessage({ data: { type: "VIEW_ADD", viewId: 30, sceneId: "placeholder", rect: RECT } } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 0)); // flush loadScene()'s dynamic import

    expect(rafCallback).toBeTypeOf("function");
    function hitMessages(): Array<{ viewId: number; hit: unknown }> {
      return postMessageSpy.mock.calls
        .map((c) => c[0] as { type: string; viewId: number; hit: unknown })
        .filter((m) => m.type === "HIT");
    }

    // Centered pointer -> enters hover on the first tick.
    onmessage({ data: { type: "FRAME_STATE", state: frameState(0, 0, 30) } } as MessageEvent);
    rafCallback!(0);
    expect(hitMessages()).toHaveLength(1);
    expect(hitMessages()[0]!.hit).not.toBeNull();
    expect(sceneOnPointer).toHaveBeenCalledTimes(1);
    expect(sceneOnPointer.mock.calls[0]![0]).not.toBeNull();

    // Still centered, 1s later (past the raycast throttle window) — no HIT spam.
    onmessage({ data: { type: "FRAME_STATE", state: frameState(0, 0, 30) } } as MessageEvent);
    rafCallback!(1000);
    expect(hitMessages()).toHaveLength(1);
    expect(sceneOnPointer).toHaveBeenCalledTimes(1);

    // Pointer far outside any real frustum, another 1s later -> leaves.
    onmessage({ data: { type: "FRAME_STATE", state: frameState(50, 50, 30) } } as MessageEvent);
    rafCallback!(2000);
    expect(hitMessages()).toHaveLength(2);
    expect(hitMessages()[1]!.hit).toBeNull();
    expect(sceneOnPointer).toHaveBeenCalledTimes(2);
    expect(sceneOnPointer.mock.calls[1]![0]).toBeNull();

    onmessage({ data: { type: "DISPOSE" } } as MessageEvent);
  });

  it("never raycasts (no HIT, no onPointer) for a scene that never registers interactive objects", async () => {
    // sceneInit intentionally does NOT call ctx.registerInteractive — the
    // default hoisted mock is a bare vi.fn() with no implementation.
    const postMessageSpy = vi.fn();
    (globalThis as unknown as { postMessage: typeof postMessageSpy }).postMessage = postMessageSpy;
    const onmessage = (globalThis as unknown as { onmessage: (ev: MessageEvent) => void }).onmessage;

    onmessage({
      data: { type: "INIT", canvas: fakeOffscreenCanvas(), dpr: 1, quality: "high", reducedMotion: false },
    } as MessageEvent);
    onmessage({ data: { type: "VIEW_ADD", viewId: 31, sceneId: "placeholder", rect: RECT } } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    onmessage({ data: { type: "FRAME_STATE", state: frameState(0, 0, 31) } } as MessageEvent);
    rafCallback!(0);

    expect(sceneOnPointer).not.toHaveBeenCalled();
    expect(postMessageSpy.mock.calls.some((c) => (c[0] as { type: string }).type === "HIT")).toBe(false);

    onmessage({ data: { type: "DISPOSE" } } as MessageEvent);
  });
});

// ---------------------------------------------------------------------------
// RESIZE must retain the last-known scroll/pointer state (design review item
// F4/F5). render.worker.ts's own RAF `tick()` loop calls `stage.render()`
// every frame regardless of whether a fresh FRAME_STATE arrived that tick —
// so unlike host.ts's MainThreadHost (which only ever renders from inside
// `frame()`, always re-supplying real scroll first), a RESIZE-triggered
// scroll reset here is directly visible on the very next independent RAF
// tick, with no new FRAME_STATE in between. This suite drives that exact
// sequence and uses in-view culling (Stage skips off-screen views entirely)
// as the observable signal: a view whose rect only lands in-view at a
// specific scrollY will stop rendering if that scrollY gets silently reset.
// ---------------------------------------------------------------------------

describe("render.worker.ts — RESIZE retains scroll state across ticks (design review item F4/F5)", () => {
  let rafCallback: ((t: number) => void) | null = null;
  // Document-space rect starting at y=1000 — only "in view" once scrolled
  // down by roughly that much (see the scroll math in each assertion below).
  const RECT: RectData = { top: 1000, left: 0, width: 300, height: 300 };

  function frameStateAt(scrollCurrent: number, viewId: number): Float32Array {
    return packFrameState(
      {
        scrollCurrent,
        scrollVelocity: 0,
        scrollProgress: 0.5,
        pointerX: 0,
        pointerY: 0,
        pointerVX: 0,
        pointerVY: 0,
        pointerDown: false,
        pointerInside: true,
      },
      [{ viewId, ...RECT, progress: 0.5 }]
    );
  }

  beforeEach(() => {
    rafCallback = null;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: (t: number) => void) => {
        rafCallback = cb;
        return 1;
      })
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    sceneInit.mockReset();
    sceneUpdate.mockReset();
    sceneDispose.mockReset();
    vi.mocked(rendererMock.render).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a RESIZE with no new FRAME_STATE in between does not reset scroll back to 0 (view stays in view)", async () => {
    const postMessageSpy = vi.fn();
    (globalThis as unknown as { postMessage: typeof postMessageSpy }).postMessage = postMessageSpy;
    const onmessage = (globalThis as unknown as { onmessage: (ev: MessageEvent) => void }).onmessage;

    onmessage({
      data: { type: "INIT", canvas: fakeOffscreenCanvas(), dpr: 1, quality: "high", reducedMotion: false },
    } as MessageEvent);
    onmessage({ data: { type: "RESIZE", width: 300, height: 300, dpr: 1 } } as MessageEvent);
    onmessage({ data: { type: "VIEW_ADD", viewId: 80, sceneId: "placeholder", rect: RECT } } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 0)); // flush loadScene()'s dynamic import

    // scrollCurrent=800 puts RECT's viewport-relative top at 1000-800=200,
    // inside the [0,300] viewport — in view.
    onmessage({ data: { type: "FRAME_STATE", state: frameStateAt(800, 80) } } as MessageEvent);
    rafCallback!(0);
    expect(rendererMock.render).toHaveBeenCalledTimes(1); // sanity: in view, rendered

    // A RESIZE arrives with NO new FRAME_STATE — on the pre-fix code,
    // handleResize() called currentFrameInput() with no args, which
    // defaulted scroll back to DEFAULT_SCROLL (current: 0), pushing RECT's
    // viewport-relative top back to 1000 — well outside the viewport — so
    // the very next independent RAF tick would stop rendering it entirely.
    onmessage({ data: { type: "RESIZE", width: 320, height: 300, dpr: 1 } } as MessageEvent);
    rafCallback!(16);

    expect(rendererMock.render).toHaveBeenCalledTimes(2); // still in view — scroll was retained

    onmessage({ data: { type: "DISPOSE" } } as MessageEvent);
  });
});
