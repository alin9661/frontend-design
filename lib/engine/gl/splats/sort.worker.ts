// lib/engine/gl/splats/sort.worker.ts
//
// Dedicated depth-sort worker for SplatMesh (design doc §4B). Splats must be
// drawn back-to-front for correct alpha blending, and re-sorting ~100k
// indices by camera-relative depth every frame is exactly the kind of work
// that should happen off the render thread.
//
// BUG B2 root cause (fixed here): the pure `sortIndices`/`computeViewDepths`
// functions used to live in THIS file, and SplatMesh.ts imported them from
// here (`import { sortIndices } from "./sort.worker"`) as its no-Worker
// fallback. That's fine on the main thread or in tests — but scene modules
// are also lazy-loaded INSIDE worker/render.worker.ts's own OffscreenCanvas
// worker (splat-lounge's scene.ts -> SplatMesh.ts -> this file, all
// dynamically imported by scene-registry.ts's loadScene()). `self` there IS
// a real worker global scope, so this file's `typeof WorkerGlobalScope !==
// "undefined"` guard was ALSO true — evaluating this module inside
// render.worker.ts's bundle silently overwrote render.worker.ts's own
// `ctx.onmessage` (installed at its own module top level, long before any
// scene lazy-loads) with the dedicated-sort-worker handler below. From that
// moment on every real message to the render worker (FRAME_STATE, sent every
// tick regardless of scroll position) fell through this handler's "not
// INIT/SORT" path and hit the `storedPositions` guard, logging "SORT
// received before INIT — dropping request" every frame — even with the
// splats section scrolled off-screen, because FRAME_STATE never stops.
//
// Fix: the pure math now lives in ./sort-core.ts (zero side effects, safe to
// import from anywhere). SplatMesh.ts imports `sortIndices` from there
// instead of from this file, so this file — the one with the
// worker-bootstrap side effect — is now ONLY ever evaluated as the dedicated
// sort worker's own entry script (via `new Worker(new URL("./sort.worker.ts",
// import.meta.url))`), never as a transitive import inside another worker's
// bundle. `sortIndices`/`computeViewDepths` are re-exported below purely so
// existing imports of `"./sort.worker"` (e.g. this file's own tests) keep
// working unchanged.
//
// Mirrors worker/render.worker.ts's `WorkerScope` cast pattern (this
// project's convention for typing a dedicated-worker global without
// conflicting with the "dom" lib's `self`/`postMessage` declarations).

import * as THREE from "three";
import { computeViewDepths, sortIndices } from "./sort-core";

export { computeViewDepths, sortIndices };

// ---------------------------------------------------------------------------
// Dedicated-worker message protocol (internal to gl/splats/ — this is not
// part of worker/protocol.ts's main<->render-worker union; SplatMesh talks
// to this worker directly and never touches render.worker.ts).
//
// `positions` is transferred to the worker exactly ONCE at INIT and stays
// there for the worker's lifetime (SplatData is immutable after
// construction, so the worker's copy never goes stale). Every subsequent
// SORT only has to cross the small 16-float view matrix; SORTED transfers
// back a Uint32Array index buffer that the main thread is expected to send
// back as `previousIndices` on its NEXT request — true two-buffer ping-pong,
// zero steady-state allocation on either side of the boundary.
// ---------------------------------------------------------------------------

export interface SortInitMessage {
  type: "INIT";
  positions: Float32Array; // transferable — worker keeps this, never returns it
}

export interface SortRequest {
  type: "SORT";
  requestId: number;
  /** `camera.matrixWorldInverse.elements` (or equivalent) — a plain 16-number array survives structured clone; THREE.Matrix4 instances don't keep their prototype/methods across postMessage. */
  viewMatrixElements: Float32Array;
  /** The previous SORTED response's buffer, transferred back for reuse as scratch (ping-pong). Omitted on the first request. */
  previousIndices?: Uint32Array;
}

export type SortWorkerRequest = SortInitMessage | SortRequest;

export interface SortResponse {
  type: "SORTED";
  requestId: number;
  indices: Uint32Array; // transferable
  sortMs: number;
}

interface SortWorkerScope {
  postMessage(message: SortResponse, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<SortWorkerRequest>) => void) | null;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// Only wire up the dedicated-worker entry point when this module is actually
// evaluated inside a worker context. `self` exists in jsdom too (aliasing
// `window`), so guard on `WorkerGlobalScope` — undefined on the main thread —
// rather than unconditionally installing `onmessage`, which would otherwise
// shadow the page/test's own `window.onmessage` when this file is merely
// imported for its pure `sortIndices` export (as tests do).
declare const WorkerGlobalScope: unknown;

if (typeof WorkerGlobalScope !== "undefined") {
  const ctx = self as unknown as SortWorkerScope;
  let storedPositions: Float32Array | null = null;
  // BUG B2 handshake hardening: INIT is always posted synchronously right
  // after this worker is constructed (SplatMesh.ts's initSortWorker()), and
  // postMessage delivery to the same worker preserves order, so a genuine
  // SORT-before-INIT race shouldn't happen in practice — the flood this
  // guarded against was actually the cross-import hijack fixed above. Still,
  // rather than silently dropping (and noisily console.error-ing) a request
  // that arrives before INIT for any other reason, keep only the latest one
  // (matches render.worker.ts's "only the newest FRAME_STATE" convention)
  // and run it as soon as INIT lands instead of losing the re-sort.
  let pendingRequest: SortRequest | null = null;

  function runSort(msg: SortRequest, positions: Float32Array): void {
    const start = now();
    const viewMatrix = new THREE.Matrix4().fromArray(msg.viewMatrixElements);
    const indices = sortIndices(positions, viewMatrix, msg.previousIndices);
    const sortMs = now() - start;
    ctx.postMessage({ type: "SORTED", requestId: msg.requestId, indices, sortMs }, [indices.buffer]);
  }

  ctx.onmessage = (ev: MessageEvent<SortWorkerRequest>) => {
    const msg = ev.data;
    if (msg.type === "INIT") {
      storedPositions = msg.positions;
      if (pendingRequest) {
        const queued = pendingRequest;
        pendingRequest = null;
        runSort(queued, storedPositions);
      }
      return;
    }

    if (!storedPositions) {
      pendingRequest = msg;
      return;
    }

    runSort(msg, storedPositions);
  };
}
