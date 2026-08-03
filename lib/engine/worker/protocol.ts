// lib/engine/worker/protocol.ts
//
// Typed message-type constants for the main<->worker discriminated unions
// (see lib/engine/types.ts MainToWorker / WorkerToMain), plus the PURE
// packFrameState/unpackFrameState pair that (de)serializes per-frame state
// into a single transferable Float32Array.
//
// Float32Array layout (design doc §4A; slot 7 `pointerFlags` is an additive,
// post-M0-freeze evolution — see this file's header note below):
//   [0] scrollCurrent
//   [1] scrollVelocity
//   [2] scrollProgress
//   [3] pointerX
//   [4] pointerY
//   [5] pointerVX
//   [6] pointerVY
//   [7] pointerFlags (bit0 = down, bit1 = inside)
//   then 6 floats per view: [viewId, top, left, width, height, progress]
//
// `pointerFlags` (additive, post-M0): both RenderHost implementations used to
// hardcode `down: false, inside: true` instead of threading the real
// PointerTracker state through FRAME_STATE, which made pointer interactivity
// unreachable end-to-end (no real down-edge could ever reach a scene's
// `onPointer`, and a pointer that had actually left the viewport still read
// as "inside" — see gl/raycast.ts's `runViewRaycasts`, which gates raycast
// targets on `pointer.inside`). Packing both booleans into one bit-packed
// scalar (rather than two more float slots) keeps the transferable buffer
// small while still fitting cleanly into the existing scalar-slot layout.

import type { RectData } from "../types";

export const SCALAR_SLOT_COUNT = 8;
export const FLOATS_PER_VIEW = 6;

/** `pointerFlags` bit assignments (slot 7) — see this file's header comment. */
const POINTER_FLAG_DOWN = 1 << 0;
const POINTER_FLAG_INSIDE = 1 << 1;

export const MainToWorkerType = {
  INIT: "INIT",
  FRAME_STATE: "FRAME_STATE",
  RESIZE: "RESIZE",
  VIEW_ADD: "VIEW_ADD",
  VIEW_REMOVE: "VIEW_REMOVE",
  SCENE_INVOKE: "SCENE_INVOKE",
  SET_REDUCED_MOTION: "SET_REDUCED_MOTION",
  DISPOSE: "DISPOSE",
} as const;

export const WorkerToMainType = {
  READY: "READY",
  ASSET_PROGRESS: "ASSET_PROGRESS",
  ASSETS_DONE: "ASSETS_DONE",
  HIT: "HIT",
  STATS: "STATS",
  CONTEXT_LOST: "CONTEXT_LOST",
  CONTEXT_RESTORED: "CONTEXT_RESTORED",
} as const;

export interface FrameStateScalars {
  scrollCurrent: number;
  scrollVelocity: number;
  scrollProgress: number;
  pointerX: number;
  pointerY: number;
  pointerVX: number;
  pointerVY: number;
  /** Real PointerTracker state (design review item A) — see this file's
   * header comment for why both hosts previously hardcoded these instead. */
  pointerDown: boolean;
  pointerInside: boolean;
}

export interface FrameStateView extends RectData {
  viewId: number;
  progress: number;
}

export interface FrameState extends FrameStateScalars {
  views: FrameStateView[];
}

/** Pure: packs scalars + per-view rects into one transferable Float32Array. */
export function packFrameState(
  scalars: FrameStateScalars,
  views: FrameStateView[]
): Float32Array {
  const out = new Float32Array(SCALAR_SLOT_COUNT + views.length * FLOATS_PER_VIEW);

  out[0] = scalars.scrollCurrent;
  out[1] = scalars.scrollVelocity;
  out[2] = scalars.scrollProgress;
  out[3] = scalars.pointerX;
  out[4] = scalars.pointerY;
  out[5] = scalars.pointerVX;
  out[6] = scalars.pointerVY;
  out[7] =
    (scalars.pointerDown ? POINTER_FLAG_DOWN : 0) | (scalars.pointerInside ? POINTER_FLAG_INSIDE : 0);

  for (let i = 0; i < views.length; i++) {
    const v = views[i]!;
    const base = SCALAR_SLOT_COUNT + i * FLOATS_PER_VIEW;
    out[base + 0] = v.viewId;
    out[base + 1] = v.top;
    out[base + 2] = v.left;
    out[base + 3] = v.width;
    out[base + 4] = v.height;
    out[base + 5] = v.progress;
  }

  return out;
}

/** Pure: inverse of packFrameState. Throws on a malformed buffer length. */
export function unpackFrameState(buf: Float32Array): FrameState {
  if (buf.length < SCALAR_SLOT_COUNT) {
    throw new Error(
      `unpackFrameState: buffer too short (${buf.length} < ${SCALAR_SLOT_COUNT})`
    );
  }
  const remainder = buf.length - SCALAR_SLOT_COUNT;
  if (remainder % FLOATS_PER_VIEW !== 0) {
    throw new Error(
      `unpackFrameState: malformed buffer length ${buf.length} (remainder ${remainder} not a multiple of ${FLOATS_PER_VIEW})`
    );
  }

  const viewCount = remainder / FLOATS_PER_VIEW;
  const views: FrameStateView[] = [];
  for (let i = 0; i < viewCount; i++) {
    const base = SCALAR_SLOT_COUNT + i * FLOATS_PER_VIEW;
    views.push({
      viewId: buf[base + 0]!,
      top: buf[base + 1]!,
      left: buf[base + 2]!,
      width: buf[base + 3]!,
      height: buf[base + 4]!,
      progress: buf[base + 5]!,
    });
  }

  const flags = buf[7]!;

  return {
    scrollCurrent: buf[0]!,
    scrollVelocity: buf[1]!,
    scrollProgress: buf[2]!,
    pointerX: buf[3]!,
    pointerY: buf[4]!,
    pointerVX: buf[5]!,
    pointerVY: buf[6]!,
    pointerDown: (flags & POINTER_FLAG_DOWN) !== 0,
    pointerInside: (flags & POINTER_FLAG_INSIDE) !== 0,
    views,
  };
}
