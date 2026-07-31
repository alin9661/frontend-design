// test/engine/gl/raycast.test.ts
//
// gl/raycast.ts's ViewRaycaster: THREE.Raycaster intersects CPU-side
// geometry, so this is fully testable in jsdom against real meshes — no
// WebGL context involved. Covers throttling, enter/leave edges, the
// down-while-hovering edge, and the pure pointer-uniform helper.

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ViewRaycaster, pointerUniformValues } from "@/lib/engine/gl/raycast";
import type { PointerState } from "@/lib/engine/types";

function makeCameraAndTarget() {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial());
  mesh.position.z = 0;
  return { camera, mesh };
}

describe("ViewRaycaster", () => {
  it("calls onPointer with a hit on enter, and does not re-fire on every subsequent frame while still hovering", () => {
    const { camera, mesh } = makeCameraAndTarget();
    const raycaster = new ViewRaycaster();
    const onPointer = vi.fn();

    raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 0, down: false }, onPointer);
    expect(onPointer).toHaveBeenCalledTimes(1);
    expect(onPointer.mock.calls[0]![0]).not.toBeNull();

    raycaster.update({ ndcX: 0.01, ndcY: 0, camera, targets: [mesh], now: 16, down: false }, onPointer);
    expect(onPointer).toHaveBeenCalledTimes(1); // still hovering, no re-fire
  });

  it("calls onPointer with null on leave", () => {
    const { camera, mesh } = makeCameraAndTarget();
    const raycaster = new ViewRaycaster();
    const onPointer = vi.fn();

    raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 0, down: false }, onPointer);
    raycaster.update({ ndcX: 5, ndcY: 5, camera, targets: [mesh], now: 16, down: false }, onPointer); // off the plane

    expect(onPointer).toHaveBeenCalledTimes(2);
    expect(onPointer.mock.calls[1]![0]).toBeNull();
  });

  it("returns null and skips onPointer when nothing is hit and nothing changed", () => {
    const { camera, mesh } = makeCameraAndTarget();
    const raycaster = new ViewRaycaster();
    const onPointer = vi.fn();

    const hit = raycaster.update({ ndcX: 5, ndcY: 5, camera, targets: [mesh], now: 0, down: false }, onPointer);
    expect(hit).toBeNull();
    expect(onPointer).not.toHaveBeenCalled();
  });

  it("throttles: within throttleMs, returns the last hit without re-casting or re-firing", () => {
    const { camera, mesh } = makeCameraAndTarget();
    const raycaster = new ViewRaycaster({ throttleMs: 100 });
    const onPointer = vi.fn();

    const first = raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 0, down: false }, onPointer);
    // Move off-target within the throttle window — should still report the cached (on-target) hit.
    const second = raycaster.update({ ndcX: 5, ndcY: 5, camera, targets: [mesh], now: 10, down: false }, onPointer);
    expect(second).toEqual(first);
    expect(onPointer).toHaveBeenCalledTimes(1); // only the initial enter

    // Past the throttle window, the real (off-target) position is used and leave fires.
    const third = raycaster.update({ ndcX: 5, ndcY: 5, camera, targets: [mesh], now: 200, down: false }, onPointer);
    expect(third).toBeNull();
    expect(onPointer).toHaveBeenCalledTimes(2);
  });

  it("fires onPointer on a down-edge while hovering (click impulse), even with no hover-state change", () => {
    const { camera, mesh } = makeCameraAndTarget();
    const raycaster = new ViewRaycaster();
    const onPointer = vi.fn();

    raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 0, down: false }, onPointer); // enter
    raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 16, down: true }, onPointer); // down edge

    expect(onPointer).toHaveBeenCalledTimes(2);
  });
});

describe("pointerUniformValues", () => {
  it("maps PointerState x/y/vx/vy to uPointer/uPointerVelocity vectors", () => {
    const pointer: PointerState = { x: 0.5, y: -0.25, vx: 1.2, vy: -3.4, down: false, inside: true };
    const { uPointer, uPointerVelocity } = pointerUniformValues(pointer);
    expect(uPointer.x).toBe(0.5);
    expect(uPointer.y).toBe(-0.25);
    expect(uPointerVelocity.x).toBe(1.2);
    expect(uPointerVelocity.y).toBe(-3.4);
  });
});
