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
import type { RendererLike } from "@/lib/engine/types";

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

// Imported after the mock is registered (vi.mock is hoisted by Vitest, but
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
