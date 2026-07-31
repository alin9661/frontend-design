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
import type { PointerHit, PointerState } from "../types";

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
    instanceId: hit.instanceId ?? undefined,
  };
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
