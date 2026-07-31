// lib/engine/gl/raycast.ts
//
// Per-view throttled raycaster: converts pointer NDC + camera + candidate
// objects into a PointerHit (see types.ts), tracks hover state to derive
// enter/leave edges, and forwards down/up-while-hovering to the same
// `onPointer` callback the SceneModule contract expects. Also exposes pure
// uPointer/uPointerVelocity uniform-value helpers so scene shaders share one
// source of truth for the pointer uniforms (design doc §4 gl/raycast.ts).
//
// THREE.Raycaster intersects CPU-side geometry — no GPU/WebGL context is
// involved, so this module is fully unit-testable against real THREE meshes
// in jsdom.

import * as THREE from "three";
import { viewNDC } from "../core/pointer";
import type { PointerHit, PointerState, RectData, SceneModule } from "../types";

export interface RaycastInput {
  ndcX: number;
  ndcY: number;
  camera: THREE.Camera;
  targets: THREE.Object3D[];
  /** Monotonic clock, e.g. `performance.now()` — injectable for tests. */
  now: number;
  down: boolean;
}

export interface RaycastOptions {
  /** Minimum ms between actual raycasts; hover state carries over while throttled. Default 0 (no throttle). */
  throttleMs?: number;
}

function toPointerHit(ndcX: number, ndcY: number, hit: THREE.Intersection): PointerHit {
  return {
    x: ndcX,
    y: ndcY,
    point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
    distance: hit.distance,
    faceIndex: hit.faceIndex ?? undefined,
    instanceId: resolveInstanceId(hit),
  };
}

/**
 * Resolves the reported `instanceId`. Raw `THREE.Intersection.instanceId` is
 * the intersected `InstancedMesh`'s own LOCAL index — meaningless once a
 * scene registers more than one InstancedMesh as raycast targets, since each
 * has its own independent 0..count-1 range (e.g. pointer-field's separate
 * leaf/berry InstancedMesh, which share one `PointerFieldSim` global index
 * space). A scene that needs a single global index space across its
 * registered meshes can opt in by setting `mesh.userData.instanceIndexMap`
 * to a local-index -> global-index lookup (`ArrayLike<number>` — e.g. the
 * same index array used to build that mesh's instances); `PointerHit`
 * itself deliberately carries no object reference (structured-clone-safe,
 * crosses postMessage — see its own doc comment), so this remap has to
 * happen here, before the plain hit is built.
 */
function resolveInstanceId(hit: THREE.Intersection): number | undefined {
  if (hit.instanceId == null) return undefined;
  const indexMap = (hit.object.userData as { instanceIndexMap?: ArrayLike<number> }).instanceIndexMap;
  return indexMap ? indexMap[hit.instanceId] : hit.instanceId;
}

/**
 * Stateful per-view raycaster. `update()` returns the current hit (or null)
 * and invokes `onPointer` only on a state transition: hover enter, hover
 * leave, or a down-edge while hovering (click impulse) — never once per
 * frame while nothing changed, so scenes aren't flooded with redundant
 * calls.
 */
export class ViewRaycaster {
  private raycaster = new THREE.Raycaster();
  private throttleMs: number;
  private lastCastAt = -Infinity;
  private lastHit: PointerHit | null = null;
  private wasDown = false;

  constructor(opts: RaycastOptions = {}) {
    this.throttleMs = opts.throttleMs ?? 0;
  }

  update(input: RaycastInput, onPointer?: (hit: PointerHit | null) => void): PointerHit | null {
    const throttled = input.now - this.lastCastAt < this.throttleMs;
    let hit: PointerHit | null = this.lastHit;

    if (!throttled) {
      this.lastCastAt = input.now;
      this.raycaster.setFromCamera(new THREE.Vector2(input.ndcX, input.ndcY), input.camera);
      const intersections = this.raycaster.intersectObjects(input.targets, true);
      hit = intersections.length > 0 ? toPointerHit(input.ndcX, input.ndcY, intersections[0]!) : null;
    }

    const hadHit = this.lastHit !== null;
    const hasHit = hit !== null;
    const downEdge = input.down && !this.wasDown && hasHit;

    if (hadHit !== hasHit || downEdge) {
      onPointer?.(hit);
    }

    this.lastHit = hit;
    this.wasDown = input.down;
    return hit;
  }

  dispose(): void {
    this.lastHit = null;
  }
}

/** Pure: builds the shared uPointer/uPointerVelocity uniform values from PointerState. */
export function pointerUniformValues(pointer: PointerState): {
  uPointer: THREE.Vector2;
  uPointerVelocity: THREE.Vector2;
} {
  return {
    uPointer: new THREE.Vector2(pointer.x, pointer.y),
    uPointerVelocity: new THREE.Vector2(pointer.vx, pointer.vy),
  };
}

// ---------------------------------------------------------------------------
// runViewRaycasts — the ONE code path both RenderHost implementations
// (worker/render.worker.ts's RAF tick and worker/host.ts's MainThreadHost)
// call once per frame, so "both hosts drive an identical SceneModule.
// onPointer" (design doc §4A) is true by construction instead of by keeping
// two hand-written copies in sync.
// ---------------------------------------------------------------------------

/** One raycastable view this frame — supplied by gl/stage.ts's `Stage.raycastCandidates()`. */
export interface RaycastCandidate {
  viewId: number;
  rect: RectData;
  camera: THREE.Camera;
  targets: THREE.Object3D[];
  module: SceneModule;
}

/** Throttle both hosts share by default — ~20Hz is plenty for hover/click
 * detection and bounds the per-frame CPU raycast cost against scenes with
 * many registered targets (e.g. pointer-field's ~300 instances). */
export const DEFAULT_RAYCAST_THROTTLE_MS = 50;

export interface RunViewRaycastsInput {
  /** Ready, in-view, interactive-target-registered views this frame. */
  candidates: RaycastCandidate[];
  /** Full-viewport normalized pointer position/state (ViewContext.pointer's shape). */
  pointer: Pick<PointerState, "x" | "y" | "down" | "inside">;
  /** Current scroll position (`ScrollState.current`) — needed to convert a
   * view's document-space rect into its current viewport-space position. */
  scrollY: number;
  /** Canvas/viewport size in CSS px (`StageFrameInput.size`, dpr ignored). */
  size: { width: number; height: number };
  /** Monotonic clock, e.g. a `requestAnimationFrame` timestamp or
   * `performance.now()` — the per-view raycaster's throttle seam. */
  now: number;
  /** Per-view `ViewRaycaster` state, keyed by viewId — owned by the caller
   * (one `Map` per RenderHost instance) so hover state persists across
   * frames; entries for views no longer present in `candidates` are pruned
   * here. */
  raycasters: Map<number, ViewRaycaster>;
  throttleMs?: number;
  /** Fired on every enter/leave/down-edge transition, in addition to the
   * matching view's `SceneModule.onPointer` — the worker path forwards this
   * to a `HIT` postMessage; the main-thread path forwards it to its own
   * `WorkerToMain` listeners. */
  onHit?: (viewId: number, hit: PointerHit | null) => void;
}

/**
 * Runs one throttled raycast per registered view this frame: converts the
 * shared full-viewport pointer position into each view's own NDC (via
 * core/pointer.ts's `viewNDC`, using that view's document-space rect and the
 * current scroll position), raycasts against its registered interactive
 * objects, calls the view's `SceneModule.onPointer` locally, and reports
 * every enter/leave/down-edge transition via `onHit`. The transition-only
 * behavior (no per-frame spam while hovering the same target) comes
 * straight from `ViewRaycaster.update()` — this function only wires the
 * per-view inputs so both RenderHost implementations share one path.
 */
export function runViewRaycasts(input: RunViewRaycastsInput): void {
  const { candidates, pointer, scrollY, size, now, raycasters, throttleMs, onHit } = input;

  const liveViewIds = new Set(candidates.map((c) => c.viewId));
  for (const viewId of raycasters.keys()) {
    if (!liveViewIds.has(viewId)) raycasters.delete(viewId);
  }

  if (size.width <= 0 || size.height <= 0) return;
  // Inverse of core/pointer.ts's PointerTracker.onMove normalization
  // (`targetX = clamp(clientX/w*2-1)`, `targetY = clamp(-(clientY/h*2-1))`)
  // — recovers an approximate client-pixel position from the normalized
  // full-viewport value FRAME_STATE actually carries.
  const clientX = ((pointer.x + 1) / 2) * size.width;
  const clientY = ((1 - pointer.y) / 2) * size.height;

  for (const candidate of candidates) {
    let raycaster = raycasters.get(candidate.viewId);
    if (!raycaster) {
      raycaster = new ViewRaycaster({ throttleMs: throttleMs ?? DEFAULT_RAYCAST_THROTTLE_MS });
      raycasters.set(candidate.viewId, raycaster);
    }

    // Pointer outside the viewport entirely: no real target can be hit —
    // pass an empty target list so a stale hover correctly resolves to a
    // "leave" transition instead of raycasting a stale/garbage position.
    const targets = pointer.inside ? candidate.targets : [];
    const ndc = viewNDC(clientX, clientY, candidate.rect, scrollY);

    raycaster.update(
      { ndcX: ndc.x, ndcY: ndc.y, camera: candidate.camera, targets, now, down: pointer.down },
      (hit) => {
        candidate.module.onPointer?.(hit);
        onHit?.(candidate.viewId, hit);
      }
    );
  }
}
