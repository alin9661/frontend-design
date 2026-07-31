// test/engine/gl/raycast.test.ts
//
// gl/raycast.ts's ViewRaycaster: THREE.Raycaster intersects CPU-side
// geometry, so this is fully testable in jsdom against real meshes — no
// WebGL context involved. Covers throttling, enter/leave edges, the
// down-while-hovering edge, and the pure pointer-uniform helper.

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  ViewRaycaster,
  getInstanceIndexMap,
  pointerUniformValues,
  runViewRaycasts,
  setInstanceIndexMap,
  type RaycastCandidate,
} from "@/lib/engine/gl/raycast";
import type { PointerHit, PointerState, RectData, SceneModule } from "@/lib/engine/types";

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

  it("design review item E9: wouldCast reports whether the throttle window has elapsed, independent of update()", () => {
    const raycaster = new ViewRaycaster({ throttleMs: 100 });
    expect(raycaster.wouldCast(0)).toBe(true); // never cast yet — always true

    const { camera, mesh } = makeCameraAndTarget();
    raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 0, down: false }, vi.fn());

    expect(raycaster.wouldCast(50)).toBe(false); // within the throttle window
    expect(raycaster.wouldCast(100)).toBe(true); // exactly at the window edge
    expect(raycaster.wouldCast(150)).toBe(true); // past it
  });

  it("design review item F3/E10: hovering reflects the current hit state and clears on dispose()", () => {
    const { camera, mesh } = makeCameraAndTarget();
    const raycaster = new ViewRaycaster();
    expect(raycaster.hovering).toBe(false);

    raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 0, down: false }, vi.fn());
    expect(raycaster.hovering).toBe(true);

    raycaster.dispose();
    expect(raycaster.hovering).toBe(false);
  });

  it("fires onPointer on a down-edge while hovering (click impulse), even with no hover-state change", () => {
    const { camera, mesh } = makeCameraAndTarget();
    const raycaster = new ViewRaycaster();
    const onPointer = vi.fn();

    raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 0, down: false }, onPointer); // enter
    raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 16, down: true }, onPointer); // down edge

    expect(onPointer).toHaveBeenCalledTimes(2);
  });

  it("design review item E12: a held-down pointer (wasDown already true) does not re-fire onPointer every frame — only the down EDGE does", () => {
    const { camera, mesh } = makeCameraAndTarget();
    const raycaster = new ViewRaycaster();
    const onPointer = vi.fn();

    raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 0, down: false }, onPointer); // enter
    raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 16, down: true }, onPointer); // down edge
    expect(onPointer).toHaveBeenCalledTimes(2);

    // Still down, still hovering the same target, several more frames —
    // `wasDown` is already true so this must NOT refire (only the initial
    // down EDGE does).
    raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 32, down: true }, onPointer);
    raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 48, down: true }, onPointer);
    raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 64, down: true }, onPointer);
    expect(onPointer).toHaveBeenCalledTimes(2); // unchanged — held-down, no refire
  });

  it("design review item E12: resolveInstanceId falls back to the raw local instanceId when the object never opted into an instanceIndexMap", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.z = 5;
    camera.lookAt(0, 0, 0);
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial(), 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    // Deliberately no setInstanceIndexMap() call.

    const raycaster = new ViewRaycaster();
    const hit = raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 0, down: false });

    expect(hit).not.toBeNull();
    expect(hit!.instanceId).toBe(0); // raw local index, unmapped
  });

  it("design review item E12: resolveInstanceId is undefined for a plain (non-instanced) Mesh hit", () => {
    const { camera, mesh } = makeCameraAndTarget();
    const raycaster = new ViewRaycaster();
    const hit = raycaster.update({ ndcX: 0, ndcY: 0, camera, targets: [mesh], now: 0, down: false });

    expect(hit).not.toBeNull();
    expect(hit!.instanceId).toBeUndefined();
  });
});

describe("runViewRaycasts", () => {
  const RECT: RectData = { top: 0, left: 0, width: 800, height: 600 };
  const SIZE = { width: 800, height: 600 };

  function makeCandidate(viewId: number, module: SceneModule): { candidate: RaycastCandidate; mesh: THREE.Mesh } {
    const { camera, mesh } = makeCameraAndTarget();
    return { candidate: { viewId, rect: RECT, camera, targets: [mesh], module }, mesh };
  }

  function fakeModule(onPointer?: (hit: PointerHit | null) => void): SceneModule {
    return { init: () => {}, update: () => {}, dispose: () => {}, onPointer };
  }

  it("posts HIT (via onHit) and calls SceneModule.onPointer on enter, but not on every subsequent frame while still hovering", () => {
    const onPointer = vi.fn();
    const onHit = vi.fn();
    const { candidate } = makeCandidate(1, fakeModule(onPointer));
    const raycasters = new Map<number, ViewRaycaster>();

    // pointer centered (ndc 0,0) -> hits the 10x10 plane dead ahead.
    runViewRaycasts({ candidates: [candidate], pointer: { x: 0, y: 0, down: false, inside: true }, scrollY: 0, size: SIZE, now: 0, raycasters, onHit });
    expect(onPointer).toHaveBeenCalledTimes(1);
    expect(onPointer.mock.calls[0]![0]).not.toBeNull();
    expect(onHit).toHaveBeenCalledTimes(1);
    expect(onHit.mock.calls[0]![0]).toBe(1);
    expect(onHit.mock.calls[0]![1]).not.toBeNull();

    // Same target, slightly different position, well past any throttle window — still hovering.
    runViewRaycasts({ candidates: [candidate], pointer: { x: 0.01, y: 0, down: false, inside: true }, scrollY: 0, size: SIZE, now: 1000, raycasters, onHit });
    expect(onPointer).toHaveBeenCalledTimes(1); // no re-fire
    expect(onHit).toHaveBeenCalledTimes(1); // no HIT spam
  });

  it("posts HIT(null) and calls onPointer(null) on leave", () => {
    const onPointer = vi.fn();
    const onHit = vi.fn();
    const { candidate } = makeCandidate(2, fakeModule(onPointer));
    const raycasters = new Map<number, ViewRaycaster>();

    runViewRaycasts({ candidates: [candidate], pointer: { x: 0, y: 0, down: false, inside: true }, scrollY: 0, size: SIZE, now: 0, raycasters, onHit });
    runViewRaycasts({ candidates: [candidate], pointer: { x: 5, y: 5, down: false, inside: true }, scrollY: 0, size: SIZE, now: 1000, raycasters, onHit });

    expect(onPointer).toHaveBeenCalledTimes(2);
    expect(onPointer.mock.calls[1]![0]).toBeNull();
    expect(onHit).toHaveBeenLastCalledWith(2, null);
  });

  it("pointer.inside === false forces a leave even at an NDC that would otherwise hit", () => {
    const onPointer = vi.fn();
    const { candidate } = makeCandidate(3, fakeModule(onPointer));
    const raycasters = new Map<number, ViewRaycaster>();

    runViewRaycasts({ candidates: [candidate], pointer: { x: 0, y: 0, down: false, inside: true }, scrollY: 0, size: SIZE, now: 0, raycasters });
    expect(onPointer.mock.calls[0]![0]).not.toBeNull();

    runViewRaycasts({ candidates: [candidate], pointer: { x: 0, y: 0, down: false, inside: false }, scrollY: 0, size: SIZE, now: 1000, raycasters });
    expect(onPointer).toHaveBeenCalledTimes(2);
    expect(onPointer.mock.calls[1]![0]).toBeNull();
  });

  it("skips views with no registered targets (empty candidates list) without throwing", () => {
    const raycasters = new Map<number, ViewRaycaster>();
    expect(() =>
      runViewRaycasts({ candidates: [], pointer: { x: 0, y: 0, down: false, inside: true }, scrollY: 0, size: SIZE, now: 0, raycasters })
    ).not.toThrow();
  });

  it("is a no-op when size is zero (view never resized yet)", () => {
    const onPointer = vi.fn();
    const { candidate } = makeCandidate(4, fakeModule(onPointer));
    const raycasters = new Map<number, ViewRaycaster>();

    runViewRaycasts({ candidates: [candidate], pointer: { x: 0, y: 0, down: false, inside: true }, scrollY: 0, size: { width: 0, height: 0 }, now: 0, raycasters });
    expect(onPointer).not.toHaveBeenCalled();
  });

  it("prunes ViewRaycaster state for views no longer present in candidates", () => {
    const { candidate } = makeCandidate(5, fakeModule());
    const raycasters = new Map<number, ViewRaycaster>();

    runViewRaycasts({ candidates: [candidate], pointer: { x: 0, y: 0, down: false, inside: true }, scrollY: 0, size: SIZE, now: 0, raycasters });
    expect(raycasters.has(5)).toBe(true);

    runViewRaycasts({ candidates: [], pointer: { x: 0, y: 0, down: false, inside: true }, scrollY: 0, size: SIZE, now: 1000, raycasters });
    expect(raycasters.has(5)).toBe(false);
  });

  it("design review item F3/E10: pruning a view that's currently mid-hover fires one final leave (onHit + module.onPointer) instead of silently dropping it", () => {
    const onPointer = vi.fn();
    const onHit = vi.fn();
    const { candidate } = makeCandidate(40, fakeModule(onPointer));
    const raycasters = new Map<number, ViewRaycaster>();

    // Centered pointer -> hover enter.
    runViewRaycasts({ candidates: [candidate], pointer: { x: 0, y: 0, down: false, inside: true }, scrollY: 0, size: SIZE, now: 0, raycasters, onHit });
    expect(onPointer).toHaveBeenCalledTimes(1);
    expect(onPointer.mock.calls[0]![0]).not.toBeNull();

    // The view is removed (no longer a candidate) while still hovering.
    onPointer.mockClear();
    onHit.mockClear();
    runViewRaycasts({ candidates: [], pointer: { x: 0, y: 0, down: false, inside: true }, scrollY: 0, size: SIZE, now: 1000, raycasters, onHit });

    expect(raycasters.has(40)).toBe(false);
    expect(onPointer).toHaveBeenCalledTimes(1);
    expect(onPointer.mock.calls[0]![0]).toBeNull();
    expect(onHit).toHaveBeenCalledWith(40, null);
  });

  it("design review item F3/E10: pruning a view that was never hovering fires no leave (nothing to report)", () => {
    const onPointer = vi.fn();
    const onHit = vi.fn();
    // Off-target from the start — candidate never actually hovers.
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.z = 5;
    camera.lookAt(0, 0, 0);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial());
    const candidate: RaycastCandidate = { viewId: 41, rect: RECT, camera, targets: [mesh], module: fakeModule(onPointer) };
    const raycasters = new Map<number, ViewRaycaster>();

    runViewRaycasts({ candidates: [candidate], pointer: { x: 5, y: 5, down: false, inside: true }, scrollY: 0, size: SIZE, now: 0, raycasters, onHit });
    expect(onPointer).not.toHaveBeenCalled();

    runViewRaycasts({ candidates: [], pointer: { x: 5, y: 5, down: false, inside: true }, scrollY: 0, size: SIZE, now: 1000, raycasters, onHit });
    expect(onPointer).not.toHaveBeenCalled();
    expect(onHit).not.toHaveBeenCalled();
  });

  it("is a no-op with zero allocation-worthy work when both candidates and raycasters are empty", () => {
    const raycasters = new Map<number, ViewRaycaster>();
    expect(() =>
      runViewRaycasts({ candidates: [], pointer: { x: 0, y: 0, down: false, inside: true }, scrollY: 0, size: SIZE, now: 0, raycasters })
    ).not.toThrow();
    expect(raycasters.size).toBe(0);
  });

  it("each registered view is independent — a hit in view A doesn't affect view B's hover state", () => {
    const onPointerA = vi.fn();
    const onPointerB = vi.fn();
    const { candidate: a } = makeCandidate(10, fakeModule(onPointerA));
    const { candidate: b } = makeCandidate(11, fakeModule(onPointerB));
    const raycasters = new Map<number, ViewRaycaster>();

    // Centered pointer hits both (both candidates share the same rect/NDC convention in this test).
    runViewRaycasts({ candidates: [a, b], pointer: { x: 0, y: 0, down: false, inside: true }, scrollY: 0, size: SIZE, now: 0, raycasters });
    expect(onPointerA).toHaveBeenCalledTimes(1);
    expect(onPointerB).toHaveBeenCalledTimes(1);
    expect(raycasters.size).toBe(2);
  });

  it("remaps InstancedMesh instanceId through setInstanceIndexMap()/getInstanceIndexMap() into the reported hit (multi-target global index)", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.z = 5;
    camera.lookAt(0, 0, 0);
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial(), 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    setInstanceIndexMap(mesh, [777]);

    let seenHit: PointerHit | null | undefined;
    const module = fakeModule((hit) => {
      seenHit = hit;
    });
    const raycasters = new Map<number, ViewRaycaster>();

    runViewRaycasts({
      candidates: [{ viewId: 6, rect: RECT, camera, targets: [mesh], module }],
      pointer: { x: 0, y: 0, down: false, inside: true },
      scrollY: 0,
      size: SIZE,
      now: 0,
      raycasters,
    });

    expect(seenHit).not.toBeNull();
    expect(seenHit?.instanceId).toBe(777);
  });
});

describe("setInstanceIndexMap / getInstanceIndexMap (design review item E6)", () => {
  it("round-trips a local-index -> global-index map on an object's userData", () => {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(), 3);
    expect(getInstanceIndexMap(mesh)).toBeUndefined();

    setInstanceIndexMap(mesh, [10, 20, 30]);
    expect(getInstanceIndexMap(mesh)).toEqual([10, 20, 30]);
  });

  it("works on any Object3D, not just InstancedMesh", () => {
    const group = new THREE.Group();
    setInstanceIndexMap(group, [5]);
    expect(getInstanceIndexMap(group)).toEqual([5]);
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
