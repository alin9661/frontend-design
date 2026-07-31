// test/engine/splats/sort-worker-handshake.test.ts
//
// BUG B2 regression coverage: the console flood of "[deep-wave splat sort
// worker] SORT received before INIT — dropping request" on every frame, even
// with the splats section scrolled off-screen.
//
// Root cause: gl/splats/sort.worker.ts used to hold BOTH the pure sort math
// AND a module-scope side effect (`self.onmessage = ...`) guarded only by
// `typeof WorkerGlobalScope !== "undefined"`. SplatMesh.ts imported the pure
// `sortIndices` function from that same file — and SplatMesh.ts is
// lazy-loaded (via splat-lounge/scene.ts -> scene-registry.ts's loadScene())
// INSIDE worker/render.worker.ts's own OffscreenCanvas worker, where `self`
// IS a real worker global scope. Evaluating sort.worker.ts there silently
// replaced render.worker.ts's own `ctx.onmessage` with the sort-worker's
// handler, so every subsequent real message (FRAME_STATE, sent every tick
// regardless of scroll position) fell into this handler's "not INIT/SORT"
// path and logged the drop error — forever, even off-screen.
//
// Two independent fixes, two independent tests below:
//  1. The pure math now lives in sort-core.ts; SplatMesh.ts imports from
//     there instead of sort.worker.ts, so evaluating SplatMesh.ts's module
//     graph inside another worker's bundle no longer touches
//     sort.worker.ts's onmessage side effect at all.
//  2. Defense in depth: even if a SORT genuinely arrives before INIT (the
//     hypothesis the original bug report assumed), the dedicated worker now
//     queues it and runs it once INIT lands, instead of dropping it and
//     logging an error.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("BUG B2 regression — sort.worker.ts's onmessage side effect", () => {
  const originalOnmessage = (globalThis as { onmessage?: unknown }).onmessage;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (globalThis as { onmessage?: unknown }).onmessage = originalOnmessage;
  });

  it("importing SplatMesh.ts (as splat-lounge/scene.ts does) does NOT install sort.worker.ts's onmessage handler, even inside a real worker global scope", async () => {
    // Simulate being inside a real Worker (e.g. worker/render.worker.ts's
    // OffscreenCanvas worker), where `WorkerGlobalScope` genuinely exists.
    vi.stubGlobal("WorkerGlobalScope", function WorkerGlobalScope() {});

    const sentinel = () => {};
    (globalThis as { onmessage?: unknown }).onmessage = sentinel;

    // On the pre-fix code (SplatMesh.ts importing from "./sort.worker"),
    // this import would overwrite `globalThis.onmessage` as a side effect.
    await import("@/lib/engine/gl/splats/SplatMesh");

    expect((globalThis as { onmessage?: unknown }).onmessage).toBe(sentinel);
  });

  it("directly importing sort.worker.ts inside a real worker global scope DOES install its onmessage handler (it's the actual dedicated-worker entry — this is correct, expected behavior)", async () => {
    vi.stubGlobal("WorkerGlobalScope", function WorkerGlobalScope() {});
    (globalThis as { onmessage?: unknown }).onmessage = undefined;

    await import("@/lib/engine/gl/splats/sort.worker");

    expect(typeof (globalThis as { onmessage?: unknown }).onmessage).toBe("function");
  });

  it("outside a worker global scope (plain import, e.g. from SplatMesh.ts's own tests), sort.worker.ts installs nothing — WorkerGlobalScope is genuinely undefined here", async () => {
    (globalThis as { onmessage?: unknown }).onmessage = undefined;
    await import("@/lib/engine/gl/splats/sort.worker");
    expect((globalThis as { onmessage?: unknown }).onmessage).toBeUndefined();
  });
});

describe("BUG B2 regression — SORT-before-INIT handshake hardening", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queues a SORT that arrives before INIT and runs it once INIT lands, instead of dropping it with an error log", async () => {
    vi.stubGlobal("WorkerGlobalScope", function WorkerGlobalScope() {});
    const posted: unknown[] = [];
    (globalThis as { postMessage?: unknown }).postMessage = (msg: unknown) => posted.push(msg);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("@/lib/engine/gl/splats/sort.worker");
    const onmessage = (globalThis as { onmessage?: (ev: MessageEvent) => void }).onmessage!;

    const positions = new Float32Array([0, 0, -1, 0, 0, -5, 0, 0, 3]);
    const viewMatrixElements = new Float32Array(16);
    viewMatrixElements.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    // SORT arrives first — before this worker's own INIT.
    onmessage({ data: { type: "SORT", requestId: 1, viewMatrixElements } } as MessageEvent);
    expect(posted).toHaveLength(0); // nothing posted yet — queued, not dropped
    expect(errorSpy).not.toHaveBeenCalled(); // and no console flood either

    // INIT arrives — the queued SORT must now run.
    onmessage({ data: { type: "INIT", positions } } as MessageEvent);

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: "SORTED", requestId: 1 });

    errorSpy.mockRestore();
  });

  it("still answers a SORT sent after INIT immediately (happy path unaffected)", async () => {
    vi.stubGlobal("WorkerGlobalScope", function WorkerGlobalScope() {});
    const posted: unknown[] = [];
    (globalThis as { postMessage?: unknown }).postMessage = (msg: unknown) => posted.push(msg);

    await import("@/lib/engine/gl/splats/sort.worker");
    const onmessage = (globalThis as { onmessage?: (ev: MessageEvent) => void }).onmessage!;

    const positions = new Float32Array([0, 0, -1, 0, 0, -5, 0, 0, 3]);
    const viewMatrixElements = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    onmessage({ data: { type: "INIT", positions } } as MessageEvent);
    onmessage({ data: { type: "SORT", requestId: 2, viewMatrixElements } } as MessageEvent);

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: "SORTED", requestId: 2 });
  });
});
