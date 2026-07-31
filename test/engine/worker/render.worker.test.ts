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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RectData, RendererLike } from "@/lib/engine/types";

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
const { sceneInit, sceneUpdate, sceneDispose, sceneInvoke } = vi.hoisted(() => ({
  sceneInit: vi.fn(),
  sceneUpdate: vi.fn(),
  sceneDispose: vi.fn(),
  sceneInvoke: vi.fn(),
}));

vi.mock("@/lib/scenes/placeholder/scene", () => ({
  default: () => ({
    init: sceneInit,
    update: sceneUpdate,
    dispose: sceneDispose,
    invoke: sceneInvoke,
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
