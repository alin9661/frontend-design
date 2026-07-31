// lib/engine/gl/splats/sort.worker.ts
//
// Dedicated depth-sort worker for SplatMesh (design doc §4B). Splats must be
// drawn back-to-front for correct alpha blending, and re-sorting ~100k
// indices by camera-relative depth every frame is exactly the kind of work
// that should happen off the render thread. Two things live in this one
// file, deliberately:
//
// - `sortIndices(positions, viewMatrix)` — a PURE, synchronous function
//   (design doc: "ALSO export the pure sortIndices... fallback used
//   synchronously when Worker is unavailable and by tests"). A 16-bit
//   quantized counting sort: O(n), stable-ish, and cheap enough to run
//   synchronously as SplatMesh's no-Worker-support fallback.
// - The dedicated-worker wiring (`self.onmessage`) that calls the exact same
//   `sortIndices` function, so the worker and synchronous-fallback code
//   paths can never disagree on results — only on which thread runs them.
//   Mirrors worker/render.worker.ts's `WorkerScope` cast pattern (this
//   project's convention for typing a dedicated-worker global without
//   conflicting with the "dom" lib's `self`/`postMessage` declarations).
//
// SplatMesh.ts creates this worker via
// `new Worker(new URL("./sort.worker.ts", import.meta.url))` (static
// specifier required for Next/webpack worker bundling, same as
// worker/host.ts's `render.worker.ts` construction) and falls back to
// calling `sortIndices` synchronously when `typeof Worker === "undefined"`.

import * as THREE from "three";

/** 16-bit quantization buckets — enough resolution that ties are visually irrelevant. */
const QUANT_BITS = 16;
const QUANT_LEVELS = 1 << QUANT_BITS; // 65536

/**
 * View-space depth (more negative = farther from camera, matching three.js's
 * -Z-forward camera convention) for every splat position, via `viewMatrix`
 * (typically `camera.matrixWorldInverse`, already up to date when the
 * caller calls `camera.updateMatrixWorld()` first).
 */
export function computeViewDepths(
  positions: Float32Array,
  viewMatrix: THREE.Matrix4,
  count: number = positions.length / 3
): Float32Array {
  const e = viewMatrix.elements; // column-major: row 2 (z row) is e[2], e[6], e[10], e[14]
  const depths = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3 + 0]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    depths[i] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
  }
  return depths;
}

/**
 * Back-to-front (far-first) index order for `positions` as seen from
 * `viewMatrix`, via a 16-bit quantized counting sort over view-space depth.
 * O(n): one pass to find the depth range, one to bucket, one prefix sum, one
 * scatter — no comparison sort, no allocation proportional to n*log(n).
 *
 * Ties within the same quantization bucket keep their original relative
 * order (the scatter pass processes indices 0..count-1 in order and appends
 * within each bucket's slot range), so results are deterministic and stable.
 *
 * `out`, when provided with the right length, is written into and returned
 * instead of allocating a new Uint32Array — this is the "ping-pong" buffer
 * reuse the design doc calls for: the dedicated worker and SplatMesh trade
 * ownership of two index buffers back and forth via transfer instead of
 * allocating a fresh result every sort.
 */
export function sortIndices(positions: Float32Array, viewMatrix: THREE.Matrix4, out?: Uint32Array): Uint32Array {
  const count = positions.length / 3;
  const result = out && out.length === count ? out : new Uint32Array(count);
  if (count === 0) return result;

  const depths = computeViewDepths(positions, viewMatrix, count);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < count; i++) {
    const d = depths[i]!;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  const range = max - min || 1e-6;

  const buckets = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    const t = (depths[i]! - min) / range; // 0 = farthest, 1 = nearest
    buckets[i] = Math.min(QUANT_LEVELS - 1, Math.max(0, Math.round(t * (QUANT_LEVELS - 1))));
  }

  const counts = new Uint32Array(QUANT_LEVELS);
  for (let i = 0; i < count; i++) counts[buckets[i]!]!++;

  const offsets = new Uint32Array(QUANT_LEVELS);
  let sum = 0;
  for (let b = 0; b < QUANT_LEVELS; b++) {
    offsets[b] = sum;
    sum += counts[b]!;
  }

  const cursor = offsets.slice();
  for (let i = 0; i < count; i++) {
    const b = buckets[i]!;
    result[cursor[b]!++] = i;
  }

  return result;
}

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

  ctx.onmessage = (ev: MessageEvent<SortWorkerRequest>) => {
    const msg = ev.data;
    if (msg.type === "INIT") {
      storedPositions = msg.positions;
      return;
    }

    if (!storedPositions) {
      console.error("[deep-wave splat sort worker] SORT received before INIT — dropping request");
      return;
    }

    const start = now();
    const viewMatrix = new THREE.Matrix4().fromArray(msg.viewMatrixElements);
    const indices = sortIndices(storedPositions, viewMatrix, msg.previousIndices);
    const sortMs = now() - start;
    ctx.postMessage({ type: "SORTED", requestId: msg.requestId, indices, sortMs }, [indices.buffer]);
  };
}
